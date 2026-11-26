// Run: npx esbuild tests/fire-water.ts --bundle --platform=node --format=cjs --outfile=/tmp/fire-water-test.cjs && node /tmp/fire-water-test.cjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRanks } from '../server/ranks/registry';
loadRanks(fs.mkdtempSync(path.join(os.tmpdir(), 'fire-water-ranks-')));
import { handleTileChangeRequest } from '../server/gamePacket/tile_change_req';
import { generateFreshWorld } from '../server/database/world';
import { PACKET_ITEM_EFFECT, TILE_FLAG_BURNT, TILE_FLAG_WATER } from '../server/proton/packet';

const world = generateFreshWorld('FIRETEST');
const x = 50, y = 30, tile = world.tiles[y * world.width + x];
tile.fg = 2;
const sent: Buffer[] = [];
const s: any = { x: x * 32, y: y * 32, netId: 1, facingLeft: false, world,
  account: { userId: 1, name: 'Tester', rank: 'player', backpackSize: 20, gems: 0, inventory: [
    { itemId: 3062, count: 3 }, { itemId: 822, count: 3 }, { itemId: 2, count: 3 }
  ] },
  peer: { sendPacket(_c: number, b: Buffer) { sent.push(b); } } };
const viewer: any = { peer: { sendPacket(_c: number, b: Buffer) { sent.push(b); } } };
world.peers.add(s); world.peers.add(viewer);
const defs: Record<number, any> = {
  3062: { name: 'Pocket Lighter', actionType: 8, flags: 0 },
  822: { name: 'Water Bucket', actionType: 8, flags: 0 },
  2: { name: 'Dirt', actionType: 0, flags: 0, collisionType: 0, breakHits: 1, rarity: 1 },
};
const ctx: any = { dirty: false, itemsDb: { get: (id: number) => defs[id] },
  consumeInventoryItem(_s: any, id: number, n: number) { const slot = s.account.inventory.find((i: any) => i.itemId === id); if (!slot || slot.count < n) return false; slot.count -= n; return true; },
  savePlayersNow() {}, findAccountByUserId() { return null; } };
function use(id: number) { handleTileChangeRequest(ctx, s, { value: id, punchX: x, punchY: y } as any); }
function effectPackets() { return sent.filter(p => p[4] === PACKET_ITEM_EFFECT).length; }
function count(id: number) { return s.account.inventory.find((i: any) => i.itemId === id).count; }

// Water Bucket toggles water normally.
use(822);
assert.ok(tile.flags & TILE_FLAG_WATER, 'water bucket places water');
assert.equal(count(822), 2);
use(822);
assert.equal(tile.flags & TILE_FLAG_WATER, 0, 'water bucket picks water back up');
assert.equal(count(822), 2);

// Pocket Lighter lights the tile instantly, without a placement/item effect.
const beforeLighterEffects = effectPackets();
use(3062);
assert.ok(tile.flags & TILE_FLAG_BURNT, 'lighter sets the fire flag');
assert.equal(tile.flags & TILE_FLAG_WATER, 0, 'lighter evaporates water');
assert.equal(count(3062), 2);
assert.equal(effectPackets(), beforeLighterEffects, 'lighter sends no item-placement effect');

// Water Bucket douses the fire and does NOT leave a water tile.
use(822);
assert.equal(tile.flags & TILE_FLAG_BURNT, 0, 'water puts the fire out');
assert.equal(tile.flags & TILE_FLAG_WATER, 0, 'dousing does not turn the tile into water');
assert.equal(count(822), 1, 'dousing consumes one bucket');
use(3062);
assert.ok(tile.flags & TILE_FLAG_BURNT);
use(3062);
assert.equal(count(3062), 1, 'already burning does not consume another lighter');

// Background-only tiles have no native fire pass in the client, so the
// AstroSource foreground gate must reject them instead of setting an invisible flag.
tile.fg = 0; tile.bg = 14; tile.flags = 0;
const lighterBeforeBg = count(3062);
use(3062);
assert.equal(tile.flags & TILE_FLAG_BURNT, 0, 'background-only tile does not burn');
assert.equal(count(3062), lighterBeforeBg, 'background-only rejection does not consume the lighter');
console.log('PASS: pocket lighter instant fire without placement effect; water douses fire without leaving water; background-only tile rejected');
