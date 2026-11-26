// Run: npx esbuild tests/block-glue.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-test.cjs && node /tmp/block-glue-test.cjs
import assert from 'node:assert/strict';
import { loadRanks } from '../server/ranks/registry';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
loadRanks(fs.mkdtempSync(path.join(os.tmpdir(), 'glue-ranks-')));
import { handleTileChangeRequest } from '../server/gamePacket/tile_change_req';
import { generateFreshWorld, serializeWorldForDisk, hydrateWorldFromDisk } from '../server/database/world';
import { TILE_FLAG_GLUE, TILE_FLAG_OPEN, serializeSingleTile, PACKET_SEND_TILE_UPDATE_DATA } from '../server/proton/packet';

const world = generateFreshWorld('GLUETEST');
const x = 50, y = 30, tile = world.tiles[y * world.width + x];
const sent: Buffer[][] = [[], []];
const s: any = { x: x * 32, y: y * 32, netId: 1, facingLeft: false, world,
  account: { userId: 1, name: 'Tester', rank: 'player', backpackSize: 20, gems: 0, inventory: [{itemId: 1866, count: 3}, {itemId: 2, count: 3}, {itemId: 14, count: 3}] },
  peer: { sendPacket(_c: number, b: Buffer) { sent[0].push(b); } } };
const viewer: any = { peer: { sendPacket(_c: number, b: Buffer) { sent[1].push(b); } } };
world.peers.add(s); world.peers.add(viewer);
const defs: Record<number, any> = {
  1866: { name: 'Block Glue', actionType: 8, flags: 0 },
  2: { name: 'Dirt', actionType: 0, flags: 0, collisionType: 0, breakHits: 1, rarity: 1 },
  14: { name: 'Background', actionType: 0, flags: 0, isBackground: true, collisionType: 0, breakHits: 1, rarity: 1 },
};
const ctx: any = { dirty: false, itemsDb: { get: (id: number) => defs[id] },
  consumeInventoryItem(_s: any, id: number, n: number) { const slot = s.account.inventory.find((i: any) => i.itemId === id); if (!slot || slot.count < n) return false; slot.count -= n; return true; },
  savePlayersNow() {}, findAccountByUserId() { return null; } };
function use(id: number) { handleTileChangeRequest(ctx, s, { value: id, punchX: x, punchY: y } as any); }
function lastTilePacket(i: number) { return sent[i].filter(p => p[4] === PACKET_SEND_TILE_UPDATE_DATA).at(-1); }
function packetFlags(b: Buffer | undefined) { assert(b); return b.readUInt16LE(66); }

assert.equal(TILE_FLAG_GLUE, 0x0800);
tile.flags = TILE_FLAG_OPEN;
use(1866);
assert.equal(tile.flags, TILE_FLAG_OPEN | TILE_FLAG_GLUE);
assert.equal(s.account.inventory[0].count, 2);
assert.equal(ctx.dirty, true);
for (let i = 0; i < 2; i++) assert.equal(packetFlags(lastTilePacket(i)), tile.flags);
assert.equal(serializeSingleTile(tile, Date.now()).readUInt16LE(6), tile.flags);
const roundtrip = hydrateWorldFromDisk(JSON.parse(JSON.stringify(serializeWorldForDisk(world))));
assert.equal(roundtrip.tiles[y * world.width + x].flags, tile.flags);
use(1866);
assert.equal(tile.flags, TILE_FLAG_OPEN);
assert.equal(s.account.inventory[0].count, 2, 'removal does not consume glue');
for (let i = 0; i < 2; i++) assert.equal(packetFlags(lastTilePacket(i)), tile.flags);
world.ownerUserId = 99;
use(1866);
assert.equal(tile.flags, TILE_FLAG_OPEN, 'no access means no modification');
assert.equal(s.account.inventory[0].count, 2);
world.ownerUserId = 0;
s.account.inventory[0].count = 0;
use(1866);
assert.equal(tile.flags, TILE_FLAG_OPEN, 'no inventory means no modification');
s.account.inventory[0].count = 2;
use(1866);
use(2);
assert.equal(tile.fg, 2);
assert.ok(tile.flags & TILE_FLAG_GLUE, 'foreground placement preserves glue');
for (let i = 0; i < 2; i++) assert.ok(packetFlags(lastTilePacket(i)) & TILE_FLAG_GLUE);
use(18);
assert.equal(tile.fg, 0);
assert.ok(tile.flags & TILE_FLAG_GLUE, 'breaking foreground preserves glue');
for (let i = 0; i < 2; i++) assert.ok(packetFlags(lastTilePacket(i)) & TILE_FLAG_GLUE);
use(14);
assert.equal(tile.bg, 14);
assert.ok(tile.flags & TILE_FLAG_GLUE, 'background placement preserves glue');
use(18);
assert.equal(tile.bg, 0);
assert.ok(tile.flags & TILE_FLAG_GLUE, 'background breaking preserves glue');
tile.flags &= ~TILE_FLAG_GLUE;
tile.fg = 2946;
tile.extra = { kind: 'display', itemId: 0 };
use(1866);
assert.ok(tile.flags & TILE_FLAG_GLUE, 'glue takes priority over display-item interaction');
assert.equal((tile.extra as any).itemId, 0);
console.log('PASS: glue toggle, inventory, permissions, full-tile broadcast, persistence, foreground/background placement and break, display');
