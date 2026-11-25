import { applyAreaLock, canModifyWorldTile, spawnOrMergeWorldDrop, type WorldInstance } from "../database/world";
import type { ItemDef } from "../database/items";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import {
  makeItemRemovePacket,
  makeTileChangePacket,
  makeTileUpdatePacket,
  TILE_FLAG_LOCKED,
  TILE_FLAG_PUBLIC,
  type WorldTile,
} from "../proton/packet";
import { OnConsoleMessage, broadcastPositionedSfx } from "../onVariant";

const MAIN_DOOR_ID = 6;
const BEDROCK_ID = 8;
const EDIT_RADIUS_TILES = 12;
const MAX_EDIT_COUNT = 1000;
const AREA_LOCK_IDS = new Set([202, 204, 206, 4994]);
const WORLD_LOCK_TIER_IDS = new Set([242, 1796, 5260, 7188, 10410, 11550, 11586, 11902, 12654]);

function protectedTile(ctx: ServerContext, tile: WorldTile): boolean {
  const id = tile.fg || tile.bg;
  if (!id) return false;
  const def = ctx.itemsDb.get(id);
  return id === MAIN_DOOR_ID || id === BEDROCK_ID || !!def?.isLock || !!def?.isBedrock || tile.extra?.kind === "lock";
}

/** Blocks /edit may place. Seeds, clothes and weather machines stay rejected. */
function editableBlock(def: ItemDef | undefined): def is ItemDef {
  return !!def
    && !def.name.startsWith("null_")
    && !def.isSeed
    && !def.isClothing
    && !def.isWeather
    && !def.isBedrock;
}

/** Resolve an item by display name (spaces allowed) or numeric item ID. */
function resolveItem(ctx: ServerContext, raw: string): ItemDef | undefined {
  const needle = raw.trim().toLowerCase();
  if (!needle) return undefined;
  if (/^\d+$/.test(needle)) {
    const byId = ctx.itemsDb.get(Number(needle));
    if (byId && !byId.name.startsWith("null_")) return byId;
  }
  let def = ctx.itemsDb.nameIndex.get(needle);
  if (!def) def = ctx.itemsDb.nameIndex.get(`${needle} block`);
  if (!def) def = ctx.itemsDb.search(needle, 1).find((item) => !item.isSeed);
  return def && !def.name.startsWith("null_") ? def : undefined;
}

/** Resolve a placeable block name/id, accepting "world lock" or "242". */
function resolveBlock(ctx: ServerContext, raw: string): ItemDef | undefined {
  let def = resolveItem(ctx, raw);
  if (def?.isSeed) {
    const block = ctx.itemsDb.get(def.id - 1);
    if (block && !block.isSeed) def = block;
  }
  return editableBlock(def) ? def : undefined;
}

interface Candidate {
  tx: number;
  ty: number;
  tile: WorldTile;
  distance: number;
  jitter: number;
}

function playerTile(session: PlayerSession): { tx: number; ty: number } {
  return {
    tx: Math.floor((session.x + 10) / 32),
    ty: Math.floor((session.y + 15) / 32),
  };
}

/** Only the exact player tile is reserved; everything directly around it stays usable. */
function overlapsPlayer(session: PlayerSession, tx: number, ty: number): boolean {
  const p = playerTile(session);
  return tx === p.tx && ty === p.ty;
}

function nearbyTiles(world: WorldInstance, session: PlayerSession): Candidate[] {
  const origin = playerTile(session);
  const originX = origin.tx;
  const originY = origin.ty;
  const out: Candidate[] = [];
  for (let dy = -EDIT_RADIUS_TILES; dy <= EDIT_RADIUS_TILES; dy++) {
    for (let dx = -EDIT_RADIUS_TILES; dx <= EDIT_RADIUS_TILES; dx++) {
      const distance = dx * dx + dy * dy;
      if (distance > EDIT_RADIUS_TILES * EDIT_RADIUS_TILES) continue;
      const tx = originX + dx;
      const ty = originY + dy;
      if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
      out.push({ tx, ty, tile: world.tiles[ty * world.width + tx], distance, jitter: Math.random() });
    }
  }
  out.sort((a, b) => a.distance - b.distance || a.jitter - b.jitter);
  return out;
}

function broadcastTile(world: WorldInstance, tx: number, ty: number, tile: WorldTile): void {
  const update = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, update, true);
}

function placeBlock(session: PlayerSession, world: WorldInstance, cand: Candidate, def: ItemDef): boolean {
  const tile = cand.tile;
  if (def.isBackground) {
    tile.bg = def.id;
  } else {
    tile.fg = def.id;
    tile.extra = undefined;
    tile.flags &= (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC); // keep locked / public, drop stale visual flags
    tile.damage = 0;
    if (def.isLock || AREA_LOCK_IDS.has(def.id) || WORLD_LOCK_TIER_IDS.has(def.id)) {
      tile.extra = { kind: "lock", settings: 0, ownerUserId: session.account.userId, adminIds: [] };
      if (WORLD_LOCK_TIER_IDS.has(def.id)) {
        world.ownerUserId = session.account.userId;
      } else if (AREA_LOCK_IDS.has(def.id)) {
        const locked = applyAreaLock(world, cand.tx, cand.ty);
        for (const idx of locked) {
          const lx = idx % world.width;
          const ly = Math.floor(idx / world.width);
          broadcastTile(world, lx, ly, world.tiles[idx]);
        }
      }
      broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    } else if (def.isDoor) {
      tile.extra = { kind: "door", label: "", destination: "" };
    } else if (def.isSign) {
      tile.extra = { kind: "sign", label: "Edit me with Wrench!" };
    }
  }
  const place = makeTileChangePacket(session.netId, cand.tx, cand.ty, def.id, 0);
  for (const p of world.peers) p.peer.sendPacket(0, place, true);
  broadcastTile(world, cand.tx, cand.ty, tile);
  return true;
}

function clearBlock(cand: Candidate): boolean {
  const tile = cand.tile;
  if (tile.fg !== 0) {
    tile.fg = 0;
    tile.extra = undefined;
    tile.flags &= (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC);
    tile.damage = 0;
    return true;
  }
  if (tile.bg !== 0) {
    tile.bg = 0;
    return true;
  }
  return false;
}

function parseCount(raw: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return 0;
  return Math.max(0, Math.min(MAX_EDIT_COUNT, n));
}

/** /edit and /unsafeedit. Returns the console summary. */
export function runWorldEdit(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: "edit" | "unsafeedit",
  parts: string[],
  usage: string
): boolean {
  const world = session.world;
  if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
  const action = (parts[1] || "").toLowerCase();
  if (!action || action === "help") { OnConsoleMessage(session, usage); return true; }

  if (action === "clearobject") {
    const count = parseCount(parts[2] || "");
    if (!count) { OnConsoleMessage(session, "Usage: /edit clearobject `p<1-1000>`o - Removes dropped items around you."); return true; }
    const cx = session.x + 16;
    const cy = session.y + 16;
    const radius = EDIT_RADIUS_TILES * 32;
    const picked = world.objects
      .filter((o) => {
        const dx = o.x - cx;
        const dy = o.y - cy;
        return dx * dx + dy * dy <= radius * radius;
      })
      .sort((a, b) => {
        const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
        const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
        return da - db;
      })
      .slice(0, count);
    if (!picked.length) { OnConsoleMessage(session, ">> No dropped items nearby."); return true; }
    const uids = new Set(picked.map((o) => o.uid));
    world.objects = world.objects.filter((o) => !uids.has(o.uid));
    for (const drop of picked) {
      const rm = makeItemRemovePacket(drop.uid);
      for (const p of world.peers) p.peer.sendPacket(0, rm, true);
    }
    OnConsoleMessage(session, "Terraforming world...");
    broadcastPositionedSfx(world, session.netId, "audio/terraform.wav");
    OnConsoleMessage(session, `>> Removed ${picked.length} dropped object${picked.length === 1 ? "" : "s"}.`);
    return true;
  }

  if (action === "addobject") {
    const count = parseCount(parts[2] || "");
    if (!count) { OnConsoleMessage(session, "Usage: /edit addobject `$<1-1000> [object name or id]`o - Drops items around you."); return true; }
    const name = parts.slice(3).join(" ").trim();
    const def = name ? resolveItem(ctx, name) : ctx.itemsDb.get(session.lastChoosenItem || 2);
    if (!def) { OnConsoleMessage(session, ">> Unknown object name or ID.  Example: /edit addobject 3 dirt."); return true; }
    OnConsoleMessage(session, "Terraforming world...");
    // Same PlayerMoving PACKET_ITEM_CHANGE_OBJECT (type 14) packet that
    // ReuGT's dropas_()/ /drop uses. throwerNetId = -1 means the system drops
    // the item, not the player, so there is no throw animation.
    // Build a tight grid around the player: one object per tile, no empty tile
    // between drops (like the reference screenshot). Background blocks are
    // allowed; only foreground blocks, doors, locks and occupied drop tiles
    // are skipped.
    const originX = playerTile(session).tx;
    const originY = playerTile(session).ty;
    const occupiedDropTile = new Set(world.objects.map((o) =>
      `${Math.floor((o.x + 8) / 32)},${Math.floor((o.y + 8) / 32)}`
    ));
    const columns = Math.max(2, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil((count + 1) / columns));
    const startX = -Math.floor(columns / 2);
    const startY = -Math.floor(rows / 2);
    const candidates: Array<{ tx: number; ty: number }> = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const dx = startX + col;
        const dy = startY + row;
        if (Math.abs(dx) > EDIT_RADIUS_TILES || Math.abs(dy) > EDIT_RADIUS_TILES) continue;
        const tx = originX + dx;
        const ty = originY + dy;
        if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
        if (overlapsPlayer(session, tx, ty)) continue;
        const tile = world.tiles[ty * world.width + tx];
        if (tile.fg !== 0 || tile.extra) continue;
        if (occupiedDropTile.has(`${tx},${ty}`)) continue;
        candidates.push({ tx, ty });
      }
    }
    // Row-major fill keeps full rows and leaves no tile-sized gaps.
    candidates.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    let spawned = 0;
    const wanted = Math.min(count, candidates.length);
    for (let i = 0; i < wanted; i++) {
      const pick = candidates[i];
      const drop = spawnOrMergeWorldDrop(world, def.id, 1, pick.tx * 32 + 6, pick.ty * 32 + 6, -1);
      if (drop || def.id === 112) spawned++;
    }
    ctx.dirty = true;
    broadcastPositionedSfx(world, session.netId, "audio/terraform.wav");
    OnConsoleMessage(session, `>> Dropped ${spawned} ${def.name} object${spawned === 1 ? "" : "s"}.`);
    return true;
  }

  if (action === "clear") {
    const count = parseCount(parts[2] || "");
    if (!count) { OnConsoleMessage(session, "Usage: /edit clear `$<1-1000>`o - Clears blocks around you."); return true; }
    OnConsoleMessage(session, "Terraforming world...");
    let changed = 0;
    for (const cand of nearbyTiles(world, session)) {
      if (changed >= count) break;
      if (!cand.tile.fg && !cand.tile.bg) continue;
      if (protectedTile(ctx, cand.tile)) continue;
      if (cmd === "edit" && !canModifyWorldTile(session, world, cand.tile, cand.tx, cand.ty, "break")) continue;
      if (!clearBlock(cand)) continue;
      broadcastTile(world, cand.tx, cand.ty, cand.tile);
      changed++;
    }
    if (changed) {
      ctx.dirty = true;
      broadcastPositionedSfx(world, session.netId, "audio/terraform.wav");
      OnConsoleMessage(session, `>> Cleared ${changed} block${changed === 1 ? "" : "s"}.`);
    } else {
      OnConsoleMessage(session, ">> No blocks could be cleared here.");
    }
    return true;
  }

  if (action !== "add" && action !== "replace") {
    OnConsoleMessage(session, usage);
    return true;
  }

  const count = parseCount(parts[2] || "");
  const def = resolveBlock(ctx, parts.slice(3).join(" "));
  if (!count || !def) {
    OnConsoleMessage(session, usage);
    return true;
  }

  const wantsBackground = def.isBackground;
  let changed = 0;
  OnConsoleMessage(session, "Terraforming world...");
  for (const cand of nearbyTiles(world, session)) {
    if (changed >= count) break;
    if (overlapsPlayer(session, cand.tx, cand.ty)) continue;
    const tile = cand.tile;
    if (protectedTile(ctx, tile)) continue;
    const slotEmpty = wantsBackground ? tile.bg === 0 : tile.fg === 0;
    if (action === "add" && !slotEmpty) continue;
    if (action === "replace" && slotEmpty) continue;
    if (cmd === "edit" && !canModifyWorldTile(session, world, tile, cand.tx, cand.ty, "place")) continue;
    if (placeBlock(session, world, cand, def)) changed++;
  }

  if (changed) {
    ctx.dirty = true;
    broadcastPositionedSfx(world, session.netId, "audio/terraform.wav");
    OnConsoleMessage(session, `>> ${action === "add" ? "Added" : "Replaced"} ${changed} block${changed === 1 ? "" : "s"}.`);
  } else {
    OnConsoleMessage(session, action === "add"
      ? ">> No empty tiles nearby.  Try moving or using /edit replace."
      : ">> No matching tiles nearby.  Try /edit add instead.");
  }
  return true;
}
