// Exact Growtopia / ReGrowtopia-1.50 Binary Packet Encoders & Decoders
// Verified instruction-by-instruction against ReGrowtopia-1.50.wasm:
//   Func #2766 (ProcessTankUpdatePacket)
//   Func #4565 (Table[1720], NetAvatar::HandleSetCharacterState, type=20)
//   Func #5047 / #5037 (VariantList RPCs & OnSuperMainStartAcceptLogonHrdxs47254722215a)
//   Func #5001 (Table[1824], SetHasGrowID)
//   Func #4101 (World::SerializeFromMem)
//   Func #2458 (Tile::Serialize)
//   Func #4463 (PlayerItems::Serialize)
//   Func #1737 (WorldObjectMap::HandlePacket)

export const NET_MESSAGE_SERVER_HELLO = 1;
export const NET_MESSAGE_GENERIC_TEXT = 2;
export const NET_MESSAGE_GAME_MESSAGE = 3;
export const NET_MESSAGE_GAME_PACKET = 4;

export const PACKET_STATE = 0;
export const PACKET_CALL_FUNCTION = 1;
export const PACKET_UPDATE_STATUS = 2;
export const PACKET_TILE_CHANGE_REQUEST = 3;
export const PACKET_SEND_MAP_DATA = 4;
export const PACKET_SEND_TILE_UPDATE_DATA = 5;
export const PACKET_SEND_TILE_UPDATE_DATA_MULTIPLE = 6;
export const PACKET_TILE_ACTIVATE_REQUEST = 7;
export const PACKET_TILE_APPLY_DAMAGE = 8;
export const PACKET_SEND_INVENTORY_STATE = 9;
export const PACKET_ITEM_ACTIVATE_REQUEST = 10;
export const PACKET_ITEM_ACTIVATE_OBJECT_REQUEST = 11;
export const PACKET_SEND_TILE_TREE_STATE = 12;
export const PACKET_MODIFY_ITEM_INVENTORY = 13;
export const PACKET_ITEM_CHANGE_OBJECT = 14;
export const PACKET_SEND_LOCK = 15;
export const PACKET_SEND_ITEM_DATABASE_DATA = 16;
export const PACKET_SEND_PARTICLE_EFFECT = 17;
export const PACKET_SET_ICON_STATE = 18;
export const PACKET_ITEM_EFFECT = 19;
export const PACKET_SET_CHARACTER_STATE = 20;
export const PACKET_PING_REPLY = 21;
export const PACKET_PING_REQUEST = 22;

export const TANK_FLAG_EXTENDED = 0x08;
export const TANK_FLAG_FACING_LEFT = 0x10;
export const TANK_FLAG_ON_SOLID = 0x20;

export const TILE_FLAG_HAS_EXTRA = 0x0001;
export const TILE_FLAG_LOCKED = 0x0002;
export const TILE_FLAG_SPLICED = 0x0004;
export const TILE_FLAG_SEED = 0x0010;
export const TILE_FLAG_FLIPPED = 0x0020;
export const TILE_FLAG_OPEN = 0x0040;
export const TILE_FLAG_EXTRA_VISUAL = 0x0040;
export const TILE_FLAG_HAS_WLS = 0x0200;
export const TILE_FLAG_PUBLIC = 0x0080;

// Character State bitmask flags (verified against Func #4565 avatar[156])
export const CHAR_STATE_NOCLIP       = 1 << 0;  // Walk through blocks (Ghost / Ninja / Cheat)
export const CHAR_STATE_DOUBLE_JUMP  = 1 << 1;  // Wings / Jetpack / Double Jump
export const CHAR_STATE_INVISIBLE    = 1 << 2;  // Invisible body
export const CHAR_STATE_NO_HANDS     = 1 << 3;
export const CHAR_STATE_NO_EYES      = 1 << 4;
export const CHAR_STATE_NO_BODY      = 1 << 5;
export const CHAR_STATE_DEVIL_HORNS  = 1 << 6;
export const CHAR_STATE_GOLDEN_HALO  = 1 << 7;
export const CHAR_STATE_FROZEN       = 1 << 11;
export const CHAR_STATE_CURSED       = 1 << 12;
export const CHAR_STATE_DUCT_TAPE    = 1 << 13;
export const CHAR_STATE_CIGAR        = 1 << 14;
export const CHAR_STATE_SHINING      = 1 << 15;
export const CHAR_STATE_ZOMBIE       = 1 << 16;
export const CHAR_STATE_RED_BODY     = 1 << 17;
export const CHAR_STATE_HAUNTED      = 1 << 18;
export const CHAR_STATE_GEIGER       = 1 << 19;
export const CHAR_STATE_SPOTLIGHT    = 1 << 20;
export const CHAR_STATE_SUPPORTER    = 1 << 24;

export type VariantArg =
  | string
  | { type: "f32"; value: number }
  | { type: "vec2"; x: number; y: number }
  | { type: "vec3"; x: number; y: number; z: number }
  | { type: "u32"; value: number }
  | { type: "i32"; value: number };

export interface TankPacketFields {
  type: number;
  objType?: number;
  count1?: number;
  count2?: number;
  netId?: number;
  targetNetId?: number;
  flags?: number;
  floatVar?: number;
  value?: number;
  x?: number;
  y?: number;
  speedX?: number;
  speedY?: number;
  punchX?: number;
  punchY?: number;
  extendedData?: Buffer;
}

export type TankPacket = TankPacketFields;

export function makeServerHello(): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(NET_MESSAGE_SERVER_HELLO, 0);
  return b;
}

export function makeTextPacket(msgType: number, text: string): Buffer {
  const strBuf = Buffer.from(text, "utf8");
  const out = Buffer.allocUnsafe(4 + strBuf.length + 1);
  out.writeUInt32LE(msgType, 0);
  strBuf.copy(out, 4);
  out[4 + strBuf.length] = 0;
  return out;
}

export function parseKvText(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  const cleaned = text.replace(/\0+$/g, "");
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const line = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
    const idx = line.indexOf("|");
    if (idx !== -1) {
      map[line.slice(0, idx)] = line.slice(idx + 1).replace(/\0+$/g, "");
    }
  }
  return map;
}

// Growtopia MAKE_RGBA(r, g, b, a) = (b << 24) | (g << 16) | (r << 8) | a  (0xBBGGRRAA)
// Verified against ReGrowtopia-1.50.wasm Func #2569 @ 9508..9828 & Func #1513.
export const DEFAULT_SKIN_COLOR = 0x8295c3ff >>> 0; // 2190853119 (natural Growtopia skin tone)

export const ALLOWLISTED_SKIN_COLORS: readonly number[] = [
  0x505c74ff >>> 0,
  0x647292ff >>> 0,
  0x788aa8ff >>> 0,
  0x8295c3ff >>> 0,
  0x96abbfff >>> 0,
  0xaac1dbff >>> 0,
  0xb4cceaff >>> 0,
  0xc8e1ffff >>> 0,
  0x2a8a45ff >>> 0,
  0x32ca5fff >>> 0,
  0xa3dcf9ff >>> 0,
  0x2b4bdfff >>> 0,
  0x50330fff >>> 0,
  0xc5c2ffff >>> 0,
];

export function rgbHexToGtSkinColor(hex6: string): number {
  const clean = hex6.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return DEFAULT_SKIN_COLOR;
  const r = parseInt(clean.slice(0, 2), 16) & 0xff;
  const g = parseInt(clean.slice(2, 4), 16) & 0xff;
  const b = parseInt(clean.slice(4, 6), 16) & 0xff;
  return (((b << 24) | (g << 16) | (r << 8) | 0xff) >>> 0);
}

export function normalizeGtSkinColor(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return DEFAULT_SKIN_COLOR;
  const u = num >>> 0;
  // Legacy broken default (0xFF8295C3 signed -8219197), or zero
  if (u === 0 || u === 0xff8295c3) {
    return DEFAULT_SKIN_COLOR;
  }
  if ((u & 0xff) === 0xff) {
    return u;
  }
  // Convert legacy 0xFFRRGGBB or 0x00RRGGBB -> 0xBBGGRRFF
  const hi = (u >>> 24) & 0xff;
  if (hi === 0xff || hi === 0x00) {
    const r = (u >>> 16) & 0xff;
    const g = (u >>> 8) & 0xff;
    const b = u & 0xff;
    return (((b << 24) | (g << 16) | (r << 8) | 0xff) >>> 0);
  }
  return ((u | 0xff) >>> 0);
}

export function buildTankPacket(f: TankPacketFields): Buffer {
  const ext = f.extendedData;
  const total = 4 + 56 + (ext ? ext.length : 0);
  const b = Buffer.alloc(total);
  b.writeUInt32LE(NET_MESSAGE_GAME_PACKET, 0);
  const t = 4;
  b[t + 0] = f.type & 0xff;
  b[t + 1] = (f.objType ?? 0) & 0xff;
  b[t + 2] = (f.count1 ?? 0) & 0xff;
  b[t + 3] = (f.count2 ?? 0) & 0xff;
  b.writeInt32LE((f.netId ?? -1) | 0, t + 4);
  b.writeInt32LE((f.targetNetId ?? 0) | 0, t + 8);
  let flags = f.flags ?? 0;
  if (ext) flags |= TANK_FLAG_EXTENDED;
  b.writeUInt32LE(flags >>> 0, t + 12);
  b.writeFloatLE(f.floatVar ?? 0, t + 16);
  b.writeUInt32LE((f.value ?? 0) >>> 0, t + 20);
  b.writeFloatLE(f.x ?? 0, t + 24);
  b.writeFloatLE(f.y ?? 0, t + 28);
  b.writeFloatLE(f.speedX ?? 0, t + 32);
  b.writeFloatLE(f.speedY ?? 0, t + 36);
  b.writeInt32LE(0, t + 40);
  b.writeInt32LE((f.punchX ?? 0) | 0, t + 44);
  b.writeInt32LE((f.punchY ?? 0) | 0, t + 48);
  b.writeUInt32LE(ext ? ext.length : 0, t + 52);
  if (ext) {
    ext.copy(b, 60);
  }
  return b;
}

export function parseTankPacket(payload: Buffer): TankPacketFields | null {
  if (payload.length < 60) return null;
  const t = 4;
  const extLen = payload.readUInt32LE(t + 52);
  const flags = payload.readUInt32LE(t + 12);
  let extendedData: Buffer | undefined;
  if ((flags & TANK_FLAG_EXTENDED) !== 0 && extLen > 0 && payload.length >= 60 + extLen) {
    extendedData = payload.subarray(60, 60 + extLen);
  }
  return {
    type: payload[t + 0],
    objType: payload[t + 1],
    count1: payload[t + 2],
    count2: payload[t + 3],
    netId: payload.readInt32LE(t + 4),
    targetNetId: payload.readInt32LE(t + 8),
    flags,
    floatVar: payload.readFloatLE(t + 16),
    value: payload.readUInt32LE(t + 20),
    x: payload.readFloatLE(t + 24),
    y: payload.readFloatLE(t + 28),
    speedX: payload.readFloatLE(t + 32),
    speedY: payload.readFloatLE(t + 36),
    punchX: payload.readInt32LE(t + 44),
    punchY: payload.readInt32LE(t + 48),
    extendedData,
  };
}

export function makeVariantPacket(args: VariantArg[], netId = -1, delayMs = 0): Buffer {
  const chunks: Buffer[] = [Buffer.from([args.length & 0xff])];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === "string") {
      const sb = Buffer.from(a, "utf8");
      const h = Buffer.allocUnsafe(6);
      h[0] = i;
      h[1] = 2; // TYPE_STRING
      h.writeUInt32LE(sb.length, 2);
      chunks.push(h, sb);
    } else if (a.type === "f32") {
      const h = Buffer.allocUnsafe(6);
      h[0] = i;
      h[1] = 1; // TYPE_FLOAT
      h.writeFloatLE(a.value, 2);
      chunks.push(h);
    } else if (a.type === "vec2") {
      const h = Buffer.allocUnsafe(10);
      h[0] = i;
      h[1] = 3; // TYPE_VECTOR2
      h.writeFloatLE(a.x, 2);
      h.writeFloatLE(a.y, 6);
      chunks.push(h);
    } else if (a.type === "vec3") {
      const h = Buffer.allocUnsafe(14);
      h[0] = i;
      h[1] = 4; // TYPE_VECTOR3
      h.writeFloatLE(a.x, 2);
      h.writeFloatLE(a.y, 6);
      h.writeFloatLE(a.z, 10);
      chunks.push(h);
    } else if (a.type === "u32") {
      const h = Buffer.allocUnsafe(6);
      h[0] = i;
      h[1] = 5; // TYPE_UINT32
      h.writeUInt32LE(a.value >>> 0, 2);
      chunks.push(h);
    } else if (a.type === "i32") {
      const h = Buffer.allocUnsafe(6);
      h[0] = i;
      h[1] = 9; // TYPE_INT32
      h.writeInt32LE(a.value | 0, 2);
      chunks.push(h);
    }
  }

  return buildTankPacket({
    type: PACKET_CALL_FUNCTION,
    netId,
    targetNetId: delayMs,
    flags: TANK_FLAG_EXTENDED,
    extendedData: Buffer.concat(chunks),
  });
}

// Verified instruction-by-instruction against Func #4565 (Table[1720])
export interface CharacterStateParams {
  netId: number;
  punchEffect?: number;    // avatar[352]; byte ID from the selected server-side punch mapping
  buildRangeTiles?: number; // 2 = normal (byte 128), 10 = far build (byte 136)
  punchRangeTiles?: number; // 2 = normal (byte 128), 10 = far punch (byte 136); encoding does not imply item effects
  pupilColor?: number;     // avatar[1692]
  waterSpeed?: number;     // avatar[312], default 125.0
  stateFlags?: number;     // avatar[156], CHAR_STATE_* bitmask
  moveSpeed?: number;      // avatar[292], default 250.0 (speedy = 325.0, super = 420.0)
  gravity?: number;        // avatar[284], default 1000.0 (parasol/slowfall = 250.0, lowgrav = 550.0)
  hairColor?: number;      // raw+44
  eyeDrop?: number;        // raw+48
  eyeLenses?: number;      // raw+8
}

export function makeSetCharacterStatePacket(p: CharacterStateParams): Buffer {
  const buildByte = Math.max(126, Math.min(250, 126 + (p.buildRangeTiles ?? 2)));
  const punchByte = Math.max(126, Math.min(250, 126 + (p.punchRangeTiles ?? 2)));
  return buildTankPacket({
    type: PACKET_SET_CHARACTER_STATE,
    objType: (p.punchEffect ?? 0) & 0xff,
    count1: buildByte,
    count2: punchByte,
    netId: p.netId,
    targetNetId: p.eyeLenses ?? 0,
    flags: (p.pupilColor ?? 0) >>> 0,
    floatVar: p.waterSpeed ?? 125.0,
    value: (p.stateFlags ?? 0) >>> 0,
    x: 1200.0,
    y: 200.0,
    speedX: p.moveSpeed ?? 250.0,
    speedY: p.gravity ?? 1000.0,
    punchX: p.hairColor ?? 0xFFFFFFFF,
    punchY: p.eyeDrop ?? 0xFFFFFFFF,
  });
}

// ReGrowtopia-1.50 WASM Func #320: distinct native audio + visual effects.
export const NATIVE_EFFECT_LEVEL_UP = 46;
export const NATIVE_EFFECT_ACHIEVEMENT = 48;

export function makeParticleEffectPacket(
  effectId: number, x: number, y: number, altVar = 0, delayMs = 0
): Buffer {
  // Func #2766 -> table[1761] / Func #5004 reads effect at +36,
  // position at +24/+28, effect parameter at +32 and delay at +20.
  // +16 is not read by this dispatch path. Do not put effectId in the delay.
  return buildTankPacket({
    type: PACKET_SEND_PARTICLE_EFFECT,
    netId: -1,
    x,
    y,
    speedY: effectId,
    speedX: altVar,
    value: delayMs,
  });
}

// Call only when server-side progression actually grants the corresponding event.
// These effects already play audio in the client; do not add OnPlayPositioned too.
export function makeAchievementEffectPacket(x: number, y: number): Buffer {
  return makeParticleEffectPacket(NATIVE_EFFECT_ACHIEVEMENT, x, y);
}

export function makeLevelUpEffectPacket(x: number, y: number): Buffer {
  return makeParticleEffectPacket(NATIVE_EFFECT_LEVEL_UP, x, y);
}

export function makeTileTreeStatePacket(
  x: number,
  y: number,
  harvestItemId = 0,
  targetNetId = -1,
  netId = -1
): Buffer {
  // Verified against ReGrowtopia-1.50.wasm Func #2766 @ 21631..21905 -> Func #4591:
  //   - targetNetId == -1 looks up NetAvatar by pkt->netId (MUST be session.netId >= 0!),
  //     plays audio/tree_harvest.wav at the harvester's position, spawns leaf particles,
  //     and calls Func #2877 for hit effects. Send a tile update separately to clear it.
  //   - targetNetId == 1 plays audio/wood_damage.wav; 0 falls through without this effect.
  return buildTankPacket({
    type: PACKET_SEND_TILE_TREE_STATE,
    netId,
    targetNetId,
    value: harvestItemId,
    punchX: x,
    punchY: y,
  });
}

export function makeTileChangePacket(netId: number, x: number, y: number, itemId: number, flags = 0): Buffer {
  return buildTankPacket({
    type: PACKET_TILE_CHANGE_REQUEST,
    netId,
    flags,
    value: itemId,
    punchX: x,
    punchY: y,
  });
}

// ReGrowtopia-1.50.wasm has NO "action|play_sfx" text handler; all server-triggered audio
// plays natively through OnPlayPositioned (Func #4582 -> AudioManager::Play tbl[1704]).
export function makePlaySfxPacket(file: string, delayMs = 0, netId = -1): Buffer {
  const cleanFile = file.replace(/^\/+/, "");
  return makeVariantPacket(["OnPlayPositioned", cleanFile], netId, Math.max(0, Math.floor(delayMs)));
}

// Verified against Func #4582: OnPlayPositioned plays 3D spatialized world SFX at avatar netId.
export function makePlayPositionedPacket(netId: number, file: string, delayMs = 0): Buffer {
  const cleanFile = file.replace(/^\/+/, "");
  return makeVariantPacket(["OnPlayPositioned", cleanFile], netId, Math.max(0, Math.floor(delayMs)));
}

// Verified against ReGrowtopia-1.50.wasm Func #1737 (World::HandleObjectChangePacket) + Func #2766 @ 22261..23565:
//   - netId == -1: spawns new WorldObject (++lastUid), plays audio/object_spawn2.wav natively,
//     and if throwerNetId >= 0, animates throw arc from thrower avatar via Func #1893 (tbl[1759])!
export function makeItemDropPacket(
  itemId: number,
  count: number,
  x: number,
  y: number,
  objFlags = 0,
  throwerNetId = -1
): Buffer {
  return buildTankPacket({
    type: PACKET_ITEM_CHANGE_OBJECT,
    objType: objFlags & 0xff,
    netId: -1,
    targetNetId: throwerNetId,
    floatVar: count,
    value: itemId,
    x,
    y,
  });
}

//   - netId == -3: modifies existing dropped WorldObject (uid = targetNetId) IN-PLACE without
//     incrementing lastUid, updating count = floatVar and playing audio/object_spawn2.wav natively!
export function makeItemModifyObjectPacket(
  uid: number,
  itemId: number,
  newCount: number,
  x: number,
  y: number,
  objFlags = 0
): Buffer {
  return buildTankPacket({
    type: PACKET_ITEM_CHANGE_OBJECT,
    objType: objFlags & 0xff,
    netId: -3,
    targetNetId: uid,
    floatVar: newCount,
    value: itemId,
    x,
    y,
  });
}

//   - netId >= 0: collects dropped WorldObject (uid = value), removes from world, adds to local
//     player's inventory (or gems if itemId == 112) when netId == localAvatar->netId, and plays
//     audio/object_collect.wav natively!
export function makeItemCollectPacket(collectorNetId: number, uid: number): Buffer {
  return buildTankPacket({
    type: PACKET_ITEM_CHANGE_OBJECT,
    netId: collectorNetId,
    targetNetId: -1,
    value: uid,
  });
}

export function makeModifyInventoryPacket(itemId: number, addedCount = 0, removedCount = 0): Buffer {
  return buildTankPacket({
    type: PACKET_MODIFY_ITEM_INVENTORY,
    count1: removedCount & 0xff,
    count2: addedCount & 0xff,
    value: itemId,
  });
}

// ============================================================================
// World Map & Tile Serialization (Verified against Func #4101 & Func #2458)
// ============================================================================

export interface DonationEntry {
  itemId: number;
  count: number;
  name: string;
  text: string;
}

export type TileExtra =
  | { kind: "door"; label: string; destination: string; id?: string; locked?: boolean }
  | { kind: "sign"; label: string }
  | { kind: "lock"; ownerUserId: number; ownerName?: string; adminIds: number[]; settings: number; emptyAir?: boolean; buildOnly?: boolean; limitAdmins?: boolean }
  | { kind: "vending"; itemId: number; price: number; count: number; wl: number }
  | { kind: "sucker"; itemId: number; count: number; enabled: boolean; magnetron?: boolean }
  | { kind: "provider"; plantedAtMs: number; lastProviderClaim?: number }
  | { kind: "weatherBg"; itemId: number; r?: number; g?: number; b?: number }
  | { kind: "weatherStuff"; itemId: number; gravity?: number; spin?: boolean; invert?: boolean }
  | { kind: "weatherInf"; cycleSec?: number; weatherIds?: number[] }
  | { kind: "growscan"; mode?: number }
  | { kind: "xenonite"; powers?: [number, number, number, number] }
  | { kind: "display"; itemId: number }
  | { kind: "displayShelf"; s1: number; s2: number; s3: number; s4: number }
  | { kind: "donation"; donates: DonationEntry[] }
  | { kind: "mailbox" }
  | { kind: "bulletin" }
  | { kind: "storage"; password?: string; recoveryAnswer?: string }
  | { kind: "mannequin"; label?: string; skinColor?: number; hair: number; shirt: number; pants: number; feet: number; face: number; hand: number; back: number; mask: number; neck: number }
  | { kind: "crystal"; crystals: Record<number, number> }
  | { kind: "autoAction"; fuel: number; targetItemId: number; enabled: boolean }
  | { kind: "camera" };

export interface SeedExtra {
  kind: "seed";
  plantedAtMs: number;
  fruitCount: number;
  spliced?: boolean;
}

export interface WorldTile {
  fg: number;
  bg: number;
  parentIndex: number;
  flags: number;
  extra?: TileExtra | SeedExtra;
  damage?: number;
  lastHitMs?: number;
  lastPunchWeatherMs?: number;
}

export interface DroppedObject {
  uid: number;
  itemId: number;
  x: number;
  y: number;
  count: number;
  flags: number;
}

const PROVIDER_FALLBACK_IDS = new Set([
  866, 872, 928, 1008, 1044, 1632, 2798, 3044, 3888, 4584, 5116, 5196, 6212,
]);
const WEATHER_BG_FALLBACK_IDS = new Set([3694, 4892, 5000, 5654, 5716, 6854]);
const WEATHER_STUFF_FALLBACK_IDS = new Set([3832, 5958, 6280]);
const LOCK_FALLBACK_IDS = new Set([202, 204, 206, 242, 1796, 4994, 5260, 7188, 11550, 12654]);
const DONATION_MAILBOX_IDS = new Set([656, 1006, 1452, 10784]);
const BULLETIN_STORAGE_IDS = new Set([658, 3524, 4516, 6286, 6288, 6290, 8878]);
const DISPLAY_SHELF_IDS = new Set([3794, 10190, 10552]);
const MANNEQUIN_IDS = new Set([1420, 6214, 10072, 10074, 10076, 10078]);
const CRYSTAL_BLOCK_IDS = new Set([2242, 2244, 2246, 2248, 2250]);

export function serializeSingleTile(tile: WorldTile, nowMs: number): Buffer {
  // Note: do NOT strip TILE_FLAG_EXTRA_VISUAL (0x0040) unconditionally because 0x0040 is also
  // TILE_FLAG_OPEN (doors, checkpoints, active weather machines). Strip only for vending/sucker below.
  let flags = tile.flags & ~(TILE_FLAG_HAS_EXTRA | TILE_FLAG_SEED | TILE_FLAG_HAS_WLS);
  let extraBuf: Buffer | null = null;
  let omitExtraFlag = false;

  if (tile.extra) {
    if (tile.extra.kind === "door") {
      const lb = Buffer.from(tile.extra.label, "utf8");
      extraBuf = Buffer.allocUnsafe(1 + 2 + lb.length + 1);
      extraBuf[0] = 1;
      extraBuf.writeUInt16LE(lb.length, 1);
      lb.copy(extraBuf, 3);
      extraBuf[3 + lb.length] = tile.extra.locked ? 0x08 : 0x00;
    } else if (tile.extra.kind === "sign") {
      const lb = Buffer.from(tile.extra.label, "utf8");
      extraBuf = Buffer.allocUnsafe(1 + 2 + lb.length + 4);
      extraBuf[0] = 2;
      extraBuf.writeUInt16LE(lb.length, 1);
      lb.copy(extraBuf, 3);
      extraBuf.writeInt32LE(-1, 3 + lb.length);
    } else if (tile.extra.kind === "lock") {
      flags &= ~TILE_FLAG_LOCKED;
      const admins = tile.extra.adminIds;
      extraBuf = Buffer.allocUnsafe(1 + 1 + 4 + 4 + admins.length * 4);
      extraBuf[0] = 3;
      extraBuf[1] = tile.extra.settings & 0xff;
      extraBuf.writeUInt32LE(tile.extra.ownerUserId >>> 0, 2);
      extraBuf.writeUInt32LE(admins.length, 6);
      for (let i = 0; i < admins.length; i++) {
        extraBuf.writeUInt32LE(admins[i] >>> 0, 10 + i * 4);
      }
    } else if (tile.extra.kind === "seed") {
      flags |= TILE_FLAG_SEED;
      if (tile.extra.spliced) flags |= TILE_FLAG_SPLICED;
      const ageSec = Math.max(0, Math.floor((nowMs - tile.extra.plantedAtMs) / 1000));
      extraBuf = Buffer.allocUnsafe(6);
      extraBuf[0] = 4;
      extraBuf.writeUInt32LE(ageSec >>> 0, 1);
      extraBuf[5] = tile.extra.fruitCount & 0xff;
    } else if (tile.extra.kind === "vending") {
      flags &= ~(TILE_FLAG_EXTRA_VISUAL | TILE_FLAG_HAS_WLS);
      extraBuf = Buffer.allocUnsafe(9);
      extraBuf[0] = 24;
      const isNeg = tile.extra.price < 0;
      const vendItem = (isNeg && tile.extra.itemId !== 0 && tile.extra.count < Math.abs(tile.extra.price)) ? 0 : tile.extra.itemId;
      const vendPrice = (isNeg && tile.extra.itemId !== 0 && tile.extra.count < Math.abs(tile.extra.price)) ? 0 : tile.extra.price;
      extraBuf.writeUInt32LE(vendItem >>> 0, 1);
      extraBuf.writeInt32LE(vendPrice, 5);
      if (vendItem !== 0) flags |= TILE_FLAG_EXTRA_VISUAL;
      if (tile.extra.wl > 0) flags |= TILE_FLAG_HAS_WLS;
    } else if (tile.extra.kind === "sucker") {
      flags &= ~TILE_FLAG_EXTRA_VISUAL;
      extraBuf = Buffer.allocUnsafe(15);
      extraBuf[0] = 62;
      extraBuf.writeUInt32LE(tile.extra.itemId >>> 0, 1);
      extraBuf.writeUInt32LE(tile.extra.count >>> 0, 5);
      extraBuf[9] = tile.extra.enabled ? 1 : 0;
      extraBuf[10] = tile.extra.magnetron ? 1 : 0;
      const cap = tile.fg === 5638 ? 5000 : 1500;
      extraBuf.writeUInt32LE(cap >>> 0, 11);
      if (tile.extra.itemId !== 0) flags |= TILE_FLAG_EXTRA_VISUAL;
    } else if (tile.extra.kind === "provider") {
      extraBuf = Buffer.allocUnsafe(5);
      extraBuf[0] = 9;
      const ageSec = Math.max(0, Math.floor((nowMs - tile.extra.plantedAtMs) / 1000));
      extraBuf.writeUInt32LE(ageSec >>> 0, 1);
    } else if (tile.extra.kind === "weatherBg") {
      extraBuf = Buffer.allocUnsafe(5);
      extraBuf[0] = 40;
      if (tile.fg === 3694 && tile.extra.r !== undefined) {
        const packed = ((tile.extra.b ?? 0) & 0xff) << 16 | ((tile.extra.g ?? 0) & 0xff) << 8 | ((tile.extra.r ?? 0) & 0xff);
        extraBuf.writeInt32LE(packed, 1);
      } else {
        extraBuf.writeInt32LE((tile.extra.itemId || 14) | 0, 1);
      }
    } else if (tile.extra.kind === "weatherStuff") {
      extraBuf = Buffer.allocUnsafe(10);
      extraBuf[0] = 49;
      extraBuf.writeUInt32LE((tile.extra.itemId || 2) >>> 0, 1);
      extraBuf.writeInt32LE((tile.extra.gravity ?? 50) | 0, 5);
      extraBuf[9] = (tile.extra.spin ? 1 : 0) | (tile.extra.invert ? 2 : 0);
    } else if (tile.extra.kind === "growscan") {
      extraBuf = Buffer.allocUnsafe(2);
      extraBuf[0] = 66;
      extraBuf[1] = (tile.extra.mode ?? 0) & 0xff;
    } else if (tile.extra.kind === "weatherInf") {
      const ids = tile.extra.weatherIds || [];
      extraBuf = Buffer.allocUnsafe(9 + ids.length * 4);
      extraBuf[0] = 77;
      extraBuf.writeInt32LE((tile.extra.cycleSec ?? 0) | 0, 1);
      extraBuf.writeUInt32LE(ids.length >>> 0, 5);
      for (let i = 0; i < ids.length; i++) extraBuf.writeUInt32LE(ids[i] >>> 0, 9 + i * 4);
    } else if (tile.extra.kind === "xenonite") {
      // upstream.wasm (#2458) reads 1 byte for Xenonite (fg 2072) even when TILE_FLAG_HAS_EXTRA is clear.
      omitExtraFlag = true;
      extraBuf = Buffer.from([0]);
    } else if (tile.extra.kind === "display") {
      extraBuf = Buffer.allocUnsafe(5);
      extraBuf[0] = 23;
      extraBuf.writeUInt32LE(tile.extra.itemId >>> 0, 1);
    } else if (tile.extra.kind === "displayShelf") {
      extraBuf = Buffer.allocUnsafe(17);
      extraBuf[0] = 43;
      extraBuf.writeUInt32LE(tile.extra.s1 >>> 0, 1);
      extraBuf.writeUInt32LE(tile.extra.s2 >>> 0, 5);
      extraBuf.writeUInt32LE(tile.extra.s3 >>> 0, 9);
      extraBuf.writeUInt32LE(tile.extra.s4 >>> 0, 13);
    } else if (tile.extra.kind === "donation" || tile.extra.kind === "mailbox") {
      extraBuf = Buffer.alloc(8);
      extraBuf[0] = 12;
      if (tile.extra.kind === "donation" && tile.extra.donates.length > 0) {
        flags |= TILE_FLAG_EXTRA_VISUAL;
      }
    } else if (tile.extra.kind === "bulletin" || tile.extra.kind === "storage") {
      extraBuf = Buffer.alloc(8);
      extraBuf[0] = 6;
    } else if (tile.extra.kind === "crystal") {
      extraBuf = Buffer.from([20, 0, 0]);
    } else if (tile.extra.kind === "mannequin") {
      const lb = Buffer.from(tile.extra.label || "", "utf8");
      extraBuf = Buffer.alloc(26 + lb.length);
      extraBuf[0] = 14;
      extraBuf.writeUInt16LE(lb.length, 1);
      lb.copy(extraBuf, 3);
      extraBuf[3 + lb.length] = 0;
      extraBuf.writeUInt32LE((tile.extra.skinColor ?? 0) >>> 0, 4 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.hair & 0xffff, 8 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.shirt & 0xffff, 10 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.pants & 0xffff, 12 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.feet & 0xffff, 14 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.face & 0xffff, 16 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.hand & 0xffff, 18 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.back & 0xffff, 20 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.mask & 0xffff, 22 + lb.length);
      extraBuf.writeUInt16LE(tile.extra.neck & 0xffff, 24 + lb.length);
    } else if (tile.extra.kind === "autoAction") {
      extraBuf = Buffer.alloc(13);
      extraBuf[0] = tile.fg === 6950 ? 70 : 69;
      extraBuf.writeUInt32LE(tile.extra.fuel > 0 ? 1 : 0, 1);
      extraBuf.writeUInt32LE(tile.extra.fuel >>> 0, 5);
      extraBuf.writeUInt32LE(tile.extra.targetItemId >>> 0, 9);
      if (tile.extra.enabled) flags |= TILE_FLAG_EXTRA_VISUAL;
    } else if (tile.extra.kind === "camera") {
      extraBuf = null;
    }
  }

  // Fallbacks for tiles that require extra data in upstream.wasm (#689 / VA 317184 / #2458) even if extra was uninitialized
  if (!extraBuf && tile.fg !== 0) {
    if (tile.fg === 2978 || tile.fg === 9268) {
      flags &= ~(TILE_FLAG_EXTRA_VISUAL | TILE_FLAG_HAS_WLS);
      extraBuf = Buffer.alloc(9);
      extraBuf[0] = 24;
    } else if (tile.fg === 5638 || tile.fg === 6948 || tile.fg === 6946) {
      flags &= ~TILE_FLAG_EXTRA_VISUAL;
      extraBuf = Buffer.alloc(15);
      extraBuf[0] = 62;
      const cap = tile.fg === 5638 ? 5000 : 1500;
      extraBuf.writeUInt32LE(cap, 11);
    } else if (tile.fg === 6950 || tile.fg === 6952) {
      extraBuf = Buffer.alloc(13);
      extraBuf[0] = tile.fg === 6950 ? 70 : 69;
    } else if (tile.fg === 2946) {
      extraBuf = Buffer.alloc(5);
      extraBuf[0] = 23;
    } else if (DISPLAY_SHELF_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(17);
      extraBuf[0] = 43;
    } else if (DONATION_MAILBOX_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(8);
      extraBuf[0] = 12;
    } else if (BULLETIN_STORAGE_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(8);
      extraBuf[0] = 6;
    } else if (MANNEQUIN_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(26);
      extraBuf[0] = 14;
    } else if (CRYSTAL_BLOCK_IDS.has(tile.fg)) {
      extraBuf = Buffer.from([20, 0, 0]);
    } else if (WEATHER_BG_FALLBACK_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(5);
      extraBuf[0] = 40;
      extraBuf.writeInt32LE(14, 1);
    } else if (WEATHER_STUFF_FALLBACK_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(10);
      extraBuf[0] = 49;
      extraBuf.writeUInt32LE(2, 1);
      extraBuf.writeInt32LE(50, 5);
    } else if (tile.fg === 6016) {
      extraBuf = Buffer.from([66, 0]);
    } else if (tile.fg === 10058) {
      extraBuf = Buffer.alloc(9);
      extraBuf[0] = 77;
    } else if (tile.fg === 2072) {
      // upstream.wasm (#2458) reads 1 byte for Xenonite (fg 2072) even when TILE_FLAG_HAS_EXTRA is clear.
      omitExtraFlag = true;
      extraBuf = Buffer.from([0]);
    } else if (PROVIDER_FALLBACK_IDS.has(tile.fg)) {
      extraBuf = Buffer.alloc(5);
      extraBuf[0] = 9;
    } else if (LOCK_FALLBACK_IDS.has(tile.fg)) {
      flags &= ~TILE_FLAG_LOCKED;
      extraBuf = Buffer.alloc(10);
      extraBuf[0] = 3;
    } else if (tile.fg === 6 || tile.fg === 12) {
      extraBuf = Buffer.from([1, 0, 0, 0]);
    } else if (tile.fg === 20) {
      extraBuf = Buffer.alloc(7);
      extraBuf[0] = 2;
      extraBuf.writeInt32LE(-1, 3);
    }
  }

  // Only set TILE_FLAG_HAS_EXTRA if extraBuf is actually present!
  if (extraBuf && !omitExtraFlag) {
    flags |= TILE_FLAG_HAS_EXTRA;
  }

  const isChildLocked = (flags & TILE_FLAG_LOCKED) !== 0;
  const hdrLen = isChildLocked ? 10 : 8;
  const out = Buffer.allocUnsafe(hdrLen + (extraBuf ? extraBuf.length : 0));
  out.writeUInt16LE(tile.fg & 0xffff, 0);
  out.writeUInt16LE(tile.bg & 0xffff, 2);
  out.writeUInt16LE(tile.parentIndex & 0xffff, 4);
  out.writeUInt16LE(flags & 0xffff, 6);
  if (isChildLocked) {
    out.writeUInt16LE(tile.parentIndex & 0xffff, 8);
  }
  if (extraBuf) {
    extraBuf.copy(out, hdrLen);
  }
  return out;
}

export function makeTileUpdatePacket(x: number, y: number, tile: WorldTile, nowMs: number): Buffer {
  return buildTankPacket({
    type: PACKET_SEND_TILE_UPDATE_DATA,
    punchX: x,
    punchY: y,
    flags: TANK_FLAG_EXTENDED,
    extendedData: serializeSingleTile(tile, nowMs),
  });
}

export function makeSendLockPacket(
  ownerUserId: number,
  lockItemId: number,
  lx: number,
  ly: number,
  lockedIndices: number[]
): Buffer {
  if (lockedIndices.length === 0) {
    return buildTankPacket({
      type: PACKET_SEND_LOCK,
      netId: ownerUserId,
      targetNetId: 0,
      value: lockItemId,
      punchX: lx,
      punchY: ly,
      flags: 0,
    });
  }
  const ext = Buffer.allocUnsafe(lockedIndices.length * 2);
  for (let i = 0; i < lockedIndices.length; i++) {
    ext.writeUInt16LE(lockedIndices[i] & 0xffff, i * 2);
  }
  return buildTankPacket({
    type: PACKET_SEND_LOCK,
    netId: ownerUserId,
    targetNetId: lockedIndices.length,
    value: lockItemId,
    punchX: lx,
    punchY: ly,
    flags: TANK_FLAG_EXTENDED,
    extendedData: ext,
  });
}

export function makeWorldMapPacket(
  name: string,
  width: number,
  height: number,
  tiles: WorldTile[],
  objects: DroppedObject[],
  lastObjectUid: number,
  weatherId: number,
  nowMs: number
): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const header = Buffer.alloc(6 + 2 + nameBuf.length + 12);
  header.writeUInt16LE(4, 0);
  header.writeUInt32LE(0, 2);
  header.writeUInt16LE(nameBuf.length, 6);
  nameBuf.copy(header, 8);
  const dimsOff = 8 + nameBuf.length;
  header.writeUInt32LE(width, dimsOff);
  header.writeUInt32LE(height, dimsOff + 4);
  header.writeUInt32LE(tiles.length, dimsOff + 8);

  const tileChunks: Buffer[] = [header];
  for (let i = 0; i < tiles.length; i++) {
    tileChunks.push(serializeSingleTile(tiles[i], nowMs));
  }

  const objBuf = Buffer.alloc(8 + objects.length * 16 + 6);
  objBuf.writeUInt32LE(objects.length, 0);
  objBuf.writeUInt32LE(lastObjectUid >>> 0, 4);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    const base = 8 + i * 16;
    objBuf.writeUInt16LE(o.itemId & 0xffff, base + 0);
    objBuf.writeFloatLE(o.x, base + 2);
    objBuf.writeFloatLE(o.y, base + 6);
    objBuf.writeUInt16LE(o.count & 0xffff, base + 10);
    objBuf.writeUInt32LE(o.uid >>> 0, base + 12);
  }
  const wOff = 8 + objects.length * 16;
  objBuf.writeUInt16LE(weatherId & 0xffff, wOff + 0);
  objBuf.writeUInt16LE(0, wOff + 2);
  objBuf.writeUInt16LE(weatherId & 0xffff, wOff + 4);

  tileChunks.push(objBuf);

  return buildTankPacket({
    type: PACKET_SEND_MAP_DATA,
    flags: TANK_FLAG_EXTENDED,
    extendedData: Buffer.concat(tileChunks),
  });
}

export interface InventorySlot {
  itemId: number;
  count: number;
  equipped?: boolean;
}

export function makeInventoryPacket(backpackSize: number, slots: InventorySlot[]): Buffer {
  const valid = slots.filter((s) => s.count > 0);
  const ext = Buffer.allocUnsafe(7 + valid.length * 4);
  ext[0] = 1;
  ext.writeUInt32LE(backpackSize, 1);
  ext.writeUInt16LE(valid.length, 5);
  for (let i = 0; i < valid.length; i++) {
    const off = 7 + i * 4;
    ext.writeUInt16LE(valid[i].itemId & 0xffff, off);
    ext[off + 2] = Math.min(200, valid[i].count) & 0xff;
    // CRITICAL (Verified against ReGrowtopia-1.50.wasm Func #4579 @ 2068..2110):
    // PlayerItems::Serialize writes invSlot->flags directly WITHOUT populating m_clothes[0..9],
    // and OnSetClothing XOR-toggles invSlot->flags ^= 1 (`1 ^ 1 = 0`) and clears m_clothes[slot]
    // if flags already had bit 0 set! Always send 0 here so the immediately-following
    // OnSetClothing packet cleanly equips every worn item (`0 ^ 1 = 1`) on join & rejoin!
    ext[off + 3] = 0;
  }
  return buildTankPacket({
    type: PACKET_SEND_INVENTORY_STATE,
    flags: TANK_FLAG_EXTENDED,
    extendedData: ext,
  });
}
