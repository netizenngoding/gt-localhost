import { hasRaymanFist, hasEnhancedDigging } from "../playmods/equipment";
import { hasPermission } from "../ranks";
import { activeMods } from "../playmods/model";
import { infectByPunch, useConsumable } from "../playmods/service";
import { recordProgress } from "../progression/service";
import { farmingXp } from "../progression/model";
import { staffInteractionReach } from "../ranks/interaction";
import {
  buildTankPacket,
  defaultMannequinExpression,
  defaultMannequinSkin,
  DROPPED_ITEM_FOREGROUND_FLAG,
  makeItemDropPacket,
  makeItemModifyObjectPacket,
  makeItemRemovePacket,
  makeTileChangePacket,
  makeTileTreeStatePacket,
  makeTileUpdatePacket,
  makeSendLockPacket,
  makeVariantPacket,
  PACKET_ITEM_EFFECT,
  PACKET_SEND_PARTICLE_EFFECT,
  PACKET_TILE_APPLY_DAMAGE,
  TANK_FLAG_FACING_LEFT,
  TILE_FLAG_FLIPPED,
  TILE_FLAG_LOCKED,
  TILE_FLAG_OPEN,
  TILE_FLAG_PUBLIC,
  TILE_FLAG_WATER,
  TILE_FLAG_GLUE,
  TILE_FLAG_BURNT,
  TILE_FLAG_PAINT_MASK,
  TILE_FLAG_PAINT_RED,
  TILE_FLAG_PAINT_YELLOW,
  TILE_FLAG_PAINT_BLUE,
  type DroppedObject,
  type SeedExtra,
  type TankPacket,
  type TileExtra,
  type WorldTile,
} from "../proton/packet";
import type { ServerContext } from "../database/context";
import {
  isIllegalItem,
  isUntradeable,
  WEATHER_BY_ITEM_ID,
  ITEM_FLAG_AUTO_PICKUP,
  ITEM_FLAG_DROPLESS,
  ITEM_FLAG_NO_SEED,
  type ItemDef
} from "../database/items";
import { clearSessionMagplantLink, setSessionMagplantLink, type PlayerSession } from "../database/peer";
import {
  applyAreaLock,
  canManageVending,
  canModifyWorldTile,
  clearAreaLock,
  getBuildersLockDenial,
  getDefaultLockWeather,
  getLockRadiusForId,
  recomputeWorldWeather,
  spawnOrMergeWorldDrop,
  type WorldInstance,
} from "../database/world";
import {
  broadcastConsoleMessage,
  broadcastNameChanged,
  broadcastPositionedSfx,
  broadcastSetCurrentWeather,
  broadcastSetClothing,
  OnTalkBubble,
  broadcastTalkBubble,
  OnConsoleMessage,
  OnDialogRequest,
  OnPlayPositioned,
  OnSetBux,
  OnEmoticonDataChanged,
  RequestWorldSelectMenu,
} from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";
import {
  openDoorSettingsDialog,
  openLockSettingsDialog,
  openSignEditDialog,
  openWeatherPickerDialog,
  openXenoniteDialog,
} from "../action/dialog_return/tile_edit";
import { openVendingOwnerDialog, openVendingBuyerDialog } from "../action/dialog_return/vending";
import { openGrowScanDialog } from "../action/dialog_return/growscan";
import { openSuckerDialog } from "../action/dialog_return/sucker";
import { openLockeDialog, openSalesManUntradeableDialog } from "../action/dialog_return/telephone_locke";
import { getActiveTileAuction, openAuctionBlockDialog } from "../auction/service";
import { handleItemActivateObject } from "./item_activate_object";
import {
  AUTO_ACTION_IDS,
  BOOMBOX_IDS,
  BULLETIN_BOARD_IDS,
  CAMERA_IDS,
  CRYSTAL_IDS,
  DISPLAY_SHELF_IDS,
  DONATION_BOX_IDS,
  GRINDER_IDS,
  MAILBOX_IDS,
  MANNEQUIN_IDS,
  openAutoActionBlockDialog,
  openBulletinOrMailboxDialog,
  openCameraDialog,
  openCrystalExchangeDialog,
  openDisplayBlockDialog,
  openDisplayShelfDialog,
  openDonationBoxDialog,
  openGrinderDialog,
  openMannequinDialog,
  openPaintingEaselDialog,
  openPortraitDialog,
  openStorageBoxDialog,
  openToggleableDialog,
  PAINTING_EASEL_IDS,
  PORTRAIT_IDS,
  STORAGE_BOX_IDS,
  useClothingOnMannequin,
  useCrystalOnCrystal,
  useItemOnDisplayBlock,
  useItemOnDonationBox,
  useItemOnGrinder,
} from "../action/dialog_return/world_blocks";
import { findCombinerRecipe, GTPS3_FISHING_LOOT } from "../database/recipes";
import { toggleWearableItem } from "./item_activate";

const GEM_ITEM_ID = 112;
const AREA_LOCK_IDS = new Set([202, 204, 206, 4994]);
const WORLD_LOCK_TIER_IDS = new Set([242, 1796, 5260, 7188, 10410, 11550, 11586, 11902, 12654]);
// GTPS3 World.h: only these weather machines carry tile extras.
const WEATHER_BG_SPECIAL_IDS = new Set([3694, 5000]);
const WEATHER_STUFF_SPECIAL_IDS = new Set([3832]);

export const WEATHER_MACHINE_MAP: Record<number, number> = WEATHER_BY_ITEM_ID;

export const GROWMOJI_ITEMS = new Set([10114, 8028, 7698, 10116, 12544, 12542]);
export const HAIR_DYE_ITEMS = new Set([3822, 3824, 3826, 3828, 3830]);
export const EYE_ITEMS = new Set([5458, 5460, 5462, 5464, 5466, 6760, 6762, 6764, 6766, 6768]);

// GTPS3 paint particle uses packet 17 with netId/YSpeed 168 and the colour in
// XSpeed. The values are the exact floats from the ReuGT paint case.
const PAINT_PARTICLE_COLOR: Record<number, number> = {
  3478: 65280,
  3480: 16776960,
  3482: 16711680,
  3484: 4294901760,
  3486: 4278190080,
  3488: 4278255360,
  3490: 1010580480,
  3492: 3875520768,
};

// GTPS3 World.h 22313: paint buckets only work while a Paintbrush is equipped,
// glue/water/lighter are handled directly on the target tile.
const PAINTBRUSH_IDS = new Set([3494, 7938]);
const PAINT_BUCKET_BITS: Record<number, number> = {
  3478: TILE_FLAG_PAINT_RED,
  3480: TILE_FLAG_PAINT_RED | TILE_FLAG_PAINT_YELLOW,
  3482: TILE_FLAG_PAINT_YELLOW,
  3484: TILE_FLAG_PAINT_YELLOW | TILE_FLAG_PAINT_BLUE,
  3486: TILE_FLAG_PAINT_BLUE,
  3488: TILE_FLAG_PAINT_RED | TILE_FLAG_PAINT_BLUE,
  3490: TILE_FLAG_PAINT_RED | TILE_FLAG_PAINT_YELLOW | TILE_FLAG_PAINT_BLUE,
  3492: 0,
};

export const FISHING_RODS = new Set([3040, 3010, 2912, 3008, 3100, 5740, 6254, 6256, 6932, 10262, 6258]);
export const BAIT_ITEMS = new Set([2914, 3012, 3014, 3016, 3018, 3020, 5526, 5528]);

interface ProviderDefinition {
  name: string;
  dropId: number;
  dropCount: number;
  sfx: string;
  isGems?: boolean;
}

const PROVIDER_DEFINITIONS: Record<number, ProviderDefinition> = {
  1008: { name: "ATM Machine", dropId: 112, dropCount: 50, sfx: "audio/coin.wav", isGems: true },
  5196: { name: "ATM 3000", dropId: 112, dropCount: 100, sfx: "audio/coin.wav", isGems: true },
  866: { name: "Cow", dropId: 868, dropCount: 1, sfx: "audio/moo.wav" },
  872: { name: "Chicken", dropId: 874, dropCount: 1, sfx: "audio/cluck.wav" },
  1044: { name: "Buffalo", dropId: 868, dropCount: 1, sfx: "audio/moo.wav" },
  3888: { name: "Sheep", dropId: 3890, dropCount: 1, sfx: "audio/bubble.wav" },
  1632: { name: "Coffee Maker", dropId: 1634, dropCount: 1, sfx: "audio/bubble.wav" },
  5116: { name: "Tea Set", dropId: 5114, dropCount: 1, sfx: "audio/bubble.wav" },
  2798: { name: "Well", dropId: 822, dropCount: 1, sfx: "audio/splash.wav" },
  3044: { name: "Tackle Box", dropId: 2914, dropCount: 1, sfx: "audio/bubble.wav" },
  928: { name: "Science Station", dropId: 914, dropCount: 1, sfx: "audio/bubble.wav" },
  4584: { name: "Science Station", dropId: 914, dropCount: 1, sfx: "audio/bubble.wav" },
  6212: { name: "Surgical Tool Bag", dropId: 1258, dropCount: 1, sfx: "audio/bubble.wav" },
};

function finishFishing(ctx: ServerContext, session: PlayerSession, world: WorldInstance): void {
  if (!session.fishing) return;
  const f = session.fishing;
  session.fishing = null;

  const lootTable = GTPS3_FISHING_LOOT[f.baitId] || [846, 344, 3000];
  const caughtId = lootTable[Math.floor(Math.random() * lootTable.length)];
  const caughtDef = ctx.itemsDb.get(caughtId);
  const caughtName = caughtDef ? stripGtColors(caughtDef.name) : "Fish";
  const weight = Math.floor(Math.random() * 20) + 1;

  ctx.giveInventoryItem(session, caughtId, 1, true);
  broadcastPositionedSfx(world, session.netId, "audio/splash.wav");
  const msg = `You caught a \`2${weight} lb. ${caughtName}!\`\``;
  OnTalkBubble(session, session.netId, msg, 0, true);
  OnConsoleMessage(session, msg);
}

function lockedMessage(
  ctx: ServerContext,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  mode: "place" | "break" | "wrench" = "place",
  uid = 0
): string {
  const customDenial = getBuildersLockDenial(world, uid, tile, tx, ty, mode);
  if (customDenial) return customDenial;
  let id = tile.extra?.kind === "lock" ? tile.extra.ownerUserId : 0;
  if (!id && world.ownerUserId) id = world.ownerUserId;
  if (!id && (tile.flags & TILE_FLAG_LOCKED) !== 0 && tile.parentIndex > 0 && tile.parentIndex < world.tiles.length) {
    const pt = world.tiles[tile.parentIndex];
    if (pt?.extra?.kind === "lock") id = pt.extra.ownerUserId;
  }
  if (!id) {
    for (let y = Math.max(0, ty - 10); y <= Math.min(world.height - 1, ty + 10) && !id; y++) {
      for (let x = Math.max(0, tx - 10); x <= Math.min(world.width - 1, tx + 10); x++) {
        const lock = world.tiles[y * world.width + x], r = getLockRadiusForId(lock.fg);
        if (r > 0 && lock.extra?.kind === "lock" && Math.abs(x - tx) <= r && Math.abs(y - ty) <= r) {
          id = lock.extra.ownerUserId;
          break;
        }
      }
    }
  }
  const name = (ctx.findAccountByUserId(id)?.name || "someone").replace(/[^A-Za-z0-9_]/g, "");
  return "That area is owned by `w" + name + "``";
}

/**
 * Dye / eye-drop / contact-lens consumables (GTPS3 World.h apply_dye, 18042-18140).
 * Runs before the placement branch: these are actionType 8 consumables, and the
 * old placement fallthrough let them be placed as ordinary blocks.
 */
const DYE_SPEC: Record<number, [number, number, number, number, boolean]> = {
  3822: [0x0000ffff, 16, -16, -16, false],
  3824: [0x00ff00ff, -16, 16, -16, false],
  3826: [0xff0000ff, -16, -16, 16, false],
  3828: [0x000000ff, -16, -16, -16, false],
  3830: [0xffffffff, 32, 32, 32, true],
  5458: [0x0000ffff, 16, -16, -16, false],
  5460: [0x00ff00ff, -16, 16, -16, false],
  5462: [0xff0000ff, -16, -16, 16, false],
  5464: [0x000000ff, -16, -16, -16, false],
  5466: [0xffffffff, 32, 32, 32, true],
  6760: [0x0000ffff, 32, -16, -16, false],
  6762: [0x00ff00ff, -16, 32, -16, false],
  6764: [0xff0000ff, -16, -16, 32, false],
  6766: [0x000000ff, -32, -32, -32, false],
  6768: [0xffffffff, 32, 32, 32, true],
};

function useDyeItem(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  itemId: number,
  tx: number,
  ty: number,
  playerTileX: number,
  playerTileY: number
): boolean {
  const isHair = HAIR_DYE_ITEMS.has(itemId);
  const kind: "hair" | "drops" | "lenses" = isHair ? "hair" : itemId >= 6760 ? "lenses" : "drops";
  const spec = DYE_SPEC[itemId];
  if (!spec) return false;
  const pTileX = Math.floor(playerTileX);
  const pTileY = Math.floor(playerTileY);
  if (Math.abs(tx - pTileX) > 1 || Math.abs(ty - pTileY) > 1) {
    OnTalkBubble(session, session.netId, "(Must be used on yourself)", 0, true);
    return true;
  }
  const pTile = world.tiles[pTileY * world.width + pTileX];
  const cTile = world.tiles[ty * world.width + tx];
  const hasFixture = isHair
    ? (pTile?.fg === 230 || pTile?.fg === 6158 || cTile?.fg === 230 || cTile?.fg === 6158)
    : (pTile?.fg === 5468 || pTile?.fg === 7740 || cTile?.fg === 5468 || cTile?.fg === 7740);
  if (!hasFixture) {
    OnTalkBubble(
      session,
      session.netId,
      isHair
        ? "You'll make a huge mess if you do that outside the Bathtub!"
        : "You'd better do that in front of a bathroom mirror or you'll poke your eye out!",
      0,
      true
    );
    return true;
  }
  const [targetColorRaw, baseDr, baseDg, baseDb, isCleaner] = spec;
  const targetColor = targetColorRaw >>> 0;
  const curRaw =
    kind === "hair" ? session.account.hairColor : kind === "drops" ? session.account.eyeColor : session.account.pupilColor;
  const cur = (curRaw && curRaw !== 0 ? curRaw : 0xffffffff) >>> 0;
  if (cur === targetColor) {
    const alreadyMsg =
      kind === "hair"
        ? isCleaner ? "Your hair is already clean!" : "Your hair is already that color!"
        : kind === "drops"
        ? isCleaner ? "Your eyes are already clean!" : "Your eyes are already that color!"
        : isCleaner ? "Your lenses are already clean!" : "Your pupils are already that color!";
    OnTalkBubble(session, session.netId, alreadyMsg, 0, true);
    return true;
  }
  let dr = baseDr, dg = baseDg, db = baseDb;
  if (kind === "lenses" && !isCleaner && cur === 0xffffffff) { dr *= 9; dg *= 9; db *= 9; }
  // Little-endian uint32 colour: [0]=A, [1]=R, [2]=G, [3]=B.
  const a = cur & 0xff || 0xff;
  const r = Math.max(0, Math.min(255, ((cur >>> 8) & 0xff) + dr));
  const g = Math.max(0, Math.min(255, ((cur >>> 16) & 0xff) + dg));
  const b = Math.max(0, Math.min(255, ((cur >>> 24) & 0xff) + db));
  const nextColor = (((b << 24) | (g << 16) | (r << 8) | a) >>> 0);
  if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
  if (kind === "hair") {
    session.account.hairColor = nextColor;
    broadcastPositionedSfx(world, session.netId, "audio/water_splash.wav");
    const actPkt = makeVariantPacket(["OnAction", "/shower"], session.netId);
    for (const p of world.peers) p.peer.sendPacket(0, actPkt, true);
    OnTalkBubble(session, session.netId, isCleaner ? "Your hair got cleaner!" : "You dyed your hair!", 0, true);
  } else if (kind === "drops") {
    session.account.eyeColor = nextColor;
    broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    OnTalkBubble(session, session.netId, isCleaner ? "Your eyes got cleaner!" : "You used eye drops!", 0, true);
  } else {
    session.account.pupilColor = isCleaner && nextColor === 0xffffffff ? 0 : nextColor;
    broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    OnTalkBubble(
      session,
      session.netId,
      isCleaner ? "Your lenses got cleaner!" : "You put in some contact lenses!",
      0,
      true
    );
  }
  ctx.dirty = true;
  ctx.savePlayersNow();
  ctx.sendCharacterState(session);
  return true;
}

function isProtectedPaintTile(ctx: ServerContext, tile: WorldTile): boolean {
  const fg = tile.fg ? ctx.itemsDb.get(tile.fg) : undefined;
  return !!(
    tile.fg === 9570 ||
    tile.fg === 6 ||
    tile.fg === 8 ||
    fg?.isLock ||
    fg?.isDoor ||
    fg?.isBedrock
  );
}

function broadcastTileUpdate(ctx: ServerContext, world: WorldInstance, tx: number, ty: number, tile: WorldTile): void {
  const pkt = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
  ctx.dirty = true;
}

/** ReuGT type-19 item-use animation used by glue/water/lighter placement. */
function broadcastTileUseEffect(
  world: WorldInstance,
  session: PlayerSession,
  tx: number,
  ty: number,
  itemId: number
): void {
  // GTPS3 World.h glue/water/lighter: count2=4, punchY=1, target netID in int_dat.
  const pkt = buildTankPacket({
    type: PACKET_ITEM_EFFECT,
    count2: 4,
    netId: 0,
    targetNetId: session.netId,
    value: 0,
    punchX: itemId,
    punchY: 1,
    x: tx * 32 + 16,
    y: ty * 32 + 16,
  });
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}

/** ReuGT type-17 paint splash particle (colour is carried in XSpeed). */
function broadcastPaintParticle(world: WorldInstance, tx: number, ty: number, color: number): void {
  const pkt = buildTankPacket({
    type: PACKET_SEND_PARTICLE_EFFECT,
    netId: 168,
    x: tx * 32 + 16,
    y: ty * 32 + 16,
    speedX: color,
    speedY: 168,
  });
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}

function denyTileUse(ctx: ServerContext, session: PlayerSession, world: WorldInstance, tile: WorldTile, tx: number, ty: number): boolean {
  if (canModifyWorldTile(session, world, tile, tx, ty, "place")) return false;
  OnPlayPositioned(session, "audio/punch_locked.wav");
  OnTalkBubble(session, session.netId, lockedMessage(ctx, world, tile, tx, ty, "place", session.account.userId), 0, true);
  return true;
}

/** GTPS3 World.h 22313: water bucket, glue, and pocket lighter tile toggles. */
function useUtilityTileItem(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (itemId !== 822 && itemId !== 1866 && itemId !== 3062) return false;
  if (denyTileUse(ctx, session, world, tile, tx, ty)) return true;

  if (itemId === 3062) {
    if (isProtectedPaintTile(ctx, tile)) {
      OnTalkBubble(session, session.netId, "That won't burn!", 0, true);
      return true;
    }
    // AstroSource WorldInfo.h:28170 only allows the lighter on a real
    // foreground block. A background-only tile has no native fire render pass.
    if (tile.fg === 0) {
      OnTalkBubble(session, session.netId, "There's nothing to burn!", 0, true);
      return true;
    }
    if ((tile.flags & TILE_FLAG_BURNT) !== 0) {
      OnTalkBubble(session, session.netId, "That's already burning!", 0, true);
      return true;
    }
    if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
    // Pocket Lighter is not placed: it only lights the tile immediately.
    // Water on the tile evaporates, and the client draws the native fire
    // overlay straight from the tile flag update.
    tile.flags &= ~TILE_FLAG_WATER;
    tile.flags |= TILE_FLAG_BURNT;
    OnTalkBubble(session, session.netId, "`4Fire! Fire!``", 0, true);
    broadcastPositionedSfx(world, session.netId, "audio/spray.wav");
    recordProgress(ctx, session, undefined, 1, 1);
  } else if (itemId === 1866) {
    // Glue belongs to the tile. Removing it does not consume a second Glue.
    if ((tile.flags & TILE_FLAG_GLUE) === 0 && !ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
    tile.flags ^= TILE_FLAG_GLUE;
  } else {
    const wasBurning = (tile.flags & TILE_FLAG_BURNT) !== 0;
    const hasWater = (tile.flags & TILE_FLAG_WATER) !== 0;
    if (wasBurning) {
      // Dousing a fire uses the bucket but must not leave a water tile behind.
      if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
      tile.flags &= ~TILE_FLAG_BURNT;
      OnTalkBubble(session, session.netId, "The fire's out.", 0, true);
    } else if (hasWater) {
      // Picking the water back up does not consume another bucket.
      tile.flags &= ~TILE_FLAG_WATER;
    } else {
      if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
      tile.flags |= TILE_FLAG_WATER;
    }
    broadcastPositionedSfx(world, session.netId, "audio/water_splash.wav");
  }

  broadcastTileUpdate(ctx, world, tx, ty, tile);
  // The lighter has no placement animation: the fire overlay is the effect.
  if (itemId !== 3062) broadcastTileUseEffect(world, session, tx, ty, itemId);
  return true;
}

/** GTPS3 World.h 22313: paint buckets require an equipped Paintbrush. */
function usePaintBucket(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  const bits = PAINT_BUCKET_BITS[itemId];
  if (bits === undefined) return false;
  if (denyTileUse(ctx, session, world, tile, tx, ty)) return true;

  const hasBrush = session.account.inventory.some(
    (s) => s.equipped && s.count > 0 && PAINTBRUSH_IDS.has(s.itemId)
  );
  if (!hasBrush) {
    OnTalkBubble(session, session.netId, "You need a Paintbrush to apply paint!", 0, true);
    return true;
  }
  if (tile.fg === 0 && tile.bg === 0) {
    OnTalkBubble(session, session.netId, "There's nothing to paint!", 0, true);
    return true;
  }
  if (isProtectedPaintTile(ctx, tile)) {
    OnTalkBubble(session, session.netId, "That's too special to paint.", 0, true);
    return true;
  }

  const current = tile.flags & TILE_FLAG_PAINT_MASK;
  if (itemId === 3492) {
    if (current === 0) {
      OnTalkBubble(session, session.netId, "Don't waste your varnish on an unpainted block!", 0, true);
      return true;
    }
    if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
    tile.flags &= ~TILE_FLAG_PAINT_MASK;
  } else {
    if (current === bits) {
      OnTalkBubble(session, session.netId, "That block is already painted that color!", 0, true);
      return true;
    }
    if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
    tile.flags = (tile.flags & ~TILE_FLAG_PAINT_MASK) | bits;
  }

  broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
  broadcastTileUpdate(ctx, world, tx, ty, tile);
  broadcastPaintParticle(world, tx, ty, PAINT_PARTICLE_COLOR[itemId] ?? 0);
  return true;
}

export function handleTileActivateRequest(
  ctx: ServerContext,
  session: PlayerSession,
  tank: TankPacket
): void {
  const world = session.world;
  if (!world) return;
  const tx = tank.punchX ?? -1;
  const ty = tank.punchY ?? -1;
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return;

  const tile = world.tiles[ty * world.width + tx];
  const def = tile.fg ? ctx.itemsDb.get(tile.fg) : ctx.itemsDb.get(tile.bg);

  if (tile.fg === 6 || def?.isDoor) {
    if (tile.fg === 6) {
      // A white door is activated only while the avatar's center is in its tile.
      if (Math.floor((session.x + 10) / 32) !== tx || Math.floor((session.y + 15) / 32) !== ty) return;
    } else if (Math.abs(session.x + 10 - (tx * 32 + 16)) > 48 || Math.abs(session.y + 15 - (ty * 32 + 16)) > 64) return;
    const extra = tile.extra;
    // A Main Door exits regardless of stale/malicious destination metadata.
    if (tile.fg === 6) {
      OnPlayPositioned(session, "audio/door_open.wav");
      ctx.exitToWorldSelect(session);
    } else if (extra?.kind === "door" && extra.destination) {
      OnPlayPositioned(session, "audio/door_open.wav");
      ctx.joinWorld(session, extra.destination);
    } else if (canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      openDoorSettingsDialog(session, tx, ty);
    } else {
      OnPlayPositioned(session, "audio/punch_locked.wav");
      OnConsoleMessage(session, "`4This door is not linked!``");
    }
    return;
  }

  // Non-door tile activation must also be local; never accept a remote checkpoint.
  if (Math.abs(session.x + 10 - (tx * 32 + 16)) > 48 || Math.abs(session.y + 15 - (ty * 32 + 16)) > 64) return;
  if (tile.fg === 23) {
    session.account.spawnWorld = world.name;
    session.account.spawnX = tx * 32;
    session.account.spawnY = ty * 32;
    ctx.savePlayersNow();
    OnPlayPositioned(session, "audio/switch.wav");
    OnConsoleMessage(session, "`2Checkpoint saved!``");
    return;
  }

  if (def?.isWeather && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
    OnPlayPositioned(session, "audio/switch.wav");
    openWeatherPickerDialog(session, tx, ty, ctx);
    return;
  }

  if (tile.extra?.kind === "sign" && tile.extra.label) {
    OnConsoleMessage(session, `\`9Sign: \`w${tile.extra.label}\`\``);
  }
}

export function handleTileChangeRequest(
  ctx: ServerContext,
  session: PlayerSession,
  tank: TankPacket
): void {
  const world = session.world;
  if (!world) return;
  const tx = tank.punchX ?? -1;
  const ty = tank.punchY ?? -1;
  const itemId = tank.value ?? 18;
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return;

  const playerTileX = (session.x + 10) / 32;
  const playerTileY = (session.y + 15) / 32;
  const def = ctx.itemsDb.get(itemId);
  let reach = 6.5;
  let punchLine = 0;

  if (hasRaymanFist(session.account)) {
    reach = 12;
    punchLine = 3;
  }

  // Keep authorized staff requests consistent with the advertised native range.
  // Silently rejecting a native far request reproduced a reconnect ~9s later.
  // Account rank is authoritative; never trust client mstate/smstate here.
  reach = staffInteractionReach(session.account) ?? reach;
  if (Math.abs(tx - playerTileX) > reach || Math.abs(ty - playerTileY) > reach) return;

  const tile = world.tiles[ty * world.width + tx];
  const now = Date.now();

  // 1. Wrench (id 32)
  if (itemId === 32) {
    if (tile.extra?.kind === "door") {
      if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
        OnTalkBubble(session, session.netId, lockedMessage(ctx, world, tile, tx, ty, "wrench", session.account.userId), 0, true);
        return;
      }
      openDoorSettingsDialog(session, tx, ty);
      return;
    }
    if (tile.extra?.kind === "sign") {
      if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
        OnTalkBubble(session, session.netId, lockedMessage(ctx, world, tile, tx, ty, "wrench", session.account.userId), 0, true);
        return;
      }
      openSignEditDialog(session, tx, ty);
      return;
    }
    if (tile.fg && tile.extra?.kind === "lock") {
      const uid = session.account.userId;
      if (
        tile.extra.ownerUserId === uid ||
        tile.extra.adminIds.includes(uid) ||
        hasPermission(session.account, "debug")
      ) {
        openLockSettingsDialog(ctx, session, tx, ty);
        return;
      }
    }
    if (tile.fg === 2072 && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      openXenoniteDialog(ctx, session, tx, ty);
      return;
    }
    if (tile.fg && ctx.itemsDb.get(tile.fg)?.isWeather && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      openWeatherPickerDialog(session, tx, ty, ctx);
      return;
    }
    if (tile.fg && tile.extra?.kind === "seed") {
      const treeDef = ctx.itemsDb.get(tile.fg);
      if (treeDef) {
        const ageSec = Math.max(0, Math.floor((now - tile.extra.plantedAtMs) / 1000));
        const growSec = Math.max(1, treeDef.growTime || 15);
        const ready = ageSec >= growSec;
        const remSec = Math.max(0, growSec - ageSec);
        const mins = Math.floor(remSec / 60);
        const secs = remSec % 60;
        const status = ready
          ? "`2Ready to harvest!``"
          : mins > 0
          ? `\`w${mins}m ${secs}s\`\` left`
          : `\`w${secs}s\`\` left`;
        const dlg = new DialogBuilder()
          .setDefaultColor("`o")
          .addLabelWithIcon("big", `\`w${stripGtColors(treeDef.name)}\`\``, tile.fg)
          .addTextbox(`Status: ${status}`)
          .addTextbox(
            `Fruits on tree: \`w${tile.extra.fruitCount}\`\`${tile.extra.spliced ? " `5(Spliced)``" : ""}`
          )
          .addQuickExit()
          .endDialog("tree_info", "Close", "");
        OnDialogRequest(session, dlg);
      }
    }
    // Vending Machine / DigiVend wrench (GTPS3 World.h:20508)
    if (tile.fg === 2978 || tile.fg === 9268) {
      if (Math.abs(tx * 32 - session.x) > 24 || Math.abs(ty * 32 - session.y) > 24) {
        OnTalkBubble(session, session.netId, "Get closer!", 0, true);
        return;
      }
      if (canManageVending(session, world, tile)) {
        openVendingOwnerDialog(ctx, session, world, tile, tx, ty);
      } else {
        openVendingBuyerDialog(ctx, session, world, tile, tx, ty);
      }
      return;
    }
    // Magnolia World Block Wrench Handlers
    if (tile.fg === 15546 || tile.fg === 15610) { openAuctionBlockDialog(ctx, session, world, tile, tx, ty); return; }
    if (tile.fg === 2946) { openDisplayBlockDialog(ctx, session, world, tile, tx, ty); return; }
    if (PAINTING_EASEL_IDS.has(tile.fg)) { openPaintingEaselDialog(ctx, session, world, tile, tx, ty); return; }
    if (PORTRAIT_IDS.has(tile.fg)) { openPortraitDialog(ctx, session, world, tile, tx, ty); return; }
    if (DISPLAY_SHELF_IDS.has(tile.fg)) { openDisplayShelfDialog(ctx, session, world, tile, tx, ty); return; }
    if (DONATION_BOX_IDS.has(tile.fg)) { openDonationBoxDialog(ctx, session, world, tile, tx, ty); return; }
    if (MAILBOX_IDS.has(tile.fg) || BULLETIN_BOARD_IDS.has(tile.fg)) { openBulletinOrMailboxDialog(ctx, session, world, tile, tx, ty); return; }
    if (STORAGE_BOX_IDS.has(tile.fg)) { openStorageBoxDialog(ctx, session, world, tile, tx, ty); return; }
    if (CAMERA_IDS.has(tile.fg)) { openCameraDialog(ctx, session, world, tile, tx, ty); return; }
    if (MANNEQUIN_IDS.has(tile.fg)) { openMannequinDialog(ctx, session, world, tile, tx, ty); return; }
    if (AUTO_ACTION_IDS.has(tile.fg)) { openAutoActionBlockDialog(ctx, session, world, tile, tx, ty); return; }
    if (GRINDER_IDS.has(tile.fg)) { openGrinderDialog(ctx, session, tile); return; }
    if (CRYSTAL_IDS.has(tile.fg)) { openCrystalExchangeDialog(ctx, session, world, tile, tx, ty); return; }
    const wrenchTargetDef = tile.fg ? ctx.itemsDb.get(tile.fg) : undefined;
    if (BOOMBOX_IDS.has(tile.fg) || wrenchTargetDef?.actionType === 9 || wrenchTargetDef?.actionType === 12 || wrenchTargetDef?.actionType === 31 || wrenchTargetDef?.actionType === 36) {
      openToggleableDialog(ctx, session, world, tile, tx, ty);
      return;
    }
    // GrowScan 9000 wrench (GTPS3 World.h:20478)
    if (tile.fg === 6016) {
      openGrowScanDialog(session, world);
      return;
    }
    // Magplant 5000, Heart of Gaia, & Unstable Tesseract wrench (GTPS3 World.h:20700)
    if (tile.fg === 5638 || tile.fg === 6948 || tile.fg === 6946) {
      openSuckerDialog(ctx, session, world, tile, tx, ty);
      return;
    }
    // Telephone wrench dialog (GTPS3 World.h:20367)
    if (tile.fg === 3898 || tile.bg === 3898) {
      session.lastWrenchX = tx;
      session.lastWrenchY = ty;
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wTelephone``", 3898)
        .addTextbox("Dial a number to call somebody in Growtopia. Phone numbers have 5 digits, like 12345 (try it - you'd be crazy not to!). Most numbers are not in service!")
        .addTextInput("buttonClicked", "Phone #", "", 5)
        .addQuickExit()
        .endDialog("3898", "Hang Up", "Dial");
      OnDialogRequest(session, dlg);
      return;
    }
    // Locke GTPS Salesman (GTPS3 World.h:18152)
    if (tile.fg === 9828 || tile.bg === 9828) {
      session.lastWrenchX = tx;
      session.lastWrenchY = ty;
      openLockeDialog(ctx, session);
      return;
    }
    // Sales-Man Untradeable (GTPS3 World.h:20505)
    if (tile.fg === 9528 || tile.bg === 9528) {
      session.lastWrenchX = tx;
      session.lastWrenchY = ty;
      openSalesManUntradeableDialog(ctx, session);
      return;
    }
    if (tile.fg && PROVIDER_DEFINITIONS[tile.fg]) {
      const prov = PROVIDER_DEFINITIONS[tile.fg];
      const lastHarvest = (tile.extra as any)?.lastProviderClaim || 0;
      const cooldownMs = 60000;
      const ready = now - lastHarvest >= cooldownMs;
      const remSec = Math.max(0, Math.ceil((cooldownMs - (now - lastHarvest)) / 1000));
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", `\`w${prov.name}\`\``, tile.fg)
        .addTextbox(ready ? "`2Ready to harvest! Punch to collect.``" : `Status: Recharging (\`2${remSec}s\`\` left)`)
        .addQuickExit()
        .endDialog("provider_info", "Close", "");
      OnDialogRequest(session, dlg);
      return;
    }
    return;
  }

  // 2. Fist / Punch (id 18)
  if (itemId === 18) {
    if ((tile.fg === 15546 || tile.fg === 15610) && getActiveTileAuction(world.name, tx, ty)) {
      OnTalkBubble(session, session.netId, "Can't break an Auction Block while an auction is active!", 0, true);
      return;
    }
    // Fishing catch/reel-in (GTPS3 World.h:3095)
    if (session.fishing) {
      finishFishing(ctx, session, world);
      return;
    }

    // Chemical Combiner / Laboratory 3-item combine (GTPS3 World.h:18648)
    if (tile.fg === 926 || (tile.fg && ctx.itemsDb.get(tile.fg)?.name.includes("Combiner")) || (tile.fg && ctx.itemsDb.get(tile.fg)?.name.includes("Laboratory"))) {
      const dropsOnTile = world.objects.filter(obj => Math.floor(obj.x / 32) === tx && Math.floor(obj.y / 32) === ty && obj.count > 0);
      if (dropsOnTile.length < 3) {
        OnTalkBubble(session, session.netId, "I need 3 ingredients!", 0, true);
        return;
      }
      if (dropsOnTile.length > 3) {
        OnTalkBubble(session, session.netId, "It won't mix more than 3 items at once!", 0, true);
        return;
      }
      const recipe = findCombinerRecipe(dropsOnTile);
      if (recipe) {
        for (const [ingId, reqCount] of recipe.ingredients) {
          const drop = dropsOnTile.find(d => d.itemId === ingId)!;
          drop.count -= reqCount;
          if (drop.count <= 0) {
            world.objects = world.objects.filter(o => o.uid !== drop.uid);
            const rmPkt = makeItemRemovePacket(drop.uid);
            for (const p of world.peers) p.peer.sendPacket(0, rmPkt, true);
          } else {
            const modPkt = makeItemModifyObjectPacket(drop.uid, drop.itemId, drop.count, drop.x, drop.y, drop.flags);
            for (const p of world.peers) p.peer.sendPacket(0, modPkt, true);
          }
        }
        spawnOrMergeWorldDrop(world, recipe.result[0], recipe.result[1], tx * 32 + 16, ty * 32 + 16, session.netId);
        broadcastPositionedSfx(world, session.netId, "audio/success.wav");
        const outDef = ctx.itemsDb.get(recipe.result[0]);
        const outName = outDef ? stripGtColors(outDef.name) : "item";
        OnTalkBubble(session, session.netId, `\`2Combined to create ${outName}!\`\``, 0, true);
        return;
      } else {
        OnTalkBubble(session, session.netId, "These items won't combine into anything.", 0, true);
        return;
      }
    }

    // Weather machine punch toggle (GTPS3 World.h:18781, 1.5s cooldown & 0x40 active bit)
    // Toggle runs with a 1.5s cooldown without blocking punch break damage (`doBreak`).
    if (tile.fg && ctx.itemsDb.get(tile.fg)?.isWeather && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      if (!tile.lastPunchWeatherMs || now - tile.lastPunchWeatherMs >= 1500) {
        tile.lastPunchWeatherMs = now;
        const targetWeather = ctx.itemsDb.getWeatherIdForBlock(tile.fg);
        const wasActive = (tile.flags & TILE_FLAG_OPEN) !== 0 || world.weatherId === targetWeather;
        if (wasActive) {
          tile.flags &= ~TILE_FLAG_OPEN;
          recomputeWorldWeather(world, ctx.itemsDb);
        } else {
          for (let i = 0; i < world.tiles.length; i++) {
            const ot = world.tiles[i];
            if (ot !== tile && ot.fg !== 0 && (ot.flags & TILE_FLAG_OPEN) !== 0 && ctx.itemsDb.get(ot.fg)?.isWeather) {
              ot.flags &= ~TILE_FLAG_OPEN;
              const ox = i % world.width;
              const oy = Math.floor(i / world.width);
              const clearedUpd = makeTileUpdatePacket(ox, oy, ot, now);
              for (const p of world.peers) p.peer.sendPacket(0, clearedUpd, true);
            }
          }
          tile.flags |= TILE_FLAG_OPEN;
          world.weatherId = targetWeather;
        }
        ctx.dirty = true;
        const upd = makeTileUpdatePacket(tx, ty, tile, now);
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        broadcastSetCurrentWeather(world, world.weatherId);
        broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
      }
    }

    // Jammer / Anti-Gravity punch toggle (226 Signal, 1276 Punch, 1278 Zombie, 4884 Balloon, 4992 Anti-Gravity)
    if ((tile.fg === 226 || tile.fg === 1276 || tile.fg === 1278 || tile.fg === 4884 || tile.fg === 4992) && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      if (!tile.lastPunchWeatherMs || now - tile.lastPunchWeatherMs >= 1500) {
        tile.lastPunchWeatherMs = now;
        if ((tile.flags & TILE_FLAG_OPEN) !== 0) tile.flags &= ~TILE_FLAG_OPEN;
        else tile.flags |= TILE_FLAG_OPEN;
        ctx.dirty = true;
        const upd = makeTileUpdatePacket(tx, ty, tile, now);
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
        if (tile.fg === 4992) {
          for (const p of world.peers) ctx.sendCharacterState(p);
        }
      }
    }

    // Magplant 5000 (5638) punch toggle magnetron mode when item is configured (GTPS3 World.h:18807-18928)
    if (tile.fg === 5638 && tile.extra?.kind === "sucker" && tile.extra.itemId > 0 && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      const mDef = ctx.itemsDb.get(tile.extra.itemId);
      if (!mDef || mDef.isSeed || mDef.isLock || mDef.isBackground) {
        OnTalkBubble(session, session.netId, "Cannot activate the MAGPLANT 5000, the current item cannot be placed.", 0, true);
        OnConsoleMessage(session, "Cannot activate the MAGPLANT 5000, the current item cannot be placed.");
        return;
      }
      if (!tile.extra.magnetron) {
        tile.extra.magnetron = true;
        const hasRemote = session.account.inventory.some((s) => s.itemId === 5640 && s.count > 0);
        if (!hasRemote) {
          if (ctx.giveInventoryItem(session, 5640, 1, true) > 0) {
            OnTalkBubble(session, session.netId, "You received a MAGPLANT 5000 Remote.", 0, true);
            OnConsoleMessage(session, "You received a MAGPLANT 5000 Remote.");
          }
        }
        setSessionMagplantLink(session, world.name, tx, ty, tile.extra.itemId);
      } else {
        tile.extra.magnetron = false;
        for (const p of world.peers) {
          if (p.magplantRemote && p.magplantRemote.x === tx && p.magplantRemote.y === ty) {
            clearSessionMagplantLink(p, world.name, true);
          }
        }
      }
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(tx, ty, tile, now);
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
      return;
    }
    if (tile.fg && PROVIDER_DEFINITIONS[tile.fg] && canModifyWorldTile(session, world, tile, tx, ty)) {
      const prov = PROVIDER_DEFINITIONS[tile.fg];
      const lastHarvest = (tile.extra as any)?.lastProviderClaim || 0;
      const cooldownMs = 60000;
      if (now - lastHarvest >= cooldownMs) {
        tile.extra = { ...(tile.extra || {}), kind: "provider", lastProviderClaim: now } as any;
        ctx.dirty = true;
        if (prov.isGems) {
          session.account.gems = (session.account.gems || 0) + prov.dropCount;
          ctx.savePlayersNow();
          OnSetBux(session);
          broadcastPositionedSfx(world, session.netId, prov.sfx);
          OnTalkBubble(session, session.netId, `\`2+${prov.dropCount} Gems collected from ${prov.name}!\`\``, 0, true);
        } else {
          spawnOrMergeWorldDrop(world, prov.dropId, prov.dropCount, tx * 32 + 16, ty * 32 + 16, session.netId);
          broadcastPositionedSfx(world, session.netId, prov.sfx);
          OnTalkBubble(session, session.netId, `\`2Harvested from ${prov.name}!\`\``, 0, true);
        }
        return;
      }
    }
    infectByPunch(ctx,session,tx,ty);
    if (tile.fg === 6 && !hasPermission(session.account, "debug")) {
      // Punch requests are not activation requests. The client sends type 7
      // when entering the door; remote punches must never exit the world.
      OnTalkBubble(session, session.netId, "(stand over and punch to use)", 0, true);
      return;
    }
    const doBreak = (bx: number, by: number): boolean => {
      if (bx < 0 || bx >= world.width || by < 0 || by >= world.height) return false;
      const bt = world.tiles[by * world.width + bx];
      const bId = bt.fg !== 0 ? bt.fg : bt.bg;
      if (bId === 0) {
        broadcastPositionedSfx(world, session.netId, "audio/punch_miss.wav");
        return false;
      }
      const bDef = ctx.itemsDb.get(bId);
      if (!bDef || ((bDef.isBedrock || bId === 6 || bId === 8) && !hasPermission(session.account, "debug"))) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "It's too strong to break.", 0, true);
        return false;
      }
      if (!hasPermission(session.account, "debug") && !canModifyWorldTile(session, world, bt, bx, by, "break")) {
        const allowBuildLockPunch =
          canModifyWorldTile(session, world, bt, bx, by, "place") ||
          (bt.fg === 4994 &&
            bt.extra?.kind === "lock" &&
            ((bt.extra.settings & 0x80) !== 0 || bt.extra.adminIds.includes(session.account.userId)));
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, lockedMessage(ctx, world, bt, bx, by, "break", session.account.userId), 0, true);
        if (allowBuildLockPunch) {
          const dmgPkt = buildTankPacket({
            type: PACKET_TILE_APPLY_DAMAGE,
            netId: session.netId,
            value: 0,
            punchX: bx,
            punchY: by,
          });
          for (const p of world.peers) p.peer.sendPacket(0, dmgPkt, true);
        } else {
          session.peer.sendPacket(0, makeTileUpdatePacket(bx, by, bt, now), true);
        }
        return false;
      }

      // World Lock & Lock break safeguards (GTPS3 World.h:17680 & 19180 & 19815)
      if (bDef.isLock || AREA_LOCK_IDS.has(bId) || WORLD_LOCK_TIER_IDS.has(bId)) {
        const hasExistingStack = session.account.inventory.some((s) => s.itemId === bId && s.count > 0 && s.count < 200);
        const usedSlots = session.account.inventory.filter((s) => s.count > 0).length;
        if (!hasExistingStack && usedSlots >= session.account.backpackSize) {
          OnPlayPositioned(session, "audio/punch_locked.wav");
          OnTalkBubble(session, session.netId, "`4You don't have enough room in your backpack!``", 0, true);
          OnConsoleMessage(session, "`4You don't have enough room in your backpack!``");
          return false;
        }
      }
      if (WORLD_LOCK_TIER_IDS.has(bId)) {
        let hasMagplant = false;
        let hasActiveStorage = false;
        for (const t of world.tiles) {
          if (t.fg === 5638) {
            hasMagplant = true;
            break;
          }
          if (t.extra) {
            if (t.extra.kind === "sucker" && t.extra.count > 0) {
              hasActiveStorage = true;
              break;
            }
            if (t.extra.kind === "vending" && (t.extra.count > 0 || t.extra.wl > 0)) {
              hasActiveStorage = true;
              break;
            }
          }
        }
        if (hasMagplant || hasActiveStorage) {
          const msg = hasMagplant
            ? "`4Remove the MAGPLANT 5000 before breaking this lock!``"
            : "`4You can't break this lock while there are active storage machines in the world!``";
          OnPlayPositioned(session, "audio/punch_locked.wav");
          OnTalkBubble(session, session.netId, msg, 0, true);
          OnConsoleMessage(session, msg);
          return false;
        }
      }
      if ((bId === 2978 || bId === 9268) && bt.extra?.kind === "vending" && (bt.extra.count > 0 || bt.extra.wl > 0)) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "Empty the machine before smashing!", 0, true);
        return false;
      }
      if ((bId === 5638 || bId === 6946 || bId === 6948) && bt.extra?.kind === "sucker" && bt.extra.count > 0) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, `Empty this ${stripGtColors(bDef.name)} before breaking!`, 0, true);
        return false;
      }
      if (bId === 2946 && bt.extra?.kind === "display" && bt.extra.itemId > 0) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "Remove what's in there first!", 0, true);
        return false;
      }
      if (DISPLAY_SHELF_IDS.has(bId) && bt.extra?.kind === "displayShelf" && (bt.extra.s1 || bt.extra.s2 || bt.extra.s3 || bt.extra.s4)) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "Remove all items from the Display Shelf before breaking!", 0, true);
        return false;
      }
      if (DONATION_BOX_IDS.has(bId) && bt.extra?.kind === "donation" && bt.extra.donates.length > 0) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "Empty the Donation Box before breaking!", 0, true);
        return false;
      }
      if (STORAGE_BOX_IDS.has(bId) && (world.storageItems || []).some((s) => s.x === bx && s.y === by)) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, `Empty this ${stripGtColors(bDef.name)} before breaking!`, 0, true);
        return false;
      }
      if (MANNEQUIN_IDS.has(bId) && bt.extra?.kind === "mannequin" && (bt.extra.hair || bt.extra.shirt || bt.extra.pants || bt.extra.feet || bt.extra.face || bt.extra.hand || bt.extra.back || bt.extra.mask || bt.extra.neck)) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "Remove clothes from the Mannequin before breaking!", 0, true);
        return false;
      }

      if (bt.fg !== 0 && bt.extra?.kind === "seed") {
        const growSec = Math.max(1, bDef.growTime || 15);
        const ageSec = (now - bt.extra.plantedAtMs) / 1000;
        if (ageSec >= growSec) {
          harvestWorldTree(ctx, session, world, bx, by, bt, bDef);
          return true;
        }
        if (now - (bt.lastHitMs ?? 0) > 6000) bt.damage = 0;
        bt.lastHitMs = now;
        bt.damage = (bt.damage ?? 0) + 1;

        const shakePkt = makeTileTreeStatePacket(bx, by, 0, 1, session.netId);
        for (const p of world.peers) p.peer.sendPacket(0, shakePkt, true);

        if ((bt.damage ?? 0) >= 5) {
          finalizeTileBreak(ctx, session, world, bx, by, bt, bDef, bId);
          return true;
        }
        const leftSec = Math.max(1, Math.ceil(growSec - ageSec));
        OnTalkBubble(
          session,
          session.netId,
          `Not ready to harvest yet! (\`w${leftSec}s\`\` left)`,
          0, true
        );
        return false;
      }

      if (now - (bt.lastHitMs ?? 0) > 6000) bt.damage = 0;
      bt.lastHitMs = now;
      bt.damage = (bt.damage ?? 0) + 1;

      const dmgPkt = buildTankPacket({
        type: PACKET_TILE_APPLY_DAMAGE,
        netId: session.netId,
        value: 6,
        punchX: bx,
        punchY: by,
      });
      for (const p of world.peers) p.peer.sendPacket(0, dmgPkt, true);

      const protectedTile = bDef.isBedrock || bId === 6 || bId === 8;
      // Protected item definitions encode zero hits; the C++ reference uses a
      // 42-hit fallback. Never grant protected tiles or farming drops.
      const baseHits = protectedTile ? (bDef.breakHits > 1 ? Math.max(3, bDef.breakHits) : 42) : Math.max(1, bDef.breakHits - (hasEnhancedDigging(session.account) ? 1 : 0));
      const xenoStrong = world.xenonite?.enabled ? world.xenonite.strongPunch : 0;
      const hits = xenoStrong === 1 ? Math.max(1, baseHits - Math.floor(baseHits / 4)) : baseHits;
      if ((bt.damage ?? 0) >= hits) {
        finalizeTileBreak(ctx, session, world, bx, by, bt, bDef, bId, protectedTile);
      }
      return true;
    };

    if (punchLine > 0) {
      const dir = session.facingLeft ? -1 : 1;
      doBreak(tx, ty);
      for (let i = 1; i < punchLine; i++) doBreak(tx + dir * i, ty);
    } else {
      doBreak(tx, ty);
    }
    return;
  }

  // Magplant Remote (5640) usage - never fall through to normal block placement
  if (itemId === 5640) {
    if (!session.magplantRemote) {
      OnTalkBubble(session, session.netId, "Link a MAGPLANT 5000 first!", 0, true);
      return;
    }
    const { x: mx, y: my, itemId: rItemId } = session.magplantRemote;
    const magTile = world.tiles[my * world.width + mx];
    if (!magTile || magTile.fg !== 5638 || magTile.extra?.kind !== "sucker" || magTile.extra.itemId !== rItemId) {
      OnTalkBubble(session, session.netId, "Your MAGPLANT 5000 link is no longer valid.", 0, true);
      return;
    }
    if (magTile.extra.count <= 0) {
      OnTalkBubble(session, session.netId, "The MAGPLANT 5000 is empty!", 0, true);
      return;
    }
    const remoteDef = ctx.itemsDb.get(rItemId);
    const canPlaceFg = !remoteDef?.isBackground && !tile.fg;
    const canPlaceBg = !!remoteDef?.isBackground && !tile.bg;
    if (
      remoteDef &&
      !remoteDef.isSeed &&
      !remoteDef.isLock &&
      (canPlaceFg || canPlaceBg) &&
      canModifyWorldTile(session, world, tile, tx, ty, "place")
    ) {
      if (!remoteDef.isBackground && remoteDef.collisionType === 1 && Math.abs(session.x - tx * 32) < 18 && Math.abs(session.y - ty * 32) < 24) return;
      if (remoteDef.isBackground) {
        tile.bg = rItemId;
      } else {
        tile.fg = rItemId;
        tile.flags = (tile.flags & (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC | TILE_FLAG_GLUE)) | (session.facingLeft ? TILE_FLAG_FLIPPED : 0);
        tile.damage = 0;
      }
      magTile.extra.count -= 1;
      ctx.dirty = true;
      const placePkt = makeTileChangePacket(
        session.netId, tx, ty, rItemId,
        session.facingLeft ? TANK_FLAG_FACING_LEFT : 0
      );
      for (const p of world.peers) p.peer.sendPacket(0, placePkt, true);
      if ((tile.flags & TILE_FLAG_GLUE) !== 0) {
        const updTile = makeTileUpdatePacket(tx, ty, tile, now);
        for (const p of world.peers) p.peer.sendPacket(0, updTile, true);
      }
      const updMag = makeTileUpdatePacket(mx, my, magTile, now);
      for (const p of world.peers) {
        p.peer.sendPacket(0, updMag, true);
      }
    }
    return;
  }

  // Fishing Bait usage on Water (GTPS3 World.h:21475)
  if (BAIT_ITEMS.has(itemId)) {
    const isWater = tile.fg === 822 || (def && def.name.toLowerCase().includes("water"));
    if (isWater) {
      const hasRod = session.account.inventory.some((s) => s.equipped && FISHING_RODS.has(s.itemId));
      if (!hasRod) {
        OnTalkBubble(session, session.netId, "You'll need a fishing rod to fish!", 0, true);
        OnConsoleMessage(session, "You'll need a fishing rod to fish!");
        return;
      }
      ctx.consumeInventoryItem(session, itemId, 1, true);
      session.fishing = {
        baitId: itemId,
        tx,
        ty,
        startedAt: now,
        biteAt: now + 2000 + Math.random() * 3000,
      };
      broadcastPositionedSfx(world, session.netId, "audio/splash.wav");
      OnTalkBubble(session, session.netId, "You cast your line!", 0, true);
      return;
    }
  }

  // 3. Placing an item / seed / background / wearable
  const invSlot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!invSlot || !def) return;

  // Water bucket / glue / pocket lighter are direct tile tools (GTPS3 World.h 22313).
  if (useUtilityTileItem(ctx, session, world, tile, tx, ty, itemId)) return;

  // Paint buckets consume one bucket and recolor the tile; a Paintbrush hand item
  // must be equipped, exactly like the native client.
  if (usePaintBucket(ctx, session, world, tile, tx, ty, itemId)) return;

  // Display Block (2946) accepts any item (including consumables, dyes, and clothes) BEFORE they are consumed/equipped.
  if (tile.fg === 2946 && useItemOnDisplayBlock(ctx, session, world, tile, tx, ty, itemId)) return;

  if (useConsumable(ctx, session, itemId, tx, ty)) return;

  // Dyes and eye items are actionType 8 consumables. Previously they fell
  // through to the placement branch and could be placed as blocks.
  if (HAIR_DYE_ITEMS.has(itemId) || EYE_ITEMS.has(itemId)) {
    useDyeItem(ctx, session, world, itemId, tx, ty, playerTileX, playerTileY);
    return;
  }
  if (def.actionType === 8) {
    OnConsoleMessage(session, "This consumable is not implemented yet. Your item was not consumed.");
    return;
  }

  if (def.isClothing) {
    if (tile.fg && useClothingOnMannequin(ctx, session, world, tile, tx, ty, itemId)) return;
    toggleWearableItem(ctx, session, itemId);
    return;
  }

  // Interactive item-on-block mechanics BEFORE normal tile placement
  if (tile.fg && useItemOnDonationBox(ctx, session, tile, tx, ty, itemId)) return;
  if (tile.fg && useItemOnGrinder(ctx, session, tile, tx, ty, itemId)) return;
  if (tile.fg && useCrystalOnCrystal(ctx, session, world, tile, tx, ty, itemId)) return;

  // Illegal blocks stay out of reach for ranks without developer tools.
  // AstroVerse/GT answer a refused placement with `audio/cant_place_tile.wav`
  // and no dialog text at all, so the tile is simply never written.
  if (isIllegalItem(def) && !hasPermission(session.account, "debug")) {
    OnPlayPositioned(session, "audio/cant_place_tile.wav");
    return;
  }

  if (!canModifyWorldTile(session, world, tile, tx, ty, "place")) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTalkBubble(session, session.netId, lockedMessage(ctx, world, tile, tx, ty, "place", session.account.userId), 0, true);
    return;
  }

  let needsFullTileUpdate = false;
  let lockedIndices: number[] = [];

  if (def.isBackground) {
    if (tile.bg !== 0) return; // Existing background must be punched before replacement.
    tile.bg = itemId;
    tile.damage = 0;
  } else if (def.isSeed) {
    const rollFruitCount = (): number => {
      const r = Math.random();
      if (r < 0.2) return 1;
      if (r < 0.55) return 2;
      if (r < 0.85) return 3;
      return 4;
    };
    const scheduleMaturitySync = (seedId: number, growTimeSec: number): void => {
      const growMs = Math.max(1000, (growTimeSec || 15) * 1000);
      if (growMs > 300_000) return;
      setTimeout(() => {
        if (tile.fg === seedId && tile.extra?.kind === "seed" && world.peers.size > 0) {
          const grownPkt = makeTileUpdatePacket(tx, ty, tile, Date.now());
          for (const p of world.peers) p.peer.sendPacket(0, grownPkt, true);
        }
      }, growMs + 200);
    };

    if (tile.fg !== 0) {
      const cur = ctx.itemsDb.get(tile.fg);
      if (cur && cur.isSeed && tile.extra?.kind === "seed") {
        const growSec = Math.max(1, cur.growTime || 15);
        const ageSec = (now - tile.extra.plantedAtMs) / 1000;
        if (ageSec >= growSec) {
          OnTalkBubble(session, session.netId, "`wIt's too big to splice now!``", 0, true);
          return;
        }
        if (tile.extra.spliced) {
          OnTalkBubble(
            session,
            session.netId,
            "`wIt would be too dangerous to try to mix three seeds.``",
            0, true
          );
          return;
        }
        const splice = ctx.itemsDb.findSpliceSeed(tile.fg, itemId);
        if (!splice) {
          OnTalkBubble(
            session,
            session.netId,
            `\`wHmm, it looks like \`$${stripGtColors(cur.name)}\`w and \`$${stripGtColors(def.name)}\`w can't be spliced.\`\``,
            0, true
          );
          return;
        }
        const outSeedDef = ctx.itemsDb.get(splice)!;
        const outBlockDef = ctx.itemsDb.get(splice - 1);
        const treeTitle = outBlockDef
          ? `${stripGtColors(outBlockDef.name)} Tree`
          : stripGtColors(outSeedDef.name);
        tile.fg = splice;
        tile.damage = 0;
        tile.extra = {
          kind: "seed",
          plantedAtMs: now,
          fruitCount: rollFruitCount(),
          spliced: true,
        };
        ctx.consumeInventoryItem(session, itemId, 1, true);
        ctx.dirty = true;

        const upd = makeTileUpdatePacket(tx, ty, tile, now);
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        OnTalkBubble(
          session,
          session.netId,
          `\`w${stripGtColors(cur.name)}\`\` and \`w${stripGtColors(def.name)}\`\` have been spliced to make a \`2${treeTitle}\`\`!`,
          0, true
        );
        // Splice success is a separate event from ordinary seed planting.
        // Use the web client's supported positioned callback, addressed only to the actor.
        // Community mapping and protocol distinction: docs/SPLICE_SUCCESS_FIX.md.
        OnPlayPositioned(session, "audio/success.wav");
        scheduleMaturitySync(splice, outSeedDef.growTime);
        return;
      }
      OnTalkBubble(session, session.netId, "Plant seeds on empty space above a block!", 0, true);
      return;
    }

    const below = ty + 1 < world.height ? world.tiles[(ty + 1) * world.width + tx] : null;
    const belowDef = below && below.fg !== 0 ? ctx.itemsDb.get(below.fg) : null;
    if (!below || !belowDef || belowDef.isSeed || belowDef.isBackground || belowDef.collisionType === 0) {
      OnTalkBubble(session, session.netId, "Seeds must be planted above a solid block!", 0, true);
      return;
    }

    tile.fg = itemId;
    tile.damage = 0;
    tile.flags = (tile.flags & (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC | TILE_FLAG_GLUE)) | (session.facingLeft ? TILE_FLAG_FLIPPED : 0);
    // Client uses elapsed time versus items.dat growTime. Advancing the stored
    // start time by 5% gives the documented 5% shorter maturity deadline and
    // survives world save/reload; the initial visible growth is approximate.
    const discount = activeMods(session.account).reduce((n,m)=>Math.max(n,m.treeGrowthDiscount || 0),0);
    const originalGrowSec = Math.max(1, def.growTime || 15);
    const bonusMs = Math.floor(originalGrowSec * 1000 * discount);
    tile.extra = { kind: "seed", plantedAtMs: now-bonusMs, fruitCount: rollFruitCount(), spliced: false };
    scheduleMaturitySync(itemId, originalGrowSec*(1-discount));
  } else {
    // 1. Growmoji consumable items (GTPS3 World.h:22206-22227)
    if (GROWMOJI_ITEMS.has(itemId)) {
      ctx.consumeInventoryItem(session, itemId, 1, true);
      OnEmoticonDataChanged(session, true);
      return;
    }

    if (tile.fg !== 0) return;
    if (def.collisionType === 1) {
      const px = tx * 32;
      const py = ty * 32;
      if (Math.abs(session.x - px) < 18 && Math.abs(session.y - py) < 24) return;
    }

    const prevFlags = tile.flags;
    const isLockItem = def.isLock || AREA_LOCK_IDS.has(itemId) || WORLD_LOCK_TIER_IDS.has(itemId);
    if (itemId === 2072 && (world.xenonite || world.tiles.some((t) => t.fg === 2072))) {
      OnPlayPositioned(session, "audio/punch_locked.wav");
      OnTalkBubble(session, session.netId, "`4Only one Xenonite Crystal per world!``", 0, true);
      return;
    }
    if (isLockItem) {
      if (WORLD_LOCK_TIER_IDS.has(itemId)) {
        if (world.ownerUserId !== 0) {
          OnPlayPositioned(session, "audio/punch_locked.wav");
          OnTalkBubble(session, session.netId, "`4Only one World Lock per world!``", 0, true);
          return;
        }
        const hasOtherOwnerAreaLock = world.tiles.some(
          (t) =>
            AREA_LOCK_IDS.has(t.fg) &&
            t.extra?.kind === "lock" &&
            t.extra.ownerUserId !== 0 &&
            t.extra.ownerUserId !== session.account.userId
        );
        if (hasOtherOwnerAreaLock) {
          OnPlayPositioned(session, "audio/punch_locked.wav");
          OnTalkBubble(
            session,
            session.netId,
            "Your World Lock can't be placed in this world unless everyone else's locks are removed.",
            0,
            true
          );
          return;
        }
      } else if (AREA_LOCK_IDS.has(itemId) && (prevFlags & TILE_FLAG_LOCKED) !== 0) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "You can't place a lock over an area that's already locked!", 0, true);
        return;
      }
    }

    // GTPS3 World.h:23264 & 23379: Vending & Sucker require World Lock; Cameras max 8 per world
    if (world.ownerUserId === 0 && !hasPermission(session.account, "debug") && (itemId === 2978 || itemId === 9268 || itemId === 5638 || itemId === 6946 || itemId === 6948 || itemId === 6950 || itemId === 6952)) {
      OnTalkBubble(session, session.netId, "This item can only be used in World-Locked worlds!", 0, true);
      return;
    }
    if (CAMERA_IDS.has(itemId)) {
      const camCount = world.tiles.filter((t) => CAMERA_IDS.has(t.fg)).length;
      if (camCount >= 8) {
        OnTalkBubble(session, session.netId, `You can only have 8 ${stripGtColors(def.name)} in a world.`, 0, true);
        return;
      }
    }

    tile.fg = itemId;
    tile.flags = (prevFlags & (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC | TILE_FLAG_GLUE)) | (session.facingLeft ? TILE_FLAG_FLIPPED : 0);
    tile.damage = 0;

    let extra: TileExtra | undefined;
    if (isLockItem) {
      const isWorldLockTier = WORLD_LOCK_TIER_IDS.has(itemId);
      extra = { kind: "lock", settings: 0, ownerUserId: session.account.userId, adminIds: [] };
      tile.extra = extra;
      needsFullTileUpdate = true;
      if (isWorldLockTier) {
        world.ownerUserId = session.account.userId;
        const placedMessage = `\`5[\`\`\`w${world.name}\`\` has been \`$World Locked\`\` by ${session.account.name}\`5]\`\``;
        broadcastConsoleMessage(world, placedMessage);
        broadcastTalkBubble(world, session.netId, placedMessage);
        for (const player of world.peers) broadcastNameChanged(player);
        const defaultWeather = getDefaultLockWeather(world);
        if (defaultWeather !== 0) {
          const nextWeather = recomputeWorldWeather(world, ctx.itemsDb);
          broadcastSetCurrentWeather(world, nextWeather);
        }
      } else if (AREA_LOCK_IDS.has(itemId)) {
        lockedIndices = applyAreaLock(world, tx, ty);
      }
      broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    } else if (def.isDoor) {
      extra = { kind: "door", label: "", destination: "" };
      needsFullTileUpdate = true;
    } else if (def.isSign) {
      extra = { kind: "sign", label: "Edit me with Wrench!" };
      needsFullTileUpdate = true;
    } else if (itemId === 2978 || itemId === 9268) {
      extra = { kind: "vending", itemId: 0, price: 0, count: 0, wl: 0 };
      needsFullTileUpdate = true;
    } else if (itemId === 5638 || itemId === 6948 || itemId === 6946) {
      extra = { kind: "sucker", itemId: 0, count: 0, enabled: true, magnetron: false };
      needsFullTileUpdate = true;
    } else if (PROVIDER_DEFINITIONS[itemId]) {
      extra = { kind: "provider", plantedAtMs: now };
      needsFullTileUpdate = true;
    } else if (itemId === 2072) {
      world.xenonite = {
        enabled: true,
        doubleJump: 0,
        highJump: 0,
        heatResist: 0,
        strongPunch: 0,
        longPunch: 0,
        longBuild: 0,
        speedy: 0,
        powerups: 0,
      };
      // GTPS3 keeps Xenonite state on the world object only; it never sends a
      // per-tile extra. The invented type-18 payload desynchronised this
      // client's tile-extra parser and corrupted the whole world view.
      extra = undefined;
      needsFullTileUpdate = true;
      for (const p of world.peers) ctx.sendCharacterState(p);
    } else if (itemId === 6016) {
      extra = { kind: "growscan", mode: 0 };
      needsFullTileUpdate = true;
    } else if (itemId === 10058) {
      extra = { kind: "weatherInf", cycleSec: 0, weatherIds: [] };
      needsFullTileUpdate = true;
    } else if (WEATHER_BG_SPECIAL_IDS.has(itemId)) {
      extra =
        itemId === 3694
          ? { kind: "weatherBg", itemId: 0, r: 0, g: 0, b: 0 }
          : { kind: "weatherBg", itemId: 14 };
      needsFullTileUpdate = true;
    } else if (WEATHER_STUFF_SPECIAL_IDS.has(itemId)) {
      extra = { kind: "weatherStuff", itemId: itemId === 5958 ? 2 : 0, gravity: 50, spin: false, invert: false };
      needsFullTileUpdate = true;
    } else if (itemId === 2946) {
      extra = { kind: "display", itemId: 0 };
      needsFullTileUpdate = true;
    } else if (PAINTING_EASEL_IDS.has(itemId)) {
      extra = { kind: "paintingEasel", itemId: 0, label: "" };
      needsFullTileUpdate = true;
    } else if (PORTRAIT_IDS.has(itemId)) {
      extra = { kind: "portrait", label: "", expression: 1, skinColor: 0, hairColor: 0, hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, neck: 0 };
      needsFullTileUpdate = true;
    } else if (DISPLAY_SHELF_IDS.has(itemId)) {
      extra = { kind: "displayShelf", s1: 0, s2: 0, s3: 0, s4: 0 };
      needsFullTileUpdate = true;
    } else if (DONATION_BOX_IDS.has(itemId)) {
      extra = { kind: "donation", donates: [] };
      needsFullTileUpdate = true;
    } else if (MAILBOX_IDS.has(itemId)) {
      extra = { kind: "mailbox" };
      needsFullTileUpdate = true;
    } else if (BULLETIN_BOARD_IDS.has(itemId)) {
      extra = { kind: "bulletin" };
      needsFullTileUpdate = true;
    } else if (STORAGE_BOX_IDS.has(itemId)) {
      extra = { kind: "storage" };
      needsFullTileUpdate = true;
    } else if (MANNEQUIN_IDS.has(itemId)) {
      extra = { kind: "mannequin", label: "", expression: defaultMannequinExpression(itemId), skinColor: defaultMannequinSkin(itemId), hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, neck: 0 };
      needsFullTileUpdate = true;
    } else if (CRYSTAL_IDS.has(itemId)) {
      extra = { kind: "crystal", crystals: { [itemId]: 1 } };
      needsFullTileUpdate = true;
    } else if (AUTO_ACTION_IDS.has(itemId)) {
      extra = { kind: "autoAction", fuel: 0, targetItemId: 0, enabled: false };
      needsFullTileUpdate = true;
    } else if (CAMERA_IDS.has(itemId)) {
      extra = { kind: "camera" };
      world.cctvSettings = world.cctvSettings || [];
      if (!world.cctvSettings.some((c) => c.x === tx && c.y === ty)) {
        world.cctvSettings.push({
          x: tx, y: ty, showTaking: false, showDropping: false, showEnter: true, showExit: false,
          hideOwner: false, hideAdmins: false, hideNoAccess: false, showVend: false,
        });
      }
      needsFullTileUpdate = true;
    }
    tile.extra = extra;
  }

  ctx.dirty = true;

  // Let the client handle placement audio/animation and its own inventory decrement.
  // Extra-data tiles need the placement event too, followed by their authoritative state.
  ctx.consumeInventoryItem(session, itemId, 1, false);
  if (!def.isSeed) recordProgress(ctx, session, "blocks_placed");
  if (def.isLock || AREA_LOCK_IDS.has(itemId) || WORLD_LOCK_TIER_IDS.has(itemId)) {
    recordProgress(ctx, session, "locks_used");
  }
  if (itemId === 226 || WORLD_LOCK_TIER_IDS.has(itemId)) recordProgress(ctx, session, "world_locks_used");
  const placePkt = makeTileChangePacket(
    session.netId, tx, ty, itemId,
    session.facingLeft ? TANK_FLAG_FACING_LEFT : 0
  );
  for (const p of world.peers) p.peer.sendPacket(0, placePkt, true);
  if (needsFullTileUpdate || def.isSeed || (tile.flags & TILE_FLAG_GLUE) !== 0) {
    const upd = makeTileUpdatePacket(tx, ty, tile, now);
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
  }
  if (AREA_LOCK_IDS.has(itemId) && tile.extra?.kind === "lock") {
    const lockPkt = makeSendLockPacket(session.account.userId, itemId, tx, ty, lockedIndices);
    for (const p of world.peers) p.peer.sendPacket(0, lockPkt, true);
    for (const idx of lockedIndices) {
      const lx = idx % world.width;
      const ly = Math.floor(idx / world.width);
      const lPkt = makeTileUpdatePacket(lx, ly, world.tiles[idx], now);
      for (const p of world.peers) p.peer.sendPacket(0, lPkt, true);
    }
  }
}

function harvestWorldTree(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tx: number,
  ty: number,
  tile: WorldTile,
  def: ItemDef
): void {
  const te = tile.extra as SeedExtra | undefined;
  let fruitCnt = Math.max(1, Math.min(4, te?.fruitCount ?? 1));
  const seedItemId = tile.fg;
  const blockId = seedItemId > 0 ? seedItemId - 1 : 0;
  const blockDef = blockId > 0 ? ctx.itemsDb.get(blockId) : undefined;
  const rarity = Math.max(1, blockDef?.rarity ?? def.rarity ?? 1);

  // Farm Tools: Harvester (1830/1966) + Fuel Pack (1746) 10% double drop chance (GTPS3 World.h:19134)
  const feetSlot = session.account.inventory.find((s) => s.equipped && (s.itemId === 1830 || s.itemId === 1966));
  const backSlot = session.account.inventory.find((s) => s.equipped && s.itemId === 1746);
  const fuelSlot = session.account.inventory.find((s) => s.itemId === 1746 && s.count > 0);
  if (feetSlot && backSlot && fuelSlot && rarity < 100) {
    if (Math.random() < 0.1) {
      ctx.consumeInventoryItem(session, 1746, 1, true);
      fruitCnt *= 2;
      broadcastPositionedSfx(world, session.netId, "audio/success.wav");
    }
  }

  tile.fg = 0;
  tile.extra = undefined;
  tile.flags &= (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC | TILE_FLAG_GLUE);
  tile.damage = 0;
  ctx.dirty = true;

  recordProgress(ctx, session, "trees_harvested", 1, farmingXp(rarity));
  const harvestPkt = makeTileTreeStatePacket(tx, ty, blockId, -1, session.netId);
  for (const p of world.peers) p.peer.sendPacket(0, harvestPkt, true);
  // Tree-state invokes avatar SFX/effects; it does not serialize the cleared tile.
  const clearedTile = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, clearedTile, true);

  if (blockDef && !blockDef.name.startsWith("null_")) {
    spawnOrMergeWorldDrop(world, blockId, fruitCnt, tx * 32 + 6, ty * 32 + 6, -1);
  }

  const probableSeed = seedItemId || blockId + 1;
  if (ctx.itemsDb.get(probableSeed)?.isSeed) {
    const perFruitSeedChance = Math.max(0.05, Math.min(0.28, 4 / (rarity + 12)));
    for (let i = 0; i < fruitCnt; i++) {
      if (Math.random() < perFruitSeedChance) {
        spawnOrMergeWorldDrop(world, probableSeed, 1, tx * 32 + 14, ty * 32 + 6, -1);
        break;
      }
    }
  }

  const gemChance = rarity <= 1 ? 0.35 : Math.min(0.95, 0.45 + rarity * 0.02);
  if (Math.random() < gemChance) {
    const maxGems = Math.max(1, Math.min(25, Math.ceil(rarity / 4)));
    const gemCount = 1 + Math.floor(Math.random() * maxGems);
    spawnOrMergeWorldDrop(world, GEM_ITEM_ID, gemCount, tx * 32 + 10, ty * 32 + 8, -1);
  }
}

export function isAutoPickupBlock(targetId: number, def?: ItemDef): boolean {
  if (!def || targetId <= 0) return false;
  return (def.flags & ITEM_FLAG_AUTO_PICKUP) !== 0;
}

function finalizeTileBreak(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tx: number,
  ty: number,
  tile: WorldTile,
  def: ItemDef,
  targetId: number,
  suppressDrops = false
): void {
  const brokenWasWorldLock =
    tile.extra?.kind === "lock" && WORLD_LOCK_TIER_IDS.has(targetId);

  let unlockedIndices: number[] = [];
  if (AREA_LOCK_IDS.has(targetId)) {
    unlockedIndices = clearAreaLock(world, tx, ty);
  }
  if (targetId === 5638) {
    for (const p of world.peers) {
      if (p.magplantRemote && p.magplantRemote.x === tx && p.magplantRemote.y === ty) {
        clearSessionMagplantLink(p, world.name, true);
      }
    }
  }
  if (targetId === 2072) {
    world.xenonite = undefined;
    for (const p of world.peers) ctx.sendCharacterState(p);
  }
  if (CAMERA_IDS.has(targetId) && world.cctvSettings) {
    world.cctvSettings = world.cctvSettings.filter((c) => !(c.x === tx && c.y === ty));
    if (world.cctvLogs) world.cctvLogs = world.cctvLogs.filter((l) => !(l.x === tx && l.y === ty));
  }
  if ((MAILBOX_IDS.has(targetId) || BULLETIN_BOARD_IDS.has(targetId)) && world.bulletin) {
    world.bulletin = world.bulletin.filter((b) => !(b.x === tx && b.y === ty));
    if (world.bulletinSettings) world.bulletinSettings = world.bulletinSettings.filter((s) => !(s.x === tx && s.y === ty));
  }

  if (tile.fg !== 0) {
    tile.fg = 0;
    tile.extra = undefined;
    tile.flags = AREA_LOCK_IDS.has(targetId) ? (tile.flags & TILE_FLAG_GLUE) : (tile.flags & (TILE_FLAG_LOCKED | TILE_FLAG_PUBLIC | TILE_FLAG_GLUE));
  } else {
    tile.bg = 0;
  }
  tile.damage = 0;

  if (brokenWasWorldLock) {
    world.ownerUserId = 0;
    for (const player of world.peers) broadcastNameChanged(player);
    broadcastConsoleMessage(world, `\`5[\`\`\`w${world.name}\`\` has had its \`$World Lock\`\` removed!\`5]\`\``);
  }
  if (def.isWeather || WEATHER_BY_ITEM_ID[targetId] !== undefined || brokenWasWorldLock) {
    const nextWeather = recomputeWorldWeather(world, ctx.itemsDb);
    broadcastSetCurrentWeather(world, nextWeather);
  }
  ctx.dirty = true;

  if (unlockedIndices.length > 0) {
    const nowBreak = Date.now();
    for (const idx of unlockedIndices) {
      const ux = idx % world.width;
      const uy = Math.floor(idx / world.width);
      const uPkt = makeTileUpdatePacket(ux, uy, world.tiles[idx], nowBreak);
      for (const p of world.peers) p.peer.sendPacket(0, uPkt, true);
    }
  }

  if (suppressDrops) {
    const broken = makeTileChangePacket(session.netId, tx, ty, 18);
    const update = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) { p.peer.sendPacket(0, broken, true); p.peer.sendPacket(0, update, true); }
    return;
  }

  const breakPkt = makeTileChangePacket(session.netId, tx, ty, 18);
  for (const p of world.peers) p.peer.sendPacket(0, breakPkt, true);
  if ((tile.flags & TILE_FLAG_GLUE) !== 0) {
    const gluedUpdate = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, gluedUpdate, true);
  }

  if (isAutoPickupBlock(targetId, def)) {
    // Return block directly to inventory with native flying drop collect effect & sfx
    // Isolated single-item DroppedObject (never merged into existing ground stacks!)
    const dropX = tx * 32 + 8;
    const dropY = ty * 32 + 8;
    const dropObj: DroppedObject = {
      uid: ++world.lastObjectUid,
      itemId: targetId,
      count: 1,
      x: dropX,
      y: dropY,
      flags: DROPPED_ITEM_FOREGROUND_FLAG,
    };
    world.objects.push(dropObj);
    const dropPkt = makeItemDropPacket(dropObj.itemId, dropObj.count, dropObj.x, dropObj.y, dropObj.flags, -1);
    for (const p of world.peers) p.peer.sendPacket(0, dropPkt, true);
    handleItemActivateObject(ctx, session, dropObj.uid, true);
    return;
  }

  // Dropless check: if block has Dropless flag or rarity 999 with no recipe ingredients, it drops nothing!
  if (((def.flags & ITEM_FLAG_DROPLESS) !== 0 || def.rarity === 999) && (def.ing1 === 0 || def.ing2 === 0)) {
    return;
  }

  if (!def.isSeed) recordProgress(ctx, session, "blocks_broken", 1, farmingXp(def.rarity));
  if (!def.isSeed && activeMods(session.account).some(m=>m.extraBreakGemChance && Math.random()<m.extraBreakGemChance)) {
    spawnOrMergeWorldDrop(world, GEM_ITEM_ID, 1, tx*32+12, ty*32+10, -1);
  }

  if (def.isSeed) {
    if (Math.random() < 0.25) {
      spawnOrMergeWorldDrop(world, targetId, 1, tx * 32 + 8, ty * 32 + 8, -1);
    }
  } else {
    const roll = Math.random();
    if (roll < 0.28) {
      spawnOrMergeWorldDrop(world, targetId, 1, tx * 32 + 6, ty * 32 + 8, -1);
    } else if (roll < 0.48 && (def.flags & ITEM_FLAG_NO_SEED) === 0 && ctx.itemsDb.get(targetId + 1)?.isSeed) {
      spawnOrMergeWorldDrop(world, targetId + 1, 1, tx * 32 + 10, ty * 32 + 8, -1);
    }
    const mods = activeMods(session.account);
    if (mods.some(m=>m.luckyBreaks) && Math.random()<0.1) {
      spawnOrMergeWorldDrop(world, targetId, 1, tx*32+6, ty*32+8, -1);
    }
    if (Math.random() < 0.55 && def.rarity > 0) {
      let gemAmt = Math.max(1, Math.min(25, Math.ceil((def.rarity || 1) / 3)));
      const lucky=mods.some(m=>m.luckyBreaks) && Math.random()<0.1;
      const doubled=mods.some(m=>m.doubleGemsChance && Math.random()<m.doubleGemsChance);
      gemAmt *= lucky ? 5 : doubled ? 2 : 1;
      spawnOrMergeWorldDrop(world, GEM_ITEM_ID, gemAmt, tx * 32 + 12, ty * 32 + 10, -1);
    }
  }
}
