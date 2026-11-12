const OP_I32_CONST = 0x41;
const OP_I64_CONST = 0x42;
const OP_F32_CONST = 0x43;
const OP_F64_CONST = 0x44;
const OP_LOCAL_GET = 0x20;
const OP_LOCAL_SET = 0x21;
const OP_LOCAL_TEE = 0x22;
const OP_GLOBAL_GET = 0x23;
const OP_GLOBAL_SET = 0x24;
const OP_I32_LOAD = 0x28;
const OP_I32_STORE = 0x36;
const OP_I64_STORE = 0x37;
const OP_I32_EQZ = 0x45;
const OP_I32_EQ = 0x46;
const OP_I32_LT_U = 0x49;
const OP_I32_ADD = 0x6a;
const OP_I32_MUL = 0x6c;
const OP_I32_AND = 0x71;
const OP_I32_SHR_U = 0x76;
const OP_CALL = 0x10;
const OP_LOOP = 0x03;
const OP_IF = 0x04;
const OP_ELSE = 0x05;
const OP_BR_IF = 0x0d;
const OP_END = 0x0b;

const BLOCK_VOID = 0x40;
const BLOCK_I32 = 0x7f;

function readVarUint(buf: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = buf[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, pos];
    shift += 7;
  }
}

function encodeVarUint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (true) {
    const byte = v & 0x7f;
    v >>>= 7;
    out.push(v !== 0 ? byte | 0x80 : byte);
    if (v === 0) return out;
  }
}

function encodeVarInt(value: number): number[] {
  const out: number[] = [];
  let v = value | 0;
  while (true) {
    const byte = v & 0x7f;
    v >>= 7;
    const done = (v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

function findSequence(buf: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function patchGlobalSection(payload: Uint8Array): { next: Uint8Array; newGlobalIndex: number } {
  const [count, afterCount] = readVarUint(payload, 0);
  // 0x7f (i32), 0x01 (mutable), 0x41 0x00 (i32.const 0), 0x0b (end)
  const extraGlobal = new Uint8Array([0x7f, 0x01, OP_I32_CONST, 0x00, OP_END]);
  const newCountBytes = encodeVarUint(count + 1);
  const rest = payload.subarray(afterCount);
  const out = new Uint8Array(newCountBytes.length + rest.length + extraGlobal.length);
  out.set(newCountBytes, 0);
  out.set(rest, newCountBytes.length);
  out.set(extraGlobal, newCountBytes.length + rest.length);
  return { next: out, newGlobalIndex: count };
}

const DYE_TABLE_BYTES = 8192; // 512 slots * 16 bytes: [statePtr, pupilColor, eyeColor, reserved]

function encodeDyeSlotAddr(baseExpr: number[], pupilGlobalIdx: number): number[] {
  const gIdx = encodeVarUint(pupilGlobalIdx);
  return [
    OP_GLOBAL_GET, ...gIdx,
    ...baseExpr, OP_I32_CONST, 4, OP_I32_SHR_U,
    OP_I32_CONST, ...encodeVarInt(511), OP_I32_AND,
    OP_I32_CONST, 16, OP_I32_MUL, OP_I32_ADD,
  ];
}

function build4565Prelude(pupilGlobalIdx: number): number[] {
  const gIdx = encodeVarUint(pupilGlobalIdx);
  const call310 = encodeVarUint(310);
  // local[0] is NetAvatar*; AvatarPacketRenderer* (statePtr) is at NetAvatar + 516.
  // Hair renderer Func #1262 reads hairColor natively from statePtr + 48 (NetAvatar + 564).
  const statePtrExpr = [OP_LOCAL_GET, 0, OP_I32_CONST, ...encodeVarInt(516), OP_I32_ADD];
  return [
    // if (pkt[44] != 0) *(NetAvatar + 564) = pkt[44]; (hairColor on AvatarPacketRenderer + 48)
    OP_LOCAL_GET, 1, OP_I32_LOAD, 0x02, ...encodeVarUint(44),
    OP_LOCAL_TEE, 2, OP_I32_EQZ, OP_IF, BLOCK_VOID, OP_ELSE,
      OP_LOCAL_GET, 0, OP_LOCAL_GET, 2, OP_I32_STORE, 0x02, ...encodeVarUint(564),
    OP_END,

    // Lazy-init 8192-byte [statePtr, pupilColor, eyeColor, 0] direct-mapped table in new global
    OP_GLOBAL_GET, ...gIdx, OP_I32_EQZ, OP_IF, BLOCK_VOID,
      OP_I32_CONST, ...encodeVarInt(DYE_TABLE_BYTES), OP_CALL, ...call310,
      OP_LOCAL_TEE, 2, OP_GLOBAL_SET, ...gIdx,
      OP_I32_CONST, 0, OP_LOCAL_SET, 3,
      OP_LOOP, BLOCK_VOID,
        OP_LOCAL_GET, 2, OP_LOCAL_GET, 3, OP_I32_ADD,
        OP_I64_CONST, 0, OP_I64_STORE, 0x03, 0x00,
        OP_LOCAL_GET, 3, OP_I32_CONST, 8, OP_I32_ADD, OP_LOCAL_TEE, 3,
        OP_I32_CONST, ...encodeVarInt(DYE_TABLE_BYTES), OP_I32_LT_U, OP_BR_IF, 0,
      OP_END,
    OP_END,

    // local[2] = slotAddr for statePtr = local[0] + 516
    ...encodeDyeSlotAddr(statePtrExpr, pupilGlobalIdx),
    OP_LOCAL_TEE, 2,
    ...statePtrExpr, OP_I32_STORE, 0x02, 0x00,
    // slot[4] = pkt[8] (pupil / lensColor)
    OP_LOCAL_GET, 2,
    OP_LOCAL_GET, 1, OP_I32_LOAD, 0x02, ...encodeVarUint(8),
    OP_I32_STORE, 0x02, 0x04,
    // slot[8] = pkt[48] (sclera / eyeDropColor)
    OP_LOCAL_GET, 2,
    OP_LOCAL_GET, 1, OP_I32_LOAD, 0x02, ...encodeVarUint(48),
    OP_I32_STORE, 0x02, 0x08,

    // Clear temps before original body runs
    OP_I32_CONST, 0, OP_LOCAL_SET, 2,
    OP_I32_CONST, 0, OP_LOCAL_SET, 3,
  ];
}

function build1942SlotTintExpr(pupilGlobalIdx: number, slotFieldOffset: number): number[] {
  const gIdx = encodeVarUint(pupilGlobalIdx);
  const call366 = encodeVarUint(366);
  const slotAddr = encodeDyeSlotAddr([OP_LOCAL_GET, 6], pupilGlobalIdx);
  return [
    OP_GLOBAL_GET, ...gIdx, OP_I32_EQZ, OP_IF, BLOCK_I32,
      OP_LOCAL_GET, 3,
    OP_ELSE,
      ...slotAddr, OP_I32_LOAD, 0x02, 0x00,
      OP_LOCAL_GET, 6, OP_I32_EQ, OP_IF, BLOCK_I32,
        ...slotAddr, OP_I32_LOAD, 0x02, ...encodeVarUint(slotFieldOffset),
        OP_I32_EQZ, OP_IF, BLOCK_I32,
          OP_LOCAL_GET, 3,
        OP_ELSE,
          OP_LOCAL_GET, 3,
          ...slotAddr, OP_I32_LOAD, 0x02, ...encodeVarUint(slotFieldOffset),
          OP_F32_CONST, 0x00, 0x00, 0x80, 0x3f,
          OP_CALL, ...call366,
        OP_END,
      OP_ELSE,
        OP_LOCAL_GET, 3,
      OP_END,
    OP_END,
  ];
}

function patchFunc4565(body: Uint8Array, pupilGlobalIdx: number): Uint8Array {
  // Expected header: localDeclCount=2, (2 x i32), (4 x f32) -> [0x02, 0x02, 0x7f, 0x04, 0x7d]
  if (
    body[0] !== 0x02 ||
    body[1] !== 0x02 ||
    body[2] !== 0x7f ||
    body[3] !== 0x04 ||
    body[4] !== 0x7d
  ) {
    throw new Error("[dye-appearance] Unexpected Func #4565 locals signature");
  }
  const prelude = build4565Prelude(pupilGlobalIdx);
  const out = new Uint8Array(5 + prelude.length + (body.length - 5));
  out.set(body.subarray(0, 5), 0);
  out.set(prelude, 5);
  out.set(body.subarray(5), 5 + prelude.length);
  return out;
}

function patchFunc1942(body: Uint8Array, pupilGlobalIdx: number): Uint8Array {
  // Frame 4 (sclera): i32.const 4, i32.const 1, local.get 5, i32.const 88, i32.add, ... i32.const 2, [local.get 3], f32.const 0
  const scleraSig = [
    0x41, 0x04, 0x41, 0x01, 0x20, 0x05, 0x41, 0xd8, 0x00, 0x6a,
    0x20, 0x05, 0x41, 0xd0, 0x00, 0x6a, 0x41, 0x02,
    0x20, 0x03, // <-- offset +18..+19
    0x43, 0x00, 0x00, 0x00, 0x00, 0x20, 0x05, 0x41, 0xc8, 0x00, 0x6a, 0x20, 0x04, 0x41, 0x00, 0x10, 0xc2, 0x02,
  ];
  const sIdx = findSequence(body, scleraSig);
  if (sIdx < 0) throw new Error("[dye-appearance] Func #1942 sclera pattern not found");
  const eyeExpr = build1942SlotTintExpr(pupilGlobalIdx, 8);
  const sTarget = sIdx + 18;
  const mid = new Uint8Array(body.length - 2 + eyeExpr.length);
  mid.set(body.subarray(0, sTarget), 0);
  mid.set(eyeExpr, sTarget);
  mid.set(body.subarray(sTarget + 2), sTarget + eyeExpr.length);

  // Frame 5 (pupil): i32.const 5, i32.const 1, local.get 5, i32.const -64, i32.sub, ... i32.const 2, [local.get 3], f32.const 0
  const pupilSig = [
    0x41, 0x05, 0x41, 0x01, 0x20, 0x05, 0x41, 0x40, 0x6b,
    0x20, 0x05, 0x41, 0x38, 0x6a, 0x41, 0x02,
    0x20, 0x03, // <-- offset +16..+17
    0x43, 0x00, 0x00, 0x00, 0x00, 0x20, 0x05, 0x41, 0x30, 0x6a, 0x20, 0x04, 0x41, 0x00, 0x10, 0xc2, 0x02,
  ];
  const pIdx = findSequence(mid, pupilSig);
  if (pIdx < 0) throw new Error("[dye-appearance] Func #1942 pupil pattern not found");
  const pupilExpr = build1942SlotTintExpr(pupilGlobalIdx, 4);
  const pTarget = pIdx + 16;
  const out = new Uint8Array(mid.length - 2 + pupilExpr.length);
  out.set(mid.subarray(0, pTarget), 0);
  out.set(pupilExpr, pTarget);
  out.set(mid.subarray(pTarget + 2), pTarget + pupilExpr.length);
  return out;
}

function countImportedFuncs(importPayload: Uint8Array): number {
  let pos = 0;
  const [count, next] = readVarUint(importPayload, pos);
  pos = next;
  let funcs = 0;
  for (let i = 0; i < count; i++) {
    const [mLen, p1] = readVarUint(importPayload, pos);
    pos = p1 + mLen;
    const [nLen, p2] = readVarUint(importPayload, pos);
    pos = p2 + nLen;
    const kind = importPayload[pos++];
    if (kind === 0) {
      funcs++;
      const [, p3] = readVarUint(importPayload, pos);
      pos = p3;
    } else if (kind === 1) {
      pos++;
      const flags = importPayload[pos++];
      const [, p3] = readVarUint(importPayload, pos);
      pos = p3;
      if (flags & 1) {
        const [, p4] = readVarUint(importPayload, pos);
        pos = p4;
      }
    } else if (kind === 2) {
      const flags = importPayload[pos++];
      const [, p3] = readVarUint(importPayload, pos);
      pos = p3;
      if (flags & 1) {
        const [, p4] = readVarUint(importPayload, pos);
        pos = p4;
      }
    } else if (kind === 3) {
      pos += 2;
    }
  }
  return funcs;
}

/** Patches Hair Dye, Eye Drops, and Contact Lens rendering into the WASM client module. */
export function patchDyeAppearance(input: Uint8Array): Uint8Array {
  let pos = 8;
  let importedFuncs = 308;
  let pupilGlobalIdx = 12;
  const sections: Array<{ id: number; payload: Uint8Array }> = [];

  while (pos < input.length) {
    const id = input[pos++];
    const [size, start] = readVarUint(input, pos);
    const end = start + size;
    const payload = input.subarray(start, end);
    pos = end;

    if (id === 2) {
      importedFuncs = countImportedFuncs(payload);
      sections.push({ id, payload });
    } else if (id === 6) {
      const { next, newGlobalIndex } = patchGlobalSection(payload);
      pupilGlobalIdx = newGlobalIndex;
      sections.push({ id, payload: next });
    } else if (id === 10) {
      const [fnCount, bodyStart] = readVarUint(payload, 0);
      let cur = bodyStart;
      const bodies: Uint8Array[] = [];
      for (let i = 0; i < fnCount; i++) {
        const [bodyLen, bStart] = readVarUint(payload, cur);
        let body = payload.subarray(bStart, bStart + bodyLen);
        const fid = importedFuncs + i;
        if (fid === 1942) {
          body = patchFunc1942(body, pupilGlobalIdx);
        } else if (fid === 4565) {
          body = patchFunc4565(body, pupilGlobalIdx);
        }
        bodies.push(body);
        cur = bStart + bodyLen;
      }
      const chunks: number[] = [...encodeVarUint(fnCount)];
      for (const body of bodies) {
        chunks.push(...encodeVarUint(body.length));
        for (let j = 0; j < body.length; j++) chunks.push(body[j]);
      }
      sections.push({ id, payload: new Uint8Array(chunks) });
    } else {
      sections.push({ id, payload });
    }
  }

  const totalBody: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  for (const sec of sections) {
    totalBody.push(sec.id, ...encodeVarUint(sec.payload.length));
    for (let j = 0; j < sec.payload.length; j++) totalBody.push(sec.payload[j]);
  }
  const output = new Uint8Array(totalBody);
  if (!WebAssembly.validate(output)) {
    throw new Error("[dye-appearance] Patched WASM failed WebAssembly.validate()");
  }
  return output;
}
