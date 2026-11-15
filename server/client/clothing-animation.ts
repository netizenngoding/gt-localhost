/**
 * Patches clothing item rendering, animations, and effects in the WASM client:
 * 1. Adds a shared `resolveExtraAnimFrame(itemInfoPtr, packedDefaultXY)` helper
 *    that parses `ItemInfo.extraOptions` (`x,y|x,y|...` at offset 172..183) when
 *    `(ItemInfo.fxFlags & 1) !== 0` (offset 164), cycling frames at 200ms using
 *    `g_pApp->m_gameTimer` (`[393364] + 468`) with ping-pong support (`fxFlags & 2`).
 * 2. Hooks `(texX, texY)` loads in all clothing renderers (Face 781, Hair/Hat 1262,
 *    Pants/Shoes 1263, Shirt 1937, Back front-pass 1938, Hand 1939, Neck 1940,
 *    Back 1941, 1510, 5455, 5459) so all `extraOptions` frame-list items animate.
 * 3. Suppresses the 100ms `(tx+1)` blink toggle in `fid 1941` on `kind == 4` capes
 *    with `(flags & 0x2000)` or `(fxFlags & 1)` (e.g. Neon Party Cape 11300).
 * 4. Updates `fid 1510` so `kind == 30 && (fxFlags & 1)` off-hand draws `(tx+2, ty)`
 *    and skips the duplicate pulsing 2nd-hand draw in `fid 1939` for `extraOptions`
 *    animated items (e.g. Exquisite Gauntlet of Elements 6878).
 * 5. Adds Goku Aura (`particleId = 59`) emission in `fid 1945` when `hair == 6008`.
 */

function readUleb(buf: Uint8Array, pos: number): [number, number] {
  let val = 0;
  let shift = 0;
  while (true) {
    const b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [val >>> 0, pos];
    shift += 7;
  }
}

function writeUleb(val: number): number[] {
  const out: number[] = [];
  let v = val >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

function writeSleb(val: number): number[] {
  const out: number[] = [];
  let v = val | 0;
  while (true) {
    const b = v & 0x7f;
    v >>= 7;
    const done = (v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0);
    out.push(done ? b : (b | 0x80));
    if (done) break;
  }
  return out;
}

function countFuncImports(sec2: Uint8Array): number {
  let p = 0;
  const [count, p1] = readUleb(sec2, p);
  p = p1;
  let funcImports = 0;
  for (let i = 0; i < count; i++) {
    const [ml, p2] = readUleb(sec2, p);
    p = p2 + ml;
    const [nl, p3] = readUleb(sec2, p);
    p = p3 + nl;
    const kind = sec2[p++];
    if (kind === 0) {
      [, p] = readUleb(sec2, p);
      funcImports++;
    } else if (kind === 1) {
      p++;
      const [flags, p4] = readUleb(sec2, p);
      [, p] = readUleb(sec2, p4);
      if (flags & 1) [, p] = readUleb(sec2, p);
    } else if (kind === 2) {
      const [flags, p4] = readUleb(sec2, p);
      [, p] = readUleb(sec2, p4);
      if (flags & 1) [, p] = readUleb(sec2, p);
    } else if (kind === 3) {
      p += 2;
    }
  }
  return funcImports;
}

function ensureI32I32ToI32Type(sec1: Uint8Array): { data: Uint8Array; typeIdx: number } {
  let p = 0;
  const [count, p1] = readUleb(sec1, p);
  p = p1;
  for (let i = 0; i < count; i++) {
    if (sec1[p++] !== 0x60) throw new Error("Invalid WASM type entry");
    const [np, p2] = readUleb(sec1, p);
    p = p2;
    const params = sec1.subarray(p, p + np);
    p += np;
    const [nr, p3] = readUleb(sec1, p);
    p = p3;
    const rets = sec1.subarray(p, p + nr);
    p += nr;
    if (np === 2 && params[0] === 0x7f && params[1] === 0x7f && nr === 1 && rets[0] === 0x7f) {
      return { data: sec1, typeIdx: i };
    }
  }
  const rest = sec1.subarray(p1);
  const out = Buffer.concat([
    Buffer.from(writeUleb(count + 1)),
    Buffer.from(rest),
    Buffer.from([0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f]),
  ]);
  return { data: out, typeIdx: count };
}

/**
 * Builds the WASM function body (without the outer byte-length prefix) for:
 *   resolveExtraAnimFrame(p0: itemInfoPtr, p1: packedDefaultXY) -> i32
 * Locals:
 *   2: len, 3: ptr, 4: i, 5: count, 6: val, 7: curX, 8: target, 9: ch, 10: digitSeen
 */
function buildResolveExtraAnimBody(): Buffer {
  const b: number[] = [];
  const emit = (...bytes: number[]) => b.push(...bytes);

  // 1 local decl group: 9 x i32 (locals 2..10)
  emit(0x01, 0x09, 0x7f);

  // if (!itemInfoPtr) return p1;
  emit(0x20, 0x00, 0x45, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);

  // if ((i32.load8_u(itemInfoPtr + 164) & 1) === 0) return p1;
  emit(0x20, 0x00, 0x2d, 0x00, ...writeUleb(164), 0x41, 0x01, 0x71, 0x45, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);

  // tag = i32.load8_s (itemInfoPtr + 183)
  emit(0x20, 0x00, 0x2c, 0x00, ...writeUleb(183));
  // if (tag >= 0) { len = tag; ptr = itemInfoPtr + 172; } else { len = i32.load(176); ptr = i32.load(172); }
  emit(0x41, 0x00, 0x4e); // i32.ge_s
  emit(0x04, 0x40);
  emit(0x20, 0x00, 0x2c, 0x00, ...writeUleb(183), 0x21, 0x02);
  emit(0x20, 0x00, 0x41, ...writeSleb(172), 0x6a, 0x21, 0x03);
  emit(0x05);
  emit(0x20, 0x00, 0x28, 0x02, ...writeUleb(176), 0x21, 0x02);
  emit(0x20, 0x00, 0x28, 0x02, ...writeUleb(172), 0x21, 0x03);
  emit(0x0b);

  // if (len < 4 || len > 4096 || ptr < 1024) return p1;
  emit(
    0x20, 0x02, 0x41, 0x04, 0x49,
    0x20, 0x02, 0x41, ...writeSleb(4096), 0x4b, 0x72,
    0x20, 0x03, 0x41, ...writeSleb(1024), 0x49, 0x72,
    0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b
  );

  // Pass 1: validate and count `x,y|...` entries
  // i = 0; count = 0;
  emit(0x41, 0x00, 0x21, 0x04, 0x41, 0x00, 0x21, 0x05);
  emit(0x02, 0x40); // block $p1_done
  emit(0x03, 0x40); // loop $p1_loop
  // if (i >= len) br $p1_done
  emit(0x20, 0x04, 0x20, 0x02, 0x4e, 0x0d, 0x01);

  // Parse X digits: digitSeen = 0
  emit(0x41, 0x00, 0x21, 0x0a);
  emit(0x02, 0x40, 0x03, 0x40); // block; loop
  emit(0x20, 0x04, 0x20, 0x02, 0x4e, 0x0d, 0x01); // i >= len -> br
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x22, 0x09); // ch = mem[ptr+i]
  emit(0x41, 0x30, 0x6b, 0x41, 0x0a, 0x4f); // (ch - '0') >= 10u
  emit(0x0d, 0x01);
  emit(0x41, 0x01, 0x21, 0x0a); // digitSeen = 1
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04); // i++
  emit(0x0c, 0x00, 0x0b, 0x0b); // continue; end loop; end block

  // if (!digitSeen || i >= len || mem[ptr+i] != ',') return p1;
  emit(0x20, 0x0a, 0x45, 0x20, 0x04, 0x20, 0x02, 0x4e, 0x72, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x41, 0x2c, 0x47); // != ','
  emit(0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04); // i++

  // Parse Y digits: digitSeen = 0
  emit(0x41, 0x00, 0x21, 0x0a);
  emit(0x02, 0x40, 0x03, 0x40);
  emit(0x20, 0x04, 0x20, 0x02, 0x4e, 0x0d, 0x01);
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x22, 0x09);
  emit(0x41, 0x30, 0x6b, 0x41, 0x0a, 0x4f); // (ch - '0') >= 10u
  emit(0x0d, 0x01);
  emit(0x41, 0x01, 0x21, 0x0a);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04);
  emit(0x0c, 0x00, 0x0b, 0x0b);

  // if (!digitSeen) return p1;
  emit(0x20, 0x0a, 0x45, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);
  // if (i < len) { if (mem[ptr+i] != '|') return p1; i++; }
  emit(0x20, 0x04, 0x20, 0x02, 0x49, 0x04, 0x40);
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x41, ...writeSleb(0x7c), 0x47);
  emit(0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04);
  emit(0x0b);

  // count++; continue
  emit(0x20, 0x05, 0x41, 0x01, 0x6a, 0x21, 0x05);
  emit(0x0c, 0x00, 0x0b, 0x0b);

  // if (count < 2) return p1;
  emit(0x20, 0x05, 0x41, 0x02, 0x49, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);

  // app = i32.load(393364); if (!app) return p1;
  emit(0x41, ...writeSleb(393364), 0x28, 0x02, 0x00, 0x22, 0x06, 0x45, 0x04, 0x40, 0x20, 0x01, 0x0f, 0x0b);
  // tick = i32.load(app + 468) /u 200
  emit(0x20, 0x06, 0x28, 0x02, ...writeUleb(468), 0x41, ...writeSleb(200), 0x6e, 0x21, 0x08);
  // Support ping-pong wave when (fxFlags & 2) != 0
  emit(0x20, 0x00, 0x2d, 0x00, ...writeUleb(164), 0x41, 0x02, 0x71, 0x04, 0x40);
  emit(0x20, 0x05, 0x41, 0x01, 0x74, 0x41, 0x02, 0x6b, 0x21, 0x06); // val = (count << 1) - 2
  emit(0x20, 0x08, 0x20, 0x06, 0x70, 0x22, 0x08); // target = tick %u val
  emit(0x20, 0x05, 0x4f); // target >=u count
  emit(0x04, 0x40, 0x20, 0x06, 0x20, 0x08, 0x6b, 0x21, 0x08, 0x0b);
  emit(0x05);
  emit(0x20, 0x08, 0x20, 0x05, 0x70, 0x21, 0x08);
  emit(0x0b);

  // Pass 2: extract frame `target`
  // i = 0; count = 0;
  emit(0x41, 0x00, 0x21, 0x04, 0x41, 0x00, 0x21, 0x05);
  emit(0x02, 0x40, 0x03, 0x40);
  emit(0x20, 0x04, 0x20, 0x02, 0x4e, 0x0d, 0x01);

  // parse curX
  emit(0x41, 0x00, 0x21, 0x07);
  emit(0x02, 0x40, 0x03, 0x40);
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x22, 0x09);
  emit(0x41, 0x2c, 0x46, 0x0d, 0x01); // == ',' -> br
  emit(0x20, 0x07, 0x41, 0x0a, 0x6c, 0x20, 0x09, 0x41, 0x30, 0x6b, 0x6a, 0x21, 0x07);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04, 0x0c, 0x00, 0x0b, 0x0b);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04); // skip ','

  // parse curY in val
  emit(0x41, 0x00, 0x21, 0x06);
  emit(0x02, 0x40, 0x03, 0x40);
  emit(0x20, 0x04, 0x20, 0x02, 0x4e, 0x0d, 0x01);
  emit(0x20, 0x03, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00, 0x22, 0x09);
  emit(0x41, ...writeSleb(0x7c), 0x46, 0x0d, 0x01); // == '|' -> br
  emit(0x20, 0x06, 0x41, 0x0a, 0x6c, 0x20, 0x09, 0x41, 0x30, 0x6b, 0x6a, 0x21, 0x06);
  emit(0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04, 0x0c, 0x00, 0x0b, 0x0b);

  // if (count == target) return (curX & 0xff) | ((curY & 0xff) << 8)
  emit(0x20, 0x05, 0x20, 0x08, 0x46, 0x04, 0x40);
  emit(0x20, 0x07, 0x41, ...writeSleb(255), 0x71);
  emit(0x20, 0x06, 0x41, ...writeSleb(255), 0x71, 0x41, 0x08, 0x74, 0x72, 0x0f, 0x0b);

  // skip '|' if i < len, count++, continue
  emit(0x20, 0x04, 0x20, 0x02, 0x49, 0x04, 0x40, 0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04, 0x0b);
  emit(0x20, 0x05, 0x41, 0x01, 0x6a, 0x21, 0x05);
  emit(0x0c, 0x00, 0x0b, 0x0b);

  emit(0x20, 0x01, 0x0b); // fallback return p1; end func
  return Buffer.from(b);
}

/**
 * Replaces every `local.get item; i32.load8_u (0,45); local.set ty; local.get item; i32.load8_u (0,44); local.set tx`
 * (searching sequentially from `startOffset`) with a call to `helperFid` and unpacking into `(tx, ty)`.
 */
function hookTexLoadsInBody(
  body: Buffer,
  itemVar: number,
  sites: Array<[number, number, number?]>,
  helperFid: number
): Buffer {
  let out = body;
  const fidUleb = writeUleb(helperFid);
  for (const [tyVar, txVar, fromOffset = 0] of sites) {
    const pattern = Buffer.from([
      0x20, itemVar, 0x2d, 0x00, 0x2d, 0x21, tyVar,
      0x20, itemVar, 0x2d, 0x00, 0x2c, 0x21, txVar,
    ]);
    const replacement = Buffer.from([
      0x20, itemVar,
      0x20, itemVar, 0x2d, 0x00, 0x2c,
      0x20, itemVar, 0x2d, 0x00, 0x2d,
      0x41, 0x08, 0x74, 0x72,
      0x10, ...fidUleb,
      0x22, txVar,
      0x41, 0x08, 0x76, 0x21, tyVar,
      0x20, txVar, 0x41, ...writeSleb(255), 0x71, 0x21, txVar,
    ]);
    const idx = out.indexOf(pattern, fromOffset);
    if (idx < 0) {
      throw new Error(`hookTexLoadsInBody: pattern not found for item=${itemVar} ty=${tyVar} tx=${txVar}`);
    }
    out = Buffer.concat([out.subarray(0, idx), replacement, out.subarray(idx + pattern.length)]);
  }
  return out;
}

function replaceExactHex(body: Buffer, hexSig: string, replacement: Buffer, label: string): Buffer {
  const sig = Buffer.from(hexSig, "hex");
  const idx = body.indexOf(sig);
  if (idx < 0) throw new Error(`${label} signature not found`);
  return Buffer.concat([body.subarray(0, idx), replacement, body.subarray(idx + sig.length)]);
}

export function patchClothingAnimations(wasmBytes: Uint8Array): Uint8Array {
  const buf = Buffer.from(wasmBytes);
  const sections: Array<{ id: number; data: Uint8Array }> = [];
  let pos = 8;
  while (pos < buf.length) {
    const id = buf[pos++];
    const [len, p1] = readUleb(buf, pos);
    sections.push({ id, data: buf.subarray(p1, p1 + len) });
    pos = p1 + len;
  }

  const sec1 = sections.find(s => s.id === 1);
  const sec2 = sections.find(s => s.id === 2);
  const sec3 = sections.find(s => s.id === 3);
  const sec10 = sections.find(s => s.id === 10);
  if (!sec1 || !sec2 || !sec3 || !sec10) throw new Error("Missing required WASM sections");

  const numImports = countFuncImports(sec2.data);
  const { data: newSec1Data, typeIdx } = ensureI32I32ToI32Type(sec1.data);
  sec1.data = newSec1Data;

  // Parse function section (sec3) and append helper typeIdx
  let fp = 0;
  const [funcCount, fp1] = readUleb(sec3.data, fp);
  const newFuncIndex = numImports + funcCount;
  sec3.data = Buffer.concat([
    Buffer.from(writeUleb(funcCount + 1)),
    Buffer.from(sec3.data.subarray(fp1)),
    Buffer.from(writeUleb(typeIdx)),
  ]);

  // Parse code section (sec10)
  let cp = 0;
  const [codeCount, cp1] = readUleb(sec10.data, cp);
  cp = cp1;
  if (codeCount !== funcCount) throw new Error("WASM function/code count mismatch");
  const bodies: Buffer[] = [];
  for (let i = 0; i < codeCount; i++) {
    const [sz, cp2] = readUleb(sec10.data, cp);
    bodies.push(Buffer.from(sec10.data.subarray(cp2, cp2 + sz)));
    cp = cp2 + sz;
  }

  const patchBody = (fid: number, fn: (b: Buffer) => Buffer) => {
    const idx = fid - numImports;
    bodies[idx] = fn(bodies[idx]);
  };

  // Hook (texX, texY) loads in all clothing renderers
  patchBody(781, b => hookTexLoadsInBody(b, 11, [[6, 14], [3, 11]], newFuncIndex));
  patchBody(1262, b => hookTexLoadsInBody(b, 9, [[8, 13], [12, 9]], newFuncIndex));
  patchBody(1263, b => hookTexLoadsInBody(b, 10, [[9, 18], [7, 15], [3, 9], [3, 10]], newFuncIndex));
  patchBody(1937, b => hookTexLoadsInBody(b, 10, [[8, 14], [5, 10], [4, 10]], newFuncIndex));
  patchBody(1938, b => {
    let out = hookTexLoadsInBody(b, 8, [[9, 11], [3, 8], [3, 8]], newFuncIndex);
    // In v3.52, BackFront skips (tx+1, ty) front-strap draw for kind == 4 capes with empty extraOptions2
    // (their tx+1 is a 2nd flap frame rather than a front clasp, e.g. Neon Party Cape 11300).
    const backFrontSig = "20082d0037412071450d00024020082d00244119470d00";
    out = replaceExactHex(
      out,
      backFrontSig,
      Buffer.from([
        0x20, 0x08, 0x2d, 0x00, 0x37, 0x41, 0x20, 0x71, 0x45, 0x0d, 0x00,
        // if (item[36] == 4 && extraOptions2.empty()) br 0;
        0x20, 0x08, 0x2d, 0x00, 0x24, 0x41, 0x04, 0x46,
        0x20, 0x08, 0x2c, 0x00, ...writeUleb(207), 0x45,
        0x20, 0x08, 0x2c, 0x00, ...writeUleb(207), 0x41, 0x00, 0x48,
        0x20, 0x08, 0x28, 0x02, ...writeUleb(200), 0x45, 0x71,
        0x72, 0x71, 0x0d, 0x00,
        0x02, 0x40, 0x20, 0x08, 0x2d, 0x00, 0x24, 0x41, 0x19, 0x47, 0x0d, 0x00,
      ]),
      "fid 1938 skip kind==4 empty extraOptions2 front-pass"
    );
    return out;
  });
  patchBody(1940, b => hookTexLoadsInBody(b, 10, [[3, 10], [8, 12], [3, 10]], newFuncIndex));
  patchBody(5459, b => hookTexLoadsInBody(b, 10, [[5, 13], [3, 7]], newFuncIndex));

  // Fix fid 1510:
  //  (a) kind==30 off-hand draws (tx + 2, ty) when (fxFlags & 1) != 0 (e.g. 6874/6876/6878)
  //  (b) hook remaining animated (texX, texY) loads (skipping @497 kind==30 off-hand load)
  patchBody(1510, b => {
    // Gate kind == 30 off-hand (tx+1/2, ty) flame overlay on active punch (state == 4 && punchTimer != 0),
    // matching v3.52 0x14018e5ef..0x14018e6ce so it does not appear while idle/walking.
    let out = replaceExactHex(
      b,
      "200d2d0024411e460440",
      Buffer.from([
        0x20, 0x0d, 0x2d, 0x00, 0x24, 0x41, 0x1e, 0x46, // kind == 30
        0x20, 0x0b, 0x41, 0x05, 0x47, 0x71,             // & state != 5
        0x20, 0x0b, 0x41, 0x04, 0x47,                   // state != 4
        0x20, 0x0a, 0x28, 0x02, 0x70, 0x41, 0x00, 0x47, // | punchTimer != 0
        0x72, 0x71,
        0x04, 0x40,
      ]),
      "fid 1510 gate kind==30 hide only when state==5 or state==4&&punchTimer==0"
    );
    out = replaceExactHex(
      out,
      "2005200c41016a200e",
      Buffer.from([
        0x20, 0x05, 0x20, 0x0c,
        0x41, 0x02, 0x41, 0x01,
        0x20, 0x0d, 0x2d, 0x00, ...writeUleb(164), 0x41, 0x01, 0x71,
        0x1b, 0x6a, 0x20, 0x0e,
      ]),
      "fid 1510 kind==30 off-hand"
    );
    out = hookTexLoadsInBody(out, 13, [[14, 12, 1000], [5, 7], [5, 7], [5, 7]], newFuncIndex);
    return out;
  });

  // Fix fid 1941 (Back):
  //  (a) hook all 4 (texX, texY) loads
  //  (b) suppress 100ms (tx+1) blink toggle on kind==4 capes with (flags & 0x2000) or (fxFlags & 1)
  patchBody(1941, b => {
    let out = hookTexLoadsInBody(b, 9, [[3, 11], [3, 9], [3, 10], [3, 9]], newFuncIndex);
    out = replaceExactHex(
      out,
      "0b22073602b4010b2000280200",
      Buffer.from([
        0x0b, 0x21, 0x07,
        0x20, 0x09, 0x2d, 0x00, 0x24, 0x41, 0x04, 0x46,
        0x20, 0x09, 0x2f, 0x01, 0x36, 0x41, ...writeSleb(0x2000), 0x71,
        0x20, 0x09, 0x2d, 0x00, ...writeUleb(164), 0x41, 0x01, 0x71,
        0x72, 0x45, 0x45, 0x71,
        0x04, 0x40, 0x41, 0x00, 0x21, 0x07, 0x0b,
        0x20, 0x07, 0x22, 0x07, 0x36, 0x02, 0xb4, 0x01, 0x0b,
        0x20, 0x00, 0x28, 0x02, 0x00,
      ]),
      "fid 1941 cape blink toggle"
    );
    return out;
  });

  // Fix fid 1939 (HandRenderer):
  //  (a) hook earlier hand/pet (texX, texY) loads + @5024 texX/texY
  //  (b) skip duplicate/pulsing 2nd-hand draw at @5893 when extraOptions has x,y| frames
  patchBody(1939, b => {
    const fidUleb = writeUleb(newFuncIndex);
    let out = hookTexLoadsInBody(b, 10, [[15, 10]], newFuncIndex);
    out = hookTexLoadsInBody(out, 13, [[14, 15], [4, 5], [4, 8]], newFuncIndex);
    const loadSig = Buffer.from("2005200d2d002c6a210e200d2d002d2111", "hex");
    const lIdx = out.indexOf(loadSig);
    if (lIdx < 0) throw new Error("fid 1939 load signature not found");
    const loadRep = Buffer.from([
      0x20, 0x0d,
      0x20, 0x05, 0x20, 0x0d, 0x2d, 0x00, 0x2c, 0x6a, 0x41, ...writeSleb(255), 0x71,
      0x20, 0x0d, 0x2d, 0x00, 0x2d, 0x41, 0x08, 0x74, 0x72,
      0x10, ...fidUleb,
      0x22, 0x0e,
      0x41, 0x08, 0x76, 0x21, 0x11,
      0x20, 0x0e, 0x41, ...writeSleb(255), 0x71, 0x21, 0x0e,
    ]);
    out = Buffer.concat([out.subarray(0, lIdx), loadRep, out.subarray(lIdx + loadSig.length)]);

    const dupSig = Buffer.from("02400240200641ff017141ff01460440", "hex");
    const dIdx = out.indexOf(dupSig);
    if (dIdx < 0) throw new Error("fid 1939 duplicate-hand signature not found");
    const skipInsert = Buffer.from([
      0x20, 0x0d,
      0x41, 0x7f, // -1
      0x10, ...fidUleb,
      0x41, 0x7f, // -1
      0x47,       // i32.ne
      0x0d, 0x00, // br_if 0 (exits outer block 02 40)
    ]);
    out = Buffer.concat([out.subarray(0, dIdx + 2), skipInsert, out.subarray(dIdx + 2)]);

    // For kind == 30 && (flags & 0x8000) hand items (e.g. Gauntlets of Elements 6866..6878)
    // reaching the final draw at +1684..+1702, v3.52 (0x1401967c6 -> 0x1400f5e00) draws with
    // angle = 0.0 and player scale (local 26, local 28) instead of stale local 25/27/29.
    const handDrawSig = "20002a0238211a20002a023c211c";
    const cosUleb = writeUleb(333);
    const sinUleb = writeUleb(327);
    out = replaceExactHex(
      out,
      handDrawSig,
      Buffer.from([
        0x20, 0x00, 0x2a, 0x02, 0x38, 0x21, 0x1a,
        0x20, 0x00, 0x2a, 0x02, 0x3c, 0x21, 0x1c,
        0x20, 0x0d, 0x2d, 0x00, 0x24, 0x41, 0x1e, 0x46,
        0x04, 0x40,
          0x20, 0x0d, 0x2d, 0x00, 0x37, 0x41, ...writeSleb(128), 0x71,
          0x04, 0x40,
            0x43, 0x00, 0x00, 0x80, 0x3f, // 1.0f (facingLeft != 0)
            0x43, 0x00, 0x00, 0x80, 0xbf, // -1.0f (facingLeft == 0)
            0x20, 0x07, 0x1b,             // select
            0x20, 0x0b, 0x2a, 0x02, 0xb0, 0x01, 0x94, // * f32[local 11 + 176] (armAngle)
            0x22, 0x19,                   // local.tee 25 (angle)
            0x43, 0x00, 0x00, 0xb4, 0x42, 0x92, // + 90.0f
            0x43, 0x35, 0xfa, 0x8e, 0x3c, 0x94, // * (PI / 180.0f)
            0x21, 0x1b,                   // local.set 27 (temp rad)
            0x20, 0x01,
            0x20, 0x1a, 0x43, 0x00, 0x00, 0x40, 0xc1, 0x94, // scaleX * -12.0f
            0x20, 0x1b, 0x10, ...cosUleb, 0x94,             // * cos(rad)
            0x92, 0x21, 0x01,
            0x20, 0x02,
            0x20, 0x1c, 0x43, 0x00, 0x00, 0x40, 0xc1, 0x94, // scaleY * -12.0f
            0x20, 0x1b, 0x10, ...sinUleb, 0x94,             // * sin(rad)
            0x92, 0x21, 0x02,
          0x05,
            0x43, 0x00, 0x00, 0x00, 0x00, 0x21, 0x19, // local 25 = 0.0f
          0x0b,
          0x20, 0x1a, 0x21, 0x1b, // local 27 = local 26
          0x20, 0x1c, 0x21, 0x1d, // local 29 = local 28
        0x0b,
      ]),
      "fid 1939 kind==30 flags&0x8000 transform"
    );
    return out;
  });

  // Hook fid 5455 separate walk-frame tx and ty loads
  patchBody(5455, b => {
    const fidUleb = writeUleb(newFuncIndex);
    let out = b;
    for (const hexSig of ["2010200d2d002c6a2108", "2010200d2d002c6a2108"]) {
      out = replaceExactHex(
        out,
        hexSig,
        Buffer.from([
          0x20, 0x10,
          0x20, 0x0d,
          0x20, 0x0d, 0x2d, 0x00, 0x2c,
          0x20, 0x0d, 0x2d, 0x00, 0x2d, 0x41, 0x08, 0x74, 0x72,
          0x10, ...fidUleb,
          0x41, ...writeSleb(255), 0x71,
          0x6a, 0x21, 0x08,
        ]),
        "fid 5455 tx"
      );
    }
    for (const [hexSig, tyVar] of [
      ["200d2d002d210f20002802002a029c01", 15],
      ["200d2d002d210920002802002a029c01", 9],
      ["200d2d002d210320002802002a02a401", 3],
      ["200d2d002d210320002802002a02a401", 3],
    ] as const) {
      const sig = Buffer.from(hexSig, "hex");
      const idx = out.indexOf(sig);
      if (idx < 0) throw new Error(`fid 5455 ty=${tyVar} signature not found`);
      const rep = Buffer.from([
        0x20, 0x0d,
        0x20, 0x0d, 0x2d, 0x00, 0x2c,
        0x20, 0x0d, 0x2d, 0x00, 0x2d, 0x41, 0x08, 0x74, 0x72,
        0x10, ...fidUleb,
        0x41, 0x08, 0x76, 0x21, tyVar,
      ]);
      out = Buffer.concat([out.subarray(0, idx), rep, out.subarray(idx + 7)]);
    }
    return out;
  });

  // Fix fid 1945: emit Goku Aura particle 59 for hair == 6008 (Intergalactic Warrior Hair)
  patchBody(1945, b => {
    const fidCall320 = writeUleb(320);
    const fidCall311 = writeUleb(311);
    return replaceExactHex(
      b,
      "410010c0020b02402006450d0020032d0069",
      Buffer.from([
        0x41, 0x00, 0x10, ...fidCall320, 0x0b,
        0x02, 0x40,
        0x20, 0x02, 0x45, 0x0d, 0x00, // 0.1s timer (matches v3.52 2x/0.25s cadence)
        0x20, 0x03, 0x2f, 0x01, 0x0e, // avatarData.hair (offset 14)
        0x41, ...writeSleb(6008), 0x47, 0x0d, 0x00,
        0x02, 0x40,
        0x23, 0x01, 0x28, 0x02, 0x30, 0x22, 0x00,
        0x04, 0x40, 0x20, 0x00, 0x28, 0x02, 0x00, 0x22, 0x00, 0x0d, 0x01, 0x0b,
        0x41, ...writeSleb(393364), 0x28, 0x02, 0x00, 0x28, 0x02, ...writeUleb(1800), 0x28, 0x02, ...writeUleb(144), 0x21, 0x00,
        0x0b,
        0x20, 0x00, 0x41, ...writeSleb(320), 0x6a,
        0x41, ...writeSleb(59),
        0x20, 0x11, 0x20, 0x13, 0x10, ...fidCall311, // rand(left, right)
        0x20, 0x1a, 0x20, 0x16, 0x10, ...fidCall311, // rand(top, bottom)
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x41, 0x00,
        0x10, ...fidCall320,
        0x20, 0x00, 0x41, ...writeSleb(320), 0x6a,
        0x41, ...writeSleb(59),
        0x20, 0x11, 0x20, 0x13, 0x10, ...fidCall311,
        0x20, 0x1a, 0x20, 0x16, 0x10, ...fidCall311,
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x43, 0x00, 0x00, 0x00, 0x00,
        0x41, 0x00,
        0x10, ...fidCall320,
        0x0b,
        0x02, 0x40, 0x20, 0x06, 0x45, 0x0d, 0x00, 0x20, 0x03, 0x2d, 0x00, 0x69,
      ]),
      "fid 1945 hair 6008 Goku Aura"
    );
  });

  // Fix fid 339 (Particle::Init) pid 59 (+0x229b): match v3.52 Emitter::Init case 59 (scale 0.45..0.55, rot -75..-35, vel (-50..-25, -50))
  patchBody(339, b => {
    const randUleb = writeUleb(311);
    return replaceExactHex(
      b,
      "200042808080f8838080c03f3702182000418080808004360220200043000020c1430000204110b70238020c20004300002041430000a04110b7023802100c3c0b",
      Buffer.from([
        0x20, 0x00, 0x43, 0x00, 0x00, 0x80, 0x3f, 0x38, 0x02, 0x1c, // alpha = 1.0f
        0x20, 0x00, 0x43, 0x66, 0x66, 0xe6, 0x3e, 0x43, 0xcd, 0xcc, 0x0c, 0x3f, 0x10, ...randUleb, 0x38, 0x02, 0x18, // scale = rand(0.45, 0.55)
        0x20, 0x00, 0x43, 0x00, 0x00, 0x96, 0xc2, 0x43, 0x00, 0x00, 0x0c, 0xc2, 0x10, ...randUleb, 0x38, 0x02, 0x14, // rot = rand(-75, -35)
        0x20, 0x00, 0x43, 0x00, 0x00, 0x80, 0x40, 0x38, 0x02, 0x20, // fade rate = 4.0f (0.25s lifetime)
        0x20, 0x00, 0x43, 0x00, 0x00, 0x48, 0xc2, 0x43, 0x00, 0x00, 0xc8, 0xc1, 0x10, ...randUleb, 0x38, 0x02, 0x0c, // vx = rand(-50, -25)
        0x20, 0x00, 0x43, 0x00, 0x00, 0x48, 0xc2, 0x38, 0x02, 0x10, // vy = -50.0f
        0x0c, 0x3c, 0x0b, // br 60; end
      ]),
      "fid 339 pid 59 flame wisp init"
    );
  });

  // Fix fid 1423 (Particle::Render) pid 59 (+0x60b4): draw flame wisp (13, 2) with additive blend instead of snowflake (15, 3)
  patchBody(1423, b => {
    const drawUleb = writeUleb(322);
    return replaceExactHex(
      b,
      "2001410f4103200341880d6a200341800d6a410120174300007f4394fc004180026b2016200341f80c6a4100410010c2020c3f0b",
      Buffer.from([
        0x20, 0x01, 0x41, 0x01, 0x36, 0x02, 0x30, // additive blend = 1
        0x20, 0x01, 0x41, 0x0d, 0x41, 0x02,       // tx=13, ty=2 (flame wisp)
        0x20, 0x03, 0x41, 0x88, 0x0d, 0x6a,
        0x20, 0x03, 0x41, 0x80, 0x0d, 0x6a,
        0x41, 0x01,
        0x20, 0x17, 0x43, 0x00, 0x00, 0x7f, 0x43, 0x94, 0xfc, 0x00, 0x41, ...writeSleb(-4710400), 0x6a, // golden-orange 0xFFB820AA (RRGGBBAA)
        0x20, 0x16,
        0x20, 0x03, 0x41, 0xf8, 0x0c, 0x6a,
        0x41, 0x00, 0x41, 0x00,
        0x10, ...drawUleb,
        0x20, 0x01, 0x41, 0x02, 0x36, 0x02, 0x30, // restore blend = 2
        0x0c, 0x3f, 0x0b,
      ]),
      "fid 1423 pid 59 flame wisp render"
    );
  });

  // Append resolveExtraAnimFrame body
  bodies.push(buildResolveExtraAnimBody());

  // Re-encode code section
  const sec10Chunks: Buffer[] = [Buffer.from(writeUleb(bodies.length))];
  for (const body of bodies) {
    sec10Chunks.push(Buffer.from(writeUleb(body.length)), body);
  }
  sec10.data = Buffer.concat(sec10Chunks);

  // Reassemble WASM binary
  const outChunks: Buffer[] = [buf.subarray(0, 8)];
  for (const sec of sections) {
    outChunks.push(Buffer.from([sec.id]), Buffer.from(writeUleb(sec.data.length)), Buffer.from(sec.data));
  }
  return Buffer.concat(outChunks);
}
