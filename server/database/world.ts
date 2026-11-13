import { SERVER_NAME } from "../config/branding";
import {
  buildTankPacket,
  makeItemDropPacket,
  makeItemModifyObjectPacket,
  makeTileUpdatePacket,
  PACKET_ITEM_EFFECT,
  TILE_FLAG_LOCKED,
  type DroppedObject,
  type WorldTile,
} from "../proton/packet";
import type { ItemDatabase } from "./items";
import type { PlayerSession } from "./peer";

export interface XenoniteState {
  enabled: boolean;
  doubleJump: number;
  highJump: number;
  heatResist: number;
  strongPunch: number;
  longPunch: number;
  longBuild: number;
  speedy: number;
  powerups: number;
}

export interface WorldBulletinEntry {
  x: number;
  y: number;
  name: string;
  text: string;
}

export interface WorldBulletinSetting {
  x: number;
  y: number;
  publicCanAdd: boolean;
  hideNames: boolean;
}

export interface WorldStorageEntry {
  x: number;
  y: number;
  itemId: number;
  count: number;
}

export interface WorldCctvSetting {
  x: number;
  y: number;
  showTaking: boolean;
  showDropping: boolean;
  showEnter: boolean;
  showExit: boolean;
  hideOwner: boolean;
  hideAdmins: boolean;
  hideNoAccess: boolean;
  showVend: boolean;
}

export interface WorldCctvLog {
  x: number;
  y: number;
  log: string;
  icon: number;
}

export interface WorldInstance {
  name: string;
  width: number;
  height: number;
  tiles: WorldTile[];
  objects: DroppedObject[];
  lastObjectUid: number;
  weatherId: number;
  ownerUserId: number;
  worldBans?: Record<string,number>;
  nuked?: boolean;
  xenonite?: XenoniteState;
  allowAdminVending?: boolean;
  disableMusicBlocks?: boolean;
  makeMusicInvisible?: boolean;
  musicBpm?: number;
  entryLevel?: number;
  royalSilence?: boolean;
  royalRainbows?: boolean;
  bulletin?: WorldBulletinEntry[];
  bulletinSettings?: WorldBulletinSetting[];
  storageItems?: WorldStorageEntry[];
  cctvSettings?: WorldCctvSetting[];
  cctvLogs?: WorldCctvLog[];
  worldTimerEndMs?: number;
  worldCategory?: string;
  spawnX: number;
  spawnY: number;
  peers: Set<PlayerSession>;
  geigerTarget?: { x: number; y: number };
}

export interface PersistedWorld {
  name: string;
  width: number;
  height: number;
  tiles: WorldTile[];
  objects: DroppedObject[];
  lastObjectUid: number;
  weatherId: number;
  ownerUserId: number;
  worldBans?: Record<string,number>;
  nuked?: boolean;
  xenonite?: XenoniteState;
  allowAdminVending?: boolean;
  disableMusicBlocks?: boolean;
  makeMusicInvisible?: boolean;
  musicBpm?: number;
  entryLevel?: number;
  royalSilence?: boolean;
  royalRainbows?: boolean;
  bulletin?: WorldBulletinEntry[];
  bulletinSettings?: WorldBulletinSetting[];
  storageItems?: WorldStorageEntry[];
  cctvSettings?: WorldCctvSetting[];
  cctvLogs?: WorldCctvLog[];
  worldTimerEndMs?: number;
  worldCategory?: string;
  spawnX: number;
  spawnY: number;
}

export function generateFreshWorld(name: string): WorldInstance {
  const width = 100;
  const height = 60;
  const tiles: WorldTile[] = new Array(width * height);

  const doorX = 48;
  const doorY = 36;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let fg = 0;
      let bg = 0;
      if (y >= 54) {
        fg = 8; // Bedrock
        bg = 14;
      } else if (y >= 50) {
        fg = Math.random() < 0.2 ? 4 : 2; // Lava + Dirt
        bg = 14;
      } else if (y >= 37) {
        fg = Math.random() < 0.06 ? 10 : 2; // Rock + Dirt
        bg = 14;
      }
      tiles[y * width + x] = { fg, bg, parentIndex: 0, flags: 0 };
    }
  }

  // Main Door + Bedrock pedestal directly underneath
  tiles[doorY * width + doorX] = {
    fg: 6,
    bg: 0,
    parentIndex: 0,
    flags: 0,
    extra: { kind: "door", label: "EXIT", destination: "EXIT", locked: false },
  };
  tiles[(doorY + 1) * width + doorX] = {
    fg: 8,
    bg: 14,
    parentIndex: 0,
    flags: 0,
  };

  if (name === "START") {
    tiles[doorY * width + (doorX + 2)] = {
      fg: 20,
      bg: 0,
      parentIndex: 0,
      flags: 0,
      extra: {
        kind: "sign",
        label: `\`wWelcome to \`2${SERVER_NAME}\`\`! Type \`5/find\`\` or \`5/help\`\`!`,
      },
    };
  } else if (name === "FARM") {
    const now = Date.now();
    for (const rowY of [36, 32, 28]) {
      for (let x = 15; x < 85; x++) {
        if (rowY < 36) tiles[(rowY + 1) * width + x].fg = 100;
        if (x !== doorX && x !== doorX + 2 && x % 2 === 0) {
          tiles[rowY * width + x].fg = x % 4 === 0 ? 17 : 101;
          tiles[rowY * width + x].extra = {
            kind: "seed",
            plantedAtMs: now - 3_600_000,
            fruitCount: 3 + (x % 2),
          };
        }
      }
    }
  } else if (name === "PARKOUR") {
    let px = 44;
    let py = 34;
    for (let step = 0; step < 22; step++) {
      tiles[py * width + px].fg = 100;
      tiles[py * width + px + 1].fg = 100;
      px = Math.max(8, Math.min(90, px + (step % 2 === 0 ? 4 : -3)));
      py = Math.max(10, py - 1);
    }
  }

  return {
    name,
    width,
    height,
    tiles,
    objects: [],
    lastObjectUid: 0,
    weatherId: 0,
    ownerUserId: 0,
    spawnX: doorX * 32,
    spawnY: doorY * 32,
    peers: new Set(),
  };
}

export function serializeWorldForDisk(w: WorldInstance): PersistedWorld {
  return {
    name: w.name,
    width: w.width,
    height: w.height,
    tiles: w.tiles.map((t) => ({
      fg: t.fg,
      bg: t.bg,
      parentIndex: t.parentIndex,
      flags: t.flags,
      extra: t.extra,
    })),
    objects: w.objects,
    lastObjectUid: w.lastObjectUid,
    weatherId: w.weatherId,
    ownerUserId: w.ownerUserId,
    worldBans: w.worldBans || {},
    xenonite: w.xenonite,
    allowAdminVending: !!w.allowAdminVending,
    disableMusicBlocks: !!w.disableMusicBlocks,
    makeMusicInvisible: !!w.makeMusicInvisible,
    musicBpm: w.musicBpm ?? 100,
    entryLevel: w.entryLevel ?? 1,
    royalSilence: !!w.royalSilence,
    royalRainbows: !!w.royalRainbows,
    bulletin: w.bulletin || [],
    bulletinSettings: w.bulletinSettings || [],
    storageItems: w.storageItems || [],
    cctvSettings: w.cctvSettings || [],
    cctvLogs: w.cctvLogs || [],
    worldTimerEndMs: w.worldTimerEndMs || 0,
    worldCategory: w.worldCategory || "None",
    spawnX: w.spawnX,
    spawnY: w.spawnY,
  };
}

export function hydrateWorldFromDisk(raw: PersistedWorld): WorldInstance {
  return {
    name: raw.name,
    width: raw.width || 100,
    height: raw.height || 60,
    tiles: Array.isArray(raw.tiles) ? raw.tiles : generateFreshWorld(raw.name).tiles,
    objects: Array.isArray(raw.objects) ? raw.objects : [],
    lastObjectUid: typeof raw.lastObjectUid === "number" ? raw.lastObjectUid : 0,
    weatherId: typeof raw.weatherId === "number" ? raw.weatherId : 0,
    ownerUserId: typeof raw.ownerUserId === "number" ? raw.ownerUserId : 0,
    worldBans: raw.worldBans && typeof raw.worldBans === "object" ? Object.fromEntries(Object.entries(raw.worldBans).filter(([k,v])=>/^[1-9][0-9]*$/.test(k) && Number.isSafeInteger(v) && v > Date.now())) : {},
    xenonite: raw.xenonite,
    allowAdminVending: !!raw.allowAdminVending,
    disableMusicBlocks: !!raw.disableMusicBlocks,
    makeMusicInvisible: !!raw.makeMusicInvisible,
    musicBpm: typeof raw.musicBpm === "number" ? raw.musicBpm : 100,
    entryLevel: typeof raw.entryLevel === "number" ? raw.entryLevel : 1,
    royalSilence: !!raw.royalSilence,
    royalRainbows: !!raw.royalRainbows,
    bulletin: Array.isArray(raw.bulletin) ? raw.bulletin : [],
    bulletinSettings: Array.isArray(raw.bulletinSettings) ? raw.bulletinSettings : [],
    storageItems: Array.isArray(raw.storageItems) ? raw.storageItems : [],
    cctvSettings: Array.isArray(raw.cctvSettings) ? raw.cctvSettings : [],
    cctvLogs: Array.isArray(raw.cctvLogs) ? raw.cctvLogs : [],
    worldTimerEndMs: typeof raw.worldTimerEndMs === "number" ? raw.worldTimerEndMs : 0,
    worldCategory: typeof raw.worldCategory === "string" ? raw.worldCategory : "None",
    spawnX: typeof raw.spawnX === "number" ? raw.spawnX : 48 * 32,
    spawnY: typeof raw.spawnY === "number" ? raw.spawnY : 36 * 32,
    peers: new Set(),
  };
}

export function getLockRadiusForId(lockItemId: number): number {
  if (lockItemId === 202) return 3;  // Small Lock
  if (lockItemId === 204) return 6;  // Big Lock
  if (lockItemId === 206 || lockItemId === 4994) return 10; // Huge Lock / Builder's Lock
  return 0; // World Locks lock entire world via world.ownerUserId
}

export function getAreaLockMaxTiles(lockItemId: number): number {
  if (lockItemId === 202) return 10;
  if (lockItemId === 204) return 48;
  if (lockItemId === 206 || lockItemId === 4994) return 200;
  return 0;
}

export function clearAreaLock(world: WorldInstance, lx: number, ly: number): number[] {
  const originIdx = ly * world.width + lx;
  const cleared: number[] = [];
  for (let i = 0; i < world.tiles.length; i++) {
    if (i === originIdx) continue;
    const t = world.tiles[i];
    if ((t.flags & TILE_FLAG_LOCKED) !== 0 && t.parentIndex === originIdx) {
      t.flags &= ~TILE_FLAG_LOCKED;
      t.parentIndex = 0;
      cleared.push(i);
    }
  }
  return cleared;
}

export function applyAreaLock(world: WorldInstance, lx: number, ly: number): number[] {
  const maxTiles = getAreaLockMaxTiles(world.tiles[ly * world.width + lx]?.fg || 0);
  if (maxTiles <= 0) return [];
  const originIdx = ly * world.width + lx;
  const lockTile = world.tiles[originIdx];
  if (!lockTile || lockTile.extra?.kind !== "lock") return [];
  const ignoreEmptyAir = Boolean(lockTile.extra.emptyAir);

  clearAreaLock(world, lx, ly);

  const visited = new Set<number>([originIdx]);
  const queue: number[] = [originIdx];
  const lockedIndices: number[] = [];

  const isLockable = (idx: number): boolean => {
    const t = world.tiles[idx];
    if (!t) return false;
    if (t.fg === 6 || t.fg === 8) return false;
    if (t.extra?.kind === "lock") return false;
    if ((t.flags & TILE_FLAG_LOCKED) !== 0 && t.parentIndex !== originIdx) return false;
    if (ignoreEmptyAir && t.fg === 0 && t.bg === 0) return false;
    return true;
  };

  for (let qi = 0; qi < queue.length && lockedIndices.length < maxTiles; qi++) {
    const cur = queue[qi];
    const cx = cur % world.width;
    const cy = Math.floor(cur / world.width);
    const neighbors: Array<[number, number]> = [
      [cx - 1, cy],
      [cx, cy - 1],
      [cx + 1, cy],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
      const nIdx = ny * world.width + nx;
      if (visited.has(nIdx)) continue;
      visited.add(nIdx);
      const nt = world.tiles[nIdx];
      // Expand through empty air ONLY if not ignoring empty air or already placed non-lock tiles
      if (isLockable(nIdx)) {
        nt.flags |= TILE_FLAG_LOCKED;
        nt.parentIndex = originIdx;
        lockedIndices.push(nIdx);
        queue.push(nIdx);
        if (lockedIndices.length >= maxTiles) break;
      } else if (!ignoreEmptyAir && nt && nt.fg === 0 && nt.bg === 0 && (nt.flags & TILE_FLAG_LOCKED) === 0) {
        queue.push(nIdx);
      }
    }
  }
  return lockedIndices;
}

export function getBuildersLockDenial(
  world: WorldInstance,
  uid: number,
  tile: WorldTile,
  tx?: number,
  ty?: number,
  mode: "place" | "break" | "wrench" = "place"
): string | null {
  const checkLock = (lt: WorldTile): string | null => {
    if (!lt || lt.extra?.kind !== "lock" || lt.extra.ownerUserId === uid) return null;
    const isAdmin = lt.extra.adminIds.includes(uid);
    const isPublic = (lt.extra.settings & 0x80) !== 0;
    if (lt.fg === 4994) {
      if (isAdmin) {
        if (lt.extra.limitAdmins && mode === "break") return "You can't break here, the owner has limited admins!";
        return null;
      }
      if (!isPublic) return "";
      if (lt.extra.buildOnly && mode === "break") return "This lock allows building only!";
      if (!lt.extra.buildOnly && mode === "place") return "This lock allows breaking only!";
      return null;
    }
    return isAdmin || isPublic ? null : "";
  };

  if ((tile.flags & TILE_FLAG_LOCKED) !== 0 && tile.parentIndex > 0 && tile.parentIndex < world.tiles.length) {
    const pt = world.tiles[tile.parentIndex];
    const msg = pt ? checkLock(pt) : null;
    if (msg !== null) return msg;
  }
  if (tx !== undefined && ty !== undefined) {
    for (let y = Math.max(0, ty - 10); y <= Math.min(world.height - 1, ty + 10); y++) {
      for (let x = Math.max(0, tx - 10); x <= Math.min(world.width - 1, tx + 10); x++) {
        const lt = world.tiles[y * world.width + x];
        if (!lt || lt.extra?.kind !== "lock") continue;
        const rad = getLockRadiusForId(lt.fg);
        if (rad <= 0) continue;
        if (Math.abs(x - tx) <= rad && Math.abs(y - ty) <= rad) {
          const msg = checkLock(lt);
          if (msg !== null) return msg;
        }
      }
    }
  }
  return null;
}

export function canModifyTile(
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx?: number,
  ty?: number,
  mode: "place" | "break" | "wrench" = "place"
): boolean {
  const uid = session.account.userId;
  // Developer building access matches the existing developer punching bypass.
  if (session.account.rank === "developer") return true;

  // Check if this specific tile is a lock itself (only owner can break; owner/admins can wrench)
  if (tile.extra?.kind === "lock") {
    if (mode === "break") return tile.extra.ownerUserId === uid;
    return tile.extra.ownerUserId === uid || tile.extra.adminIds.includes(uid);
  }

  // Check World Lock ownership / admin list
  if (world.ownerUserId !== 0 && world.ownerUserId !== uid) {
    // Check if user is an admin on the world lock tile
    const wlTile = world.tiles.find(
      (t) =>
        (t.fg === 242 || t.fg === 1796 || t.fg === 5260 || t.fg === 7188 || t.fg === 10410 || t.fg === 11550 || t.fg === 11586 || t.fg === 11902 || t.fg === 12654) &&
        t.extra?.kind === "lock"
    );
    if (wlTile && wlTile.extra?.kind === "lock") {
      if (wlTile.extra.adminIds.includes(uid)) return true;
      // Check public lock flag (bit 7 = 0x80)
      if ((wlTile.extra.settings & 0x80) !== 0) return true;
    }
    return false;
  }

  // Check area locks (Small / Big / Huge / Builder's Lock) via parentIndex or radius
  return getBuildersLockDenial(world, uid, tile, tx, ty, mode) === null;
}

export const canModifyWorldTile = canModifyTile;

const WORLD_LOCK_IDS = new Set([242, 1796, 5260, 7188, 10410, 11550, 11586, 11902, 12654]);

export function getWorldLockTile(world: WorldInstance): WorldTile | undefined {
  return world.tiles.find((t) => WORLD_LOCK_IDS.has(t.fg) && t.extra?.kind === "lock");
}

/**
 * GTPS3 World.h:5084 block_access(..., vend = true) parity:
 * - World owner & developer can always manage vending.
 * - If world.allowAdminVending (v_p), un-area-locked vending can be edited by world admins.
 * - If area-locked, only the area lock owner can manage vending.
 * - In unlocked worlds, anyone can manage vending.
 */
export function canManageVending(
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile
): boolean {
  const uid = session.account.userId;
  if (world.ownerUserId === uid || session.account.rank === "developer") return true;
  const isAreaLocked = (tile.flags & TILE_FLAG_LOCKED) !== 0 && tile.parentIndex > 0;
  if (world.allowAdminVending && !isAreaLocked) {
    const wl = getWorldLockTile(world);
    if (wl?.extra?.kind === "lock" && wl.extra.adminIds.includes(uid)) return true;
  }
  if (isAreaLocked) {
    const lockTile = world.tiles[tile.parentIndex];
    return lockTile?.extra?.kind === "lock" && lockTile.extra.ownerUserId === uid;
  }
  return world.ownerUserId === 0;
}

/**
 * Records an activity entry for all configured Security Cameras in a world (GTPS3 World.h:1650).
 */
export function logCctvEvent(
  world: WorldInstance,
  session: PlayerSession,
  type: "entered" | "left" | "took" | "dropped" | "bought",
  extraText = ""
): void {
  const settingsList = world.cctvSettings;
  if (!settingsList || settingsList.length === 0) return;

  const uid = session.account.userId;
  const wl = getWorldLockTile(world);
  const isOwner = world.ownerUserId === uid;
  const isAdmin = !!wl && wl.extra?.kind === "lock" && wl.extra.adminIds.includes(uid);
  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")} on ${now.getMonth() + 1}/${now.getDate()}`;
  const logs = (world.cctvLogs = world.cctvLogs || []);

  for (const s of settingsList) {
    if (s.hideOwner && isOwner) continue;
    if (s.hideAdmins && isAdmin) continue;
    if (s.hideNoAccess && !isOwner && !isAdmin) continue;
    const match =
      (type === "entered" && s.showEnter) ||
      (type === "left" && s.showExit) ||
      (type === "took" && s.showTaking) ||
      (type === "dropped" && s.showDropping) ||
      (type === "bought" && s.showVend);
    if (!match) continue;

    const mid = extraText ? ` ${extraText} ` : " ";
    const text = `\`w${session.account.name}\`\` ${type}${mid}at ${timeStr}`;
    logs.push({ x: s.x, y: s.y, log: text, icon: type === "took" ? 18 : 1400 });
    while (logs.length > 50) logs.shift();
  }
}

export function getDefaultLockWeather(world: WorldInstance): number {
  const wlTile = world.tiles.find(
    (t) =>
      t.extra?.kind === "lock" &&
      (t.fg === 10410 || t.fg === 11550 || t.fg === 11586 || t.fg === 11902 || t.fg === 12654)
  );
  if (!wlTile) return 0;
  if (wlTile.fg === 10410) return 53;
  if (wlTile.fg === 11550) return 54;
  if (wlTile.fg === 11586) return 55;
  if (wlTile.fg === 11902) return 58;
  if (wlTile.fg === 12654) return 63;
  return 0;
}

export function recomputeWorldWeather(world: WorldInstance, itemsDb: ItemDatabase): number {
  let nextWeather = getDefaultLockWeather(world);
  for (const t of world.tiles) {
    if (t.fg !== 0 && (t.flags & 0x0040) !== 0) {
      const def = itemsDb.get(t.fg);
      if (def?.isWeather) {
        nextWeather = itemsDb.getWeatherIdForBlock(t.fg);
        break;
      }
    }
  }
  world.weatherId = nextWeather;
  return nextWeather;
}

/**
 * Spawns or merges dropped items in the world!
 * Verified instruction-by-instruction against `ReGrowtopia-1.50.wasm` `Func #1737` (`World::HandleObjectChangePacket`):
 *  - Gems (`itemId === 112`): split into authentic Growtopia gem denominations (100, 50, 10, 5, 1) with `netId = -1`.
 *  - Non-gem items: searches `world.objects` on the same tile or within 28px for an existing stack of `itemId` with `count < 200`,
 *    merges up to `200` IN-PLACE, and broadcasts `PACKET_ITEM_CHANGE_OBJECT` with **`netId = -3`** (`targetNetId = existing.uid`,
 *    `floatVar = existing.count`) so 1 WL + 1 WL becomes a single 2 WL icon without overlapping or incrementing `lastObjectUid`!
 *  - Spawns any remaining amount (`> 0`) as a new `DroppedObject` (`++world.lastObjectUid`) with `netId = -1`!
 *  - Both `netId = -1` and `netId = -3` natively play `"audio/object_spawn2.wav"` inside `ReGrowtopia-1.50.wasm`!
 */
export function spawnOrMergeWorldDrop(
  world: WorldInstance,
  itemId: number,
  totalCount: number,
  x: number,
  y: number,
  throwerNetId = -1
): DroppedObject | undefined {
  if (totalCount <= 0 || itemId <= 0) return undefined;

  // 0. Magplant / Gaia / UT auto-suck check (GTPS3 World.h:17575 use_mag)
  if (itemId !== 112) {
    for (let ty = 0; ty < world.height; ty++) {
      for (let tx = 0; tx < world.width; tx++) {
        const t = world.tiles[ty * world.width + tx];
        if (t.extra && t.extra.kind === "sucker" && t.extra.enabled && t.extra.itemId === itemId) {
          const maxCap = t.fg === 5638 ? 5000 : 1500;
          if (t.extra.count < maxCap) {
            const space = maxCap - t.extra.count;
            const absorbed = Math.min(totalCount, space);
            t.extra.count += absorbed;
            totalCount -= absorbed;
            const flyPkt = buildTankPacket({
              type: PACKET_ITEM_EFFECT,
              netId: -1,
              x: tx * 32 + 16,
              y: ty * 32 + 16,
              speedX: x,
              speedY: y,
              punchX: itemId,
            });
            for (const p of world.peers) p.peer.sendPacket(0, flyPkt, true);
            const updPkt = makeTileUpdatePacket(tx, ty, t, Date.now());
            for (const p of world.peers) p.peer.sendPacket(0, updPkt, true);
            if (totalCount <= 0) return;
          }
        }
      }
    }
  }

  // Gems (itemId 112) split into visual denominations (Yellow/Blue/Red/Green/Purple)
  if (itemId === 112) {
    let rem = Math.min(5000, Math.floor(totalCount));
    const denoms = [100, 50, 10, 5, 1];
    let spawnedGems = 0;
    for (const d of denoms) {
      while (rem >= d && spawnedGems < 25) {
        rem -= d;
        spawnedGems++;
        const gx = x + (Math.random() * 14 - 7);
        const gy = y + (Math.random() * 6 - 3);
        const uid = ++world.lastObjectUid;
        world.objects.push({ uid, itemId: 112, x: gx, y: gy, count: d, flags: 0 });
        const pkt = makeItemDropPacket(112, d, gx, gy, 0, throwerNetId);
        for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
      }
    }
    return undefined;
  }

  let remaining = Math.floor(totalCount);
  const dropTileX = Math.floor((x + 8) / 32);
  const dropTileY = Math.floor((y + 8) / 32);
  let lastAffected: DroppedObject | undefined;

  // 1. Merge into existing nearby ground stack(s) of the exact same itemId (up to 200 per stack)!
  for (const existing of world.objects) {
    if (remaining <= 0) break;
    if (existing.itemId !== itemId || existing.count >= 200) continue;
    const exTileX = Math.floor((existing.x + 8) / 32);
    const exTileY = Math.floor((existing.y + 8) / 32);
    const sameTile = exTileX === dropTileX && exTileY === dropTileY;
    const closePixels = Math.hypot(existing.x - x, existing.y - y) <= 28;
    if (!sameTile && !closePixels) continue;

    const addable = Math.min(remaining, 200 - existing.count);
    existing.count += addable;
    remaining -= addable;
    lastAffected = existing;

    // Broadcast netId = -3 in-place stack count update (does NOT increment lastObjectUid!)
    const modPkt = makeItemModifyObjectPacket(
      existing.uid,
      existing.itemId,
      existing.count,
      existing.x,
      existing.y,
      existing.flags
    );
    for (const p of world.peers) p.peer.sendPacket(0, modPkt, true);
  }

  // 2. Spawn new ground stack(s) (netId = -1) for any unmerged remainder
  while (remaining > 0) {
    const chunk = Math.min(200, remaining);
    remaining -= chunk;
    const uid = ++world.lastObjectUid;
    const obj: DroppedObject = { uid, itemId, x, y, count: chunk, flags: 0 };
    world.objects.push(obj);
    lastAffected = obj;
    const dropPkt = makeItemDropPacket(itemId, chunk, x, y, 0, throwerNetId);
    for (const p of world.peers) p.peer.sendPacket(0, dropPkt, true);
  }
  return lastAffected;
}
