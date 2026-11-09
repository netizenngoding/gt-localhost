import { SERVER_NAME } from "../config/branding";
import {
  makeItemDropPacket,
  makeItemModifyObjectPacket,
  type DroppedObject,
  type WorldTile,
} from "../proton/packet";
import type { ItemDatabase } from "./items";
import type { PlayerSession } from "./peer";

export interface WorldInstance {
  name: string;
  width: number;
  height: number;
  tiles: WorldTile[];
  objects: DroppedObject[];
  lastObjectUid: number;
  weatherId: number;
  ownerUserId: number;
  spawnX: number;
  spawnY: number;
  peers: Set<PlayerSession>;
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
    spawnX: typeof raw.spawnX === "number" ? raw.spawnX : 48 * 32,
    spawnY: typeof raw.spawnY === "number" ? raw.spawnY : 36 * 32,
    peers: new Set(),
  };
}

export function getLockRadiusForId(lockItemId: number): number {
  if (lockItemId === 202) return 3;  // Small Lock
  if (lockItemId === 204) return 6;  // Big Lock
  if (lockItemId === 206) return 10; // Huge Lock
  return 0; // World Locks lock entire world via world.ownerUserId
}

export function canModifyTile(
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx?: number,
  ty?: number
): boolean {
  const uid = session.account.userId;

  // Check if this specific tile is a lock itself
  if (tile.extra?.kind === "lock") {
    return tile.extra.ownerUserId === uid || tile.extra.adminIds.includes(uid);
  }

  // Check World Lock ownership / admin list
  if (world.ownerUserId !== 0 && world.ownerUserId !== uid) {
    // Check if user is an admin on the world lock tile
    const wlTile = world.tiles.find(
      (t) =>
        (t.fg === 242 || t.fg === 1796 || t.fg === 7188) &&
        t.extra?.kind === "lock"
    );
    if (wlTile && wlTile.extra?.kind === "lock") {
      if (wlTile.extra.adminIds.includes(uid)) return true;
      // Check public lock flag (bit 7 = 0x80)
      if ((wlTile.extra.settings & 0x80) !== 0) return true;
    }
    return false;
  }

  // Check area locks (Small / Big / Huge Lock) if tx & ty provided
  if (tx !== undefined && ty !== undefined) {
    for (let y = Math.max(0, ty - 10); y <= Math.min(world.height - 1, ty + 10); y++) {
      for (let x = Math.max(0, tx - 10); x <= Math.min(world.width - 1, tx + 10); x++) {
        const lt = world.tiles[y * world.width + x];
        if (!lt || lt.extra?.kind !== "lock") continue;
        const rad = getLockRadiusForId(lt.fg);
        if (rad <= 0) continue;
        if (Math.abs(x - tx) <= rad && Math.abs(y - ty) <= rad) {
          if (
            lt.extra.ownerUserId !== uid &&
            !lt.extra.adminIds.includes(uid) &&
            (lt.extra.settings & 0x80) === 0
          ) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

export const canModifyWorldTile = canModifyTile;

export function recomputeWorldWeather(world: WorldInstance, itemsDb: ItemDatabase): number {
  let nextWeather = 0;
  for (const t of world.tiles) {
    if (t.fg !== 0) {
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
): void {
  if (totalCount <= 0 || itemId <= 0) return;

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
    return;
  }

  let remaining = Math.floor(totalCount);
  const dropTileX = Math.floor((x + 8) / 32);
  const dropTileY = Math.floor((y + 8) / 32);

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
    world.objects.push({ uid, itemId, x, y, count: chunk, flags: 0 });
    const dropPkt = makeItemDropPacket(itemId, chunk, x, y, 0, throwerNetId);
    for (const p of world.peers) p.peer.sendPacket(0, dropPkt, true);
  }
}
