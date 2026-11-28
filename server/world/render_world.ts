import path from "node:path";
import { createCanvas, ImageData, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import type { ServerContext } from "../database/context";
import { getClothingVector, type PlayerAccount, type PlayerSession } from "../database/peer";
import { getWorldLockTile, type WorldInstance } from "../database/world";
import { DISCORD_ICON_ITEM_ID } from "../database/items";
import { discordConfigured, discordStatus, sendWorldRenderToDiscord } from "../discord/service";
import { OnConsoleMessage, OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";

/**
 * /renderworld - renders the whole world to a PNG the way Growtopia itself does:
 *   a fixed 1600x960 picture (tile = 1600 / world.width, so 16px for our 100x60
 *   worlds), the world's weather backdrop, flat sprites without drop shadows,
 *   every player standing in the world (avatar + name tag) and the native
 *   "Visit "WORLD" in" + Growtopia logo watermark in the lower right corner.
 */

const OUT_W = 1600;
const OUT_H = 960;
const AVATAR_PX = 32;
// Avatars are drawn 32px wide but taller than a tile: hats and hair reach above
// the head, exactly like the native render.
const AVATAR_H = 44;
const AVATAR_TOP = AVATAR_H - AVATAR_PX;
const RENDER_COOLDOWN_MS = 60 * 1000;
// The native World Render dialog uses the mailbox sprite, not a World Lock.
const WORLD_RENDER_ICON = 656;
const WATERMARK_PINK = "#ff8ff3";
const WATERMARK_FONT = "bold 22px Arial";
const NAME_FONT = "bold 12px Arial";
const NAME_OWNER = "#7bff7b";
const NAME_GUEST = "#ffffff";

const lastRenderMs = new WeakMap<PlayerSession, number>();
const imageCache = new Map<string, Promise<Image | null>>();
const spriteCache = new Map<string, Canvas | null>();
const assetCache = new Map<string, Canvas | null>();
const avatarCache = new Map<string, Canvas | null>();

function loadAsset(file: string): Promise<Image | null> {
  let pending = imageCache.get(file);
  if (!pending) {
    pending = loadImage(file).catch(() => null);
    imageCache.set(file, pending);
  }
  return pending;
}

function weatherFile(ctx: ServerContext, weatherId: number): string {
  // Painted skies for the weather ids we ship; everything else (including the
  // default sunny weather) uses the 0 backdrop.
  const id = weatherId === 2 || weatherId === 3 || weatherId === 68 ? weatherId : 0;
  return path.join(ctx.rootDir, "public", "branding", "renderworld", `weather-${id}.png`);
}

// A single 32x32 item cell, exactly as the client draws it (no drop shadow).
function spriteOf(ctx: ServerContext, id: number, cellX: number, cellY: number): Canvas | null {
  const key = `${id}:${cellX}:${cellY}`;
  if (spriteCache.has(key)) return spriteCache.get(key) || null;
  let rgba =
    cellX === 0 && cellY === 0
      ? ctx.itemIcons.getIconRgba(id)
      : ctx.itemIcons.getSpriteCell(id, cellX, cellY);
  // Fall back to the item's default icon if a variant cell is missing.
  if (!rgba && (cellX !== 0 || cellY !== 0)) rgba = ctx.itemIcons.getIconRgba(id);
  let canvas: Canvas | null = null;
  if (rgba) {
    canvas = createCanvas(AVATAR_PX, AVATAR_PX);
    const sg = canvas.getContext("2d");
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
    sg.putImageData(new ImageData(pixels, AVATAR_PX, AVATAR_PX), 0, 0);
  }
  spriteCache.set(key, canvas);
  return canvas;
}

// Decodes a packed client texture (/game/player_head.rttex, ...) into a canvas.
function packedTexture(
  ctx: ServerContext,
  relPath: string,
  tint?: { r: number; g: number; b: number }
): Canvas | null {
  const key = tint ? `${relPath}:${tint.r},${tint.g},${tint.b}` : relPath;
  if (assetCache.has(key)) return assetCache.get(key) || null;
  const tex = ctx.itemIcons.getPackedTexture(relPath);
  let canvas: Canvas | null = null;
  if (tex) {
    const rgba = Buffer.from(tex.rgba);
    if (tint) {
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = Math.round((rgba[i] * tint.r) / 255);
        rgba[i + 1] = Math.round((rgba[i + 1] * tint.g) / 255);
        rgba[i + 2] = Math.round((rgba[i + 2] * tint.b) / 255);
      }
    }
    canvas = createCanvas(tex.width, tex.height);
    const g = canvas.getContext("2d");
    g.putImageData(
      new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), tex.width, tex.height),
      0,
      0
    );
  }
  assetCache.set(key, canvas);
  return canvas;
}

// Clothing/misc wear uses the item's own world sprite cell (items.dat tx/ty),
// not the padded inventory icon.
function wearSprite(ctx: ServerContext, itemId: number): Canvas | null {
  const key = `wear:${itemId}`;
  if (spriteCache.has(key)) return spriteCache.get(key) || null;
  const rgba = ctx.itemIcons.getSpriteCell(itemId, 0, 0);
  let canvas: Canvas | null = null;
  if (rgba) {
    canvas = createCanvas(AVATAR_PX, AVATAR_PX);
    const g = canvas.getContext("2d");
    g.putImageData(
      new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), AVATAR_PX, AVATAR_PX),
      0,
      0
    );
  }
  spriteCache.set(key, canvas);
  return canvas;
}

// Country flag shown left of the name tag, from the client's flag textures.
function flagOf(ctx: ServerContext, flag: string | undefined): Canvas | null {
  const code = (flag || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!code) return null;
  return packedTexture(ctx, `interface/flags/${code}.rttex`);
}

function skinTint(account: PlayerAccount): { r: number; g: number; b: number } {
  const argb = (account.skinColor ?? 0xffd7b79a) >>> 0;
  return { r: (argb >> 16) & 0xff, g: (argb >> 8) & 0xff, b: argb & 0xff };
}

/**
 * Builds the 32x32 avatar the client draws in the world: base body and head
 * tinted with the account skin colour, then the equipped clothing layers in
 * the client's draw order. Every texture cell already shares the same origin.
 */
function avatarOf(ctx: ServerContext, account: PlayerAccount): Canvas | null {
  const slots = getClothingVector(account, ctx.itemsDb);
  const key = `${slots.join(",")}:${(account.skinColor ?? 0) >>> 0}`;
  if (avatarCache.has(key)) return avatarCache.get(key) || null;

  const canvas = createCanvas(AVATAR_PX, AVATAR_H);
  const g = canvas.getContext("2d");
  const skin = skinTint(account);
  const layer = (
    rel: string,
    dy = 0,
    cellX = 0,
    cellY = 0,
    tint?: { r: number; g: number; b: number }
  ): void => {
    const tex = packedTexture(ctx, rel, tint);
    if (tex) {
      g.drawImage(tex, cellX * AVATAR_PX, cellY * AVATAR_PX, AVATAR_PX, AVATAR_PX, 0, AVATAR_TOP + dy, AVATAR_PX, AVATAR_PX);
    }
  };
  const wear = (itemId: number, dy = 0): void => {
    if (!itemId) return;
    const sprite = wearSprite(ctx, itemId);
    if (sprite) g.drawImage(sprite, 0, AVATAR_TOP + dy);
  };

  // Skin base (head, torso, arms) then the equipped layers on top.
  layer("game/player_head.rttex", 0, 0, 0, skin);
  layer("game/player_body_only.rttex", 0, 0, 0, skin);
  wear(slots[3], 0); // feet
  wear(slots[2], 0); // pants
  wear(slots[1], 0); // shirt
  wear(slots[6], 0); // back
  layer("game/player_eyes.rttex", 0, 0, 0);
  wear(slots[4], 0); // face
  wear(slots[7], -12); // hair
  wear(slots[0], -12); // hat
  wear(slots[8], 0); // neck
  wear(slots[9], 0); // ances

  avatarCache.set(key, canvas);
  return canvas;
}

// --- RenderWorldJS spread_type >= 2 tile picking --------------------------

function spreadCell(
  grid: Int32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  spreadType: number
): [number, number] {
  let cX = 0;
  let cY = 0;
  const self = grid[y * width + x];
  const at = (xx: number, yy: number): number => grid[yy * width + xx];
  const atasB = y === 0 || at(x, y - 1) !== self;
  const bawahB = y === height - 1 || at(x, y + 1) !== self;
  const kiriB = x === 0 || at(x - 1, y) !== self;
  const kananB = x === width - 1 || at(x + 1, y) !== self;
  const atasS = y === 0 || at(x, y - 1) === self;
  const bawahS = y === height - 1 || at(x, y + 1) === self;
  const kiriS = x === 0 || at(x - 1, y) === self;
  const kananS = x === width - 1 || at(x + 1, y) === self;

  if (atasB && bawahB && kiriB && kananB) {
    cX = 4;
    cY = 1;
  } else if (kananB && bawahS && atasB && x < width - 1) cX = 6;
  else if (kiriB && bawahS && atasB) cX = 5;
  else if (atasB && bawahB) {
    if (x > 0) {
      if (kiriS && kananS) {
        if (spreadType === 5) {
          cX = 5;
          cY = 1;
        } else {
          cX = 6;
          cY = 4;
        }
      } else if (kiriB && kananS) {
        if (spreadType === 5) {
          cX = 6;
          cY = 1;
        } else {
          cX = 5;
          cY = 3;
        }
      } else if (kananB && kiriS) {
        if (spreadType === 5) {
          cX = 7;
          cY = 1;
        } else {
          cX = 6;
          cY = 3;
        }
      }
    }
  } else if (kananB && kiriB) {
    if (x > 0) {
      if (atasS && bawahS) {
        cX = 1;
        cY = 1;
      } else if (atasB && bawahS) {
        cX = 2;
        cY = 1;
      } else if (atasS && bawahB && x < width - 1) {
        cX = 3;
        cY = 1;
      }
    }
  } else if (atasB) {
    if (kiriS && kananS && bawahS) cX = 1;
    else if (x > 0) {
      if (kiriB && bawahB) cX = 7;
      else if (kananB && bawahB) cY = 1;
      else if (kiriS && kananS) {
        cX = 5;
        cY = 1;
      }
    }
  } else if (atasS) {
    if (x > 0 && x < width - 1) {
      if (bawahB && kiriS && kananS) cX = 2;
      else if (kiriB && bawahB) cX = 7;
      else if (kananB && bawahB) cY = 1;
      else if (kiriB && kananS && bawahS) cX = 3;
      else if (kananB && kiriS && bawahS) cX = 4;
    }
  }
  return [cX, cY];
}

// --- world render ---------------------------------------------------------

export async function renderWorldPng(ctx: ServerContext, world: WorldInstance): Promise<Buffer> {
  const width = world.width;
  const height = world.height;
  const tile = OUT_W / width;
  const scale = OUT_W / (width * 32);

  const canvas = createCanvas(OUT_W, OUT_H);
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";

  // The weather backdrop is a 16:9 painting stretched over the 5:3 picture,
  // exactly like the native renderer.
  const backdrop = await loadAsset(weatherFile(ctx, world.weatherId));
  if (backdrop) {
    // Cover-fit so the painted sky keeps its proportions (round sun, round peaks).
    const cover = Math.max(OUT_W / backdrop.width, OUT_H / backdrop.height);
    const bw = backdrop.width * cover;
    const bh = backdrop.height * cover;
    g.drawImage(backdrop, (OUT_W - bw) / 2, (OUT_H - bh) / 2, bw, bh);
  } else {
    g.fillStyle = "#5ecbe8";
    g.fillRect(0, 0, OUT_W, OUT_H);
  }

  // Drifting clouds from the client's own cloud sprite.
  const cloud = packedTexture(ctx, "game/cloud.rttex");
  if (cloud) {
    const clouds: Array<[number, number, number]> = [
      [0.03, 0.1, 0.55],
      [0.19, 0.055, 0.62],
      [0.3, 0.16, 0.46],
      [0.47, 0.02, 0.4],
      [0.6, 0.08, 0.34],
      [0.7, 0.015, 0.3],
      [0.04, 0.3, 0.32],
      [0.9, 0.24, 0.34],
    ];
    g.globalAlpha = 0.92;
    for (const [fx, fy, fs] of clouds) {
      const cw = OUT_W * 0.19 * fs;
      const ch = (cw * cloud.height) / cloud.width;
      g.drawImage(cloud, fx * OUT_W, fy * OUT_H, cw, ch);
    }
    g.globalAlpha = 1;
  }

  const fgGrid = new Int32Array(width * height);
  for (let i = 0; i < fgGrid.length; i++) fgGrid[i] = world.tiles[i]?.fg ?? 0;

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const t = world.tiles[ty * width + tx];
      if (!t) continue;
      const ox = tx * tile;
      const oy = ty * tile;

      if (t.bg) {
        const bgSprite = spriteOf(ctx, t.bg, 0, 0);
        if (bgSprite) g.drawImage(bgSprite, ox, oy, tile, tile);
      }
      if (t.fg) {
        const spreadType = ctx.itemIcons.getSpreadType(t.fg);
        let cellX = 0;
        let cellY = 0;
        if (spreadType >= 2) {
          [cellX, cellY] = spreadCell(fgGrid, width, height, tx, ty, spreadType);
        }
        const fgSprite = spriteOf(ctx, t.fg, cellX, cellY);
        if (fgSprite) g.drawImage(fgSprite, ox, oy, tile, tile);
      }
    }
  }

  // Players standing in the world, lowest first so they overlap correctly.
  const ownerId = worldOwnerId(world);
  const present = [...ctx.sessions]
    .filter((s) => s.world === world && !s.invis)
    .sort((a, b) => a.y - b.y);
  for (const s of present) {
    const avatar = avatarOf(ctx, s.account);
    const px = s.x * scale;
    const py = s.y * scale;
    if (avatar) g.drawImage(avatar, Math.round(px - AVATAR_PX / 2), Math.round(py - AVATAR_H));

    const tagY = py - AVATAR_H - 4;
    g.font = NAME_FONT;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const nameW = g.measureText(s.account.name).width;
    const flag = flagOf(ctx, s.account.flag);
    if (flag) {
      // Flag textures are 16x16 with the banner in the upper part.
      g.drawImage(flag, 0, 0, flag.width, Math.round(flag.height * 0.75), px - nameW / 2 - 19, tagY - 9, 15, 10);
    }
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = "#16162b";
    g.strokeText(s.account.name, px, tagY);
    g.fillStyle = ownerId !== 0 && s.account.userId === ownerId ? NAME_OWNER : NAME_GUEST;
    g.fillText(s.account.name, px, tagY);
  }

  // Watermark: Visit "WORLD" in <Growtopia logo>, bottom right.
  const logo = await loadAsset(path.join(ctx.rootDir, "public", "branding", "renderworld", "growtopia.png"));
  const margin = 14;
  const logoW = 150;
  const logoH = logo ? Math.round((logoW * logo.height) / logo.width) : 0;
  const logoX = OUT_W - logoW - margin;
  const logoY = OUT_H - logoH - 6;
  const baseline = logo ? logoY - 4 : OUT_H - 24;

  const label = `"${world.name}"`;
  g.font = WATERMARK_FONT;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.shadowColor = "rgba(0, 0, 0, 0.55)";
  g.shadowBlur = 3;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = 1;
  const visitW = g.measureText("Visit ").width;
  const labelW = g.measureText(label).width;
  const inW = g.measureText(" in").width;
  const startX = Math.max(margin, OUT_W - margin - (visitW + labelW + inW));
  g.fillStyle = WATERMARK_PINK;
  g.fillText("Visit ", startX, baseline);
  g.fillStyle = "#ffffff";
  g.fillText(label, startX + visitW, baseline);
  g.fillStyle = WATERMARK_PINK;
  g.fillText(" in", startX + visitW + labelW, baseline);
  g.shadowColor = "transparent";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;

  if (logo) g.drawImage(logo, logoX, logoY, logoW, logoH);

  return canvas.toBuffer("image/png");
}

// --- command flow ---------------------------------------------------------

function worldOwnerId(world: WorldInstance): number {
  if (world.ownerUserId) return world.ownerUserId;
  const lock = getWorldLockTile(world);
  return lock?.extra?.kind === "lock" ? lock.extra.ownerUserId : 0;
}

function isWorldOwner(session: PlayerSession): boolean {
  const world = session.world;
  if (!world) return false;
  const owner = worldOwnerId(world);
  return owner !== 0 && owner === session.account.userId;
}

export function handleRenderWorldCommand(session: PlayerSession): void {
  if (!session.world) {
    OnConsoleMessage(session, "`4You must be in a world to render it.``");
    return;
  }
  if (!isWorldOwner(session)) {
    OnConsoleMessage(session, "`4Sorry, only the world owner can render it.``");
    return;
  }
  if (!discordConfigured()) {
    OnConsoleMessage(session, "`4World render is unavailable right now.``");
    return;
  }
  if (!discordStatus(session.account).linked) {
    openDiscordRequiredDialog(session);
    return;
  }
  openWorldRenderDialog(session);
}

function openDiscordRequiredDialog(session: PlayerSession): void {
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wDiscord Not Linked``", DISCORD_ICON_ITEM_ID)
    .addSpacer("small")
    .addTextbox("World renders are posted to our Discord server, so your Discord account has to be linked first.")
    .addTextbox("Link your Discord now, then run /renderworld again.")
    .endDialog("world_render_not_linked", "Cancel", "Link Discord");
  OnDialogRequest(session, dlg);
}

// Same layout/colors as the native World Render dialog.
function openWorldRenderDialog(session: PlayerSession): void {
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wWorld Render``", WORLD_RENDER_ICON)
    .addSpacer("small")
    .addTextbox(
      "World rendering means we'll make a picture of your `5ENTIRE WORLD``, host it on our server publicly, for anybody to view."
    )
    .addTextbox(" ")
    .addTextbox(
      "`4Warning:`` This picture will also include you and all co-owners on your `5World Lock.``"
    )
    .addTextbox("If you'd like to keep that information private, click Cancel!")
    .endDialog("world_render_dialog", "Cancel", "Render it!");
  OnDialogRequest(session, dlg);
}

// Called when the player presses "Render it!".
export async function startWorldRender(ctx: ServerContext, session: PlayerSession): Promise<void> {
  try {
  const world = session.world;
  if (!world) {
    OnConsoleMessage(session, "`4You must be in a world to render it.``");
    return;
  }
  if (!isWorldOwner(session)) {
    OnConsoleMessage(session, "`4Sorry, only the world owner can render it.``");
    return;
  }
  const status = discordStatus(session.account);
  if (!status.linked) {
    openDiscordRequiredDialog(session);
    return;
  }
  const now = Date.now();
  const left = RENDER_COOLDOWN_MS - (now - (lastRenderMs.get(session) ?? 0));
  if (left > 0) {
    OnConsoleMessage(session, `\`4Please wait ${Math.ceil(left / 1000)}s before rendering again.\`\``);
    return;
  }
  lastRenderMs.set(session, now);

  OnConsoleMessage(session, "`2Rendering your world...``");

  let png: Buffer;
  try {
    png = await renderWorldPng(ctx, world);
  } catch (err) {
    console.warn("[WorldRender] render failed", err);
    OnConsoleMessage(session, "`4World render failed.``");
    return;
  }

  if (!ctx.sessions.has(session)) return;
  const content = `**World Render** \`${world.name}\` by ${session.account.name} (Discord @${status.username})`;
  const ok = await sendWorldRenderToDiscord(png, content);
  console.log("[WorldRender] upload", ok ? "ok" : "failed", world.name, png.length, "bytes");
  if (!ctx.sessions.has(session)) return;
  OnConsoleMessage(session, ok ? "`2World render sent!``" : "`4World render could not be sent.``");
  } catch (err) {
    console.warn("[WorldRender] unexpected failure", err);
    OnConsoleMessage(session, "`4World render failed.``");
  }
}
