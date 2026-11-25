/**
 * Native WebAssembly RmlUi Bridge & HUD Patch for pinned `upstream.wasm` (ReGrowtopia V1.50).
 *
 * Performs surgical, validated WASM binary patches at module load time:
 *  1. Appends two mutable WASM globals (`gRmlHudEnabled = 1`, `gRmlModalOpen = 0`).
 *  2. Redirects `RenderBuxComponent::OnRender` (indirect table slot 1642 -> func 4411) and
 *     `BuxOnTouchStart` (slot 2074 -> func 4520) so legacy V1.50 top-right gem rendering/touch
 *     is suppressed natively inside WASM when RmlUi `WorldUI.rml` is active, while
 *     `RenderBuxComponent::OnUpdate` (func 4410) continues updating the native C++ rolling gem counter.
 *  3. Redirects all calls to `CreateConsoleLogOverlay` (func 1820 in funcs 1077, 1441, 4494)
 *     to natively offset `ConsoleLogParent` `pos2d.x` to `266dp` (`266 * min(screenX/1024, screenY/600)`)
 *     exclusively when `GameLogic` is active in-world, eliminating JS `HEAPF32` layout polling.
 *  4. Wraps `_SDL_PollEvent` (import func 174 in func 4385) and `_JLIB_IsTextInputFocused`
 *     (import func 181 in funcs 3020, 4801) so active RmlUi modal windows (`BasePopup.rml`)
 *     natively gate world mouse/touch/keyboard input inside WASM while keeping rendering & ENet live.
 *  5. Exports native WASM functions in Section 7 (`rmlSetHudEnabled`, `rmlSetModalOpen`,
 *     `rmlSyncConsoleLayout`, `rmlIsInWorld`, `rmlGetPlayerGems`, `rmlGetDisplayedGems`,
 *     `rmlOpenStore`, `rmlSendPacket`).
 */

const WASM_MAGIC = 0x6d736100;
const WASM_VERSION = 1;

const VAL_I32 = 0x7f;
const VAL_F32 = 0x7d;

// Verified C++ globals & passive-segment-0 string VAs in pinned `upstream.wasm`
const VA_SCREEN_SIZE_Y = 392496;
const VA_SCREEN_SIZE_X = 392500;
const VA_G_AUDIO_MANAGER = 393272;
const VA_G_APP_PTR = 393364;
const VA_STR_AUDIO_CLICK_WAV = 18182;
const VA_STR_CONSOLE_LOG_PARENT = 22362;
const VA_STR_POS2D = 60949;

// Verified function indices in pinned `upstream.wasm`
const FN_SDL_POLL_EVENT = 174; // (i32) -> (i32)
const FN_IS_TEXT_FOCUSED = 181; // () -> (i32)
const FN_OPERATOR_DELETE = 308; // (i32) -> ()
const FN_GET_BASE_APP = 312; // () -> (i32)
const FN_SIGNAL_FIRE = 318; // (i32, i32) -> ()
const FN_GET_ENTITY_BY_NAME = 319; // (i32, i32) -> (i32)
const FN_STD_STRING_FROM_CSTR = 330; // (i32, i32) -> (i32)
const FN_VARIANT_DB_GET_VAR = 889; // (i32, i32) -> (i32)
const FN_GET_RENDER_BUX = 1246; // () -> (i32)
const FN_CREATE_CONSOLE_LOG = 1820; // () -> ()
const FN_SEND_PACKET = 4362; // (i32, i32, i32) -> ()
const FN_RENDER_BUX_ON_RENDER = 4411; // (i32, i32) -> ()
const FN_BUX_OPEN_STORE = 4520; // (i32) -> ()
const FN_AUDIO_MANAGER_NEW_PLAY = 5543; // (i32, i32, i32, i32, i32, i32) -> (i32)

// Verified callers to redirect
const CALLERS_CREATE_CONSOLE_LOG = [1077, 1441, 4494];
const CALLERS_SDL_POLL_EVENT = [4385];
const CALLERS_IS_TEXT_FOCUSED = [3020, 4801];

// Verified indirect element table (`sid = 9`) slots
const TBL_SLOT_RENDER_BUX = 1642; // -> 4411
const TBL_SLOT_BUX_TOUCH = 2074; // -> 4520

interface WasmSection {
  id: number;
  data: Uint8Array;
}

function readUleb(buf: Uint8Array, pos: number): [number, number] {
  let res = 0;
  let shift = 0;
  while (true) {
    const b = buf[pos++];
    res |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [res >>> 0, pos];
    shift += 7;
  }
}

function readSleb(buf: Uint8Array, pos: number): [number, number] {
  let res = 0;
  let shift = 0;
  let b = 0;
  do {
    b = buf[pos++];
    res |= (b & 0x7f) << shift;
    shift += 7;
  } while ((b & 0x80) !== 0);
  if (shift < 32 && (b & 0x40) !== 0) res |= -(1 << shift);
  return [res, pos];
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

function writeSleb32(val: number): number[] {
  const out: number[] = [];
  let v = val | 0;
  while (true) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

function writeF32(val: number): number[] {
  const b = Buffer.alloc(4);
  b.writeFloatLE(val, 0);
  return [b[0], b[1], b[2], b[3]];
}

function writeF64(val: number): number[] {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(val, 0);
  return Array.from(b);
}

class WasmEmitter {
  public readonly bytes: number[] = [];

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  block(bt = 0x40): this {
    return this.raw(0x02, bt);
  }
  loop(bt = 0x40): this {
    return this.raw(0x03, bt);
  }
  if_(bt = 0x40): this {
    return this.raw(0x04, bt);
  }
  else_(): this {
    return this.raw(0x05);
  }
  end(): this {
    return this.raw(0x0b);
  }
  br(depth: number): this {
    return this.raw(0x0c, ...writeUleb(depth));
  }
  brIf(depth: number): this {
    return this.raw(0x0d, ...writeUleb(depth));
  }
  ret(): this {
    return this.raw(0x0f);
  }
  call(fnIdx: number): this {
    return this.raw(0x10, ...writeUleb(fnIdx));
  }
  drop(): this {
    return this.raw(0x1a);
  }
  select(): this {
    return this.raw(0x1b);
  }
  localGet(idx: number): this {
    return this.raw(0x20, ...writeUleb(idx));
  }
  localSet(idx: number): this {
    return this.raw(0x21, ...writeUleb(idx));
  }
  localTee(idx: number): this {
    return this.raw(0x22, ...writeUleb(idx));
  }
  globalGet(idx: number): this {
    return this.raw(0x23, ...writeUleb(idx));
  }
  globalSet(idx: number): this {
    return this.raw(0x24, ...writeUleb(idx));
  }
  i32Load(offset = 0, align = 2): this {
    return this.raw(0x28, ...writeUleb(align), ...writeUleb(offset));
  }
  f32Load(offset = 0, align = 2): this {
    return this.raw(0x2a, ...writeUleb(align), ...writeUleb(offset));
  }
  f64Load(offset = 0, align = 3): this {
    return this.raw(0x2b, ...writeUleb(align), ...writeUleb(offset));
  }
  i32Load8U(offset = 0): this {
    return this.raw(0x2d, 0x00, ...writeUleb(offset));
  }
  freeStdString(ptrLocal: number): this {
    return this.localGet(ptrLocal)
      .i32Load8U(11)
      .i32Const(0x80)
      .i32And()
      .if_()
      .localGet(ptrLocal)
      .i32Load(0)
      .call(FN_OPERATOR_DELETE)
      .end();
  }
  i32Store(offset = 0, align = 2): this {
    return this.raw(0x36, ...writeUleb(align), ...writeUleb(offset));
  }
  f32Store(offset = 0, align = 2): this {
    return this.raw(0x38, ...writeUleb(align), ...writeUleb(offset));
  }
  i32Const(val: number): this {
    return this.raw(0x41, ...writeSleb32(val));
  }
  f32Const(val: number): this {
    return this.raw(0x43, ...writeF32(val));
  }
  f64Const(val: number): this {
    return this.raw(0x44, ...writeF64(val));
  }
  i32Eqz(): this {
    return this.raw(0x45);
  }
  i32Eq(): this {
    return this.raw(0x46);
  }
  i32Ne(): this {
    return this.raw(0x47);
  }
  i32GeS(): this {
    return this.raw(0x4e);
  }
  i32LeS(): this {
    return this.raw(0x4c);
  }
  f32Ne(): this {
    return this.raw(0x5c);
  }
  i32Add(): this {
    return this.raw(0x6a);
  }
  i32Sub(): this {
    return this.raw(0x6b);
  }
  i32And(): this {
    return this.raw(0x71);
  }
  i32Or(): this {
    return this.raw(0x72);
  }
  f32Mul(): this {
    return this.raw(0x94);
  }
  f32Div(): this {
    return this.raw(0x95);
  }
  f32Min(): this {
    return this.raw(0x96);
  }
  f64Add(): this {
    return this.raw(0xa0);
  }
  f32ConvertI32S(): this {
    return this.raw(0xb2);
  }
  i32TruncSatF64S(): this {
    return this.raw(0xfc, 0x02);
  }

  buildBody(locals: Array<[number, number]> = []): Buffer {
    this.end();
    const hdr: number[] = [...writeUleb(locals.length)];
    for (const [cnt, t] of locals) {
      hdr.push(...writeUleb(cnt), t);
    }
    return Buffer.from([...hdr, ...this.bytes]);
  }
}

function parseSections(wasm: Uint8Array): WasmSection[] {
  const dv = new DataView(wasm.buffer, wasm.byteOffset, wasm.byteLength);
  if (dv.getUint32(0, true) !== WASM_MAGIC || dv.getUint32(4, true) !== WASM_VERSION) {
    throw new Error("Invalid WASM header");
  }
  const sections: WasmSection[] = [];
  let pos = 8;
  while (pos < wasm.length) {
    const id = wasm[pos++];
    const [len, bodyStart] = readUleb(wasm, pos);
    sections.push({ id, data: wasm.subarray(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
  }
  return sections;
}

function encodeModule(sections: WasmSection[]): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])];
  for (const s of sections) {
    chunks.push(Buffer.from([s.id, ...writeUleb(s.data.length)]), Buffer.from(s.data));
  }
  return Buffer.concat(chunks);
}

function countImports(sec2: Uint8Array): { funcImports: number; globalImports: number } {
  let p = 0;
  const [count, p1] = readUleb(sec2, p);
  p = p1;
  let funcImports = 0;
  let globalImports = 0;
  for (let i = 0; i < count; i++) {
    const [ml, m1] = readUleb(sec2, p);
    p = m1 + ml;
    const [nl, n1] = readUleb(sec2, p);
    p = n1 + nl;
    const kind = sec2[p++];
    if (kind === 0) {
      [, p] = readUleb(sec2, p);
      funcImports++;
    } else if (kind === 1) {
      p++;
      const [fl, p2] = readUleb(sec2, p);
      [, p] = readUleb(sec2, p2);
      if (fl & 1) [, p] = readUleb(sec2, p);
    } else if (kind === 2) {
      const [fl, p2] = readUleb(sec2, p);
      [, p] = readUleb(sec2, p2);
      if (fl & 1) [, p] = readUleb(sec2, p);
    } else if (kind === 3) {
      p += 2;
      globalImports++;
    }
  }
  return { funcImports, globalImports };
}

function ensureFuncType(
  sec1: Uint8Array,
  params: number[],
  results: number[]
): { data: Uint8Array; typeIdx: number } {
  let p = 0;
  const [count, p1] = readUleb(sec1, p);
  p = p1;
  for (let i = 0; i < count; i++) {
    if (sec1[p++] !== 0x60) throw new Error("Expected functype 0x60");
    const [pc, p2] = readUleb(sec1, p);
    const pSlice = sec1.subarray(p2, p2 + pc);
    p = p2 + pc;
    const [rc, p3] = readUleb(sec1, p);
    const rSlice = sec1.subarray(p3, p3 + rc);
    p = p3 + rc;
    if (
      pc === params.length &&
      rc === results.length &&
      params.every((v, idx) => pSlice[idx] === v) &&
      results.every((v, idx) => rSlice[idx] === v)
    ) {
      return { data: sec1, typeIdx: i };
    }
  }
  const entry = Buffer.from([
    0x60,
    ...writeUleb(params.length),
    ...params,
    ...writeUleb(results.length),
    ...results,
  ]);
  return {
    data: Buffer.concat([Buffer.from(writeUleb(count + 1)), Buffer.from(sec1.subarray(p1)), entry]),
    typeIdx: count,
  };
}

function appendMutableI32Global(
  sec6: Uint8Array,
  globalImports: number,
  initVal: number
): { data: Uint8Array; globalIdx: number } {
  const [count, p1] = readUleb(sec6, 0);
  const entry = Buffer.from([VAL_I32, 0x01, 0x41, ...writeSleb32(initVal), 0x0b]);
  return {
    data: Buffer.concat([Buffer.from(writeUleb(count + 1)), Buffer.from(sec6.subarray(p1)), entry]),
    globalIdx: globalImports + count,
  };
}

function patchElementSlots(
  sec9: Uint8Array,
  replacements: Array<{ slot: number; expectedFn: number; replacementFn: number }>
): Uint8Array {
  let p = 0;
  const [segCount, p1] = readUleb(sec9, p);
  p = p1;
  const out: Buffer[] = [Buffer.from(writeUleb(segCount))];
  const patched = new Set<number>();

  for (let s = 0; s < segCount; s++) {
    const segStart = p;
    const [flags, p2] = readUleb(sec9, p);
    p = p2;
    if (flags !== 0 || sec9[p] !== 0x41) throw new Error(`Unsupported elem segment flags=${flags}`);
    const [baseSlot, p3] = readSleb(sec9, p + 1);
    if (sec9[p3] !== 0x0b) throw new Error("Expected end in elem offset expr");
    p = p3 + 1;
    const [elemCount, p4] = readUleb(sec9, p);
    const headerSlice = sec9.subarray(segStart, p4);
    p = p4;
    const fnIndices: number[] = [];
    for (let j = 0; j < elemCount; j++) {
      const [fnIdx, pn] = readUleb(sec9, p);
      p = pn;
      const absSlot = baseSlot + j;
      const rep = replacements.find((r) => r.slot === absSlot);
      if (rep) {
        if (fnIdx !== rep.expectedFn) {
          throw new Error(`Unexpected elem slot ${absSlot}: got ${fnIdx}, expected ${rep.expectedFn}`);
        }
        fnIndices.push(rep.replacementFn);
        patched.add(absSlot);
      } else {
        fnIndices.push(fnIdx);
      }
    }
    const encoded = fnIndices.flatMap((idx) => writeUleb(idx));
    out.push(Buffer.from(headerSlice), Buffer.from( encoded ));
  }

  if (patched.size !== replacements.length) {
    throw new Error(`Patched ${patched.size}/${replacements.length} indirect table slots`);
  }
  return Buffer.concat(out);
}

function appendExports(
  sec7: Uint8Array,
  additions: Array<{ name: string; funcIdx: number }>
): Uint8Array {
  let p = 0;
  const [count, p1] = readUleb(sec7, p);
  p = p1;
  const existing = new Set<string>();
  for (let i = 0; i < count; i++) {
    const [nl, p2] = readUleb(sec7, p);
    existing.add(Buffer.from(sec7.subarray(p2, p2 + nl)).toString("utf8"));
    p = p2 + nl;
    p++; // kind
    [, p] = readUleb(sec7, p);
  }
  const extra: Buffer[] = [];
  let added = 0;
  for (const item of additions) {
    if (existing.has(item.name)) continue;
    const nb = Buffer.from(item.name, "utf8");
    extra.push(Buffer.from([...writeUleb(nb.length), ...nb, 0x00, ...writeUleb(item.funcIdx)]));
    added++;
  }
  return Buffer.concat([
    Buffer.from(writeUleb(count + added)),
    Buffer.from(sec7.subarray(p1)),
    ...extra,
  ]);
}

function replaceDirectCallsInBody(
  body: Buffer,
  oldTargetFn: number,
  newTargetFn: number,
  expectedCount: number,
  callerFid: number
): Buffer {
  // Rewrite instruction-accurately by walking the WASM function body so we never match literal immediate bytes.
  let p = 0;
  const [localGroupCount, p1] = readUleb(body, p);
  p = p1;
  for (let i = 0; i < localGroupCount; i++) {
    [, p] = readUleb(body, p);
    p++;
  }
  const out: number[] = Array.from(body.subarray(0, p));
  let replaced = 0;

  while (p < body.length) {
    const opStart = p;
    const op = body[p++];
    if (op === 0x10) {
      const [fnIdx, pn] = readUleb(body, p);
      p = pn;
      if (fnIdx === oldTargetFn) {
        out.push(0x10, ...writeUleb(newTargetFn));
        replaced++;
        continue;
      }
      out.push(...body.subarray(opStart, p));
      continue;
    }
    if (op === 0x02 || op === 0x03 || op === 0x04) {
      p++; // blocktype
    } else if (
      op === 0x0c ||
      op === 0x0d ||
      op === 0x20 ||
      op === 0x21 ||
      op === 0x22 ||
      op === 0x23 ||
      op === 0x24 ||
      op === 0x25 ||
      op === 0x26
    ) {
      [, p] = readUleb(body, p);
    } else if (op === 0x11) {
      [, p] = readUleb(body, p);
      [, p] = readUleb(body, p);
    } else if (op >= 0x28 && op <= 0x3e) {
      [, p] = readUleb(body, p);
      [, p] = readUleb(body, p);
    } else if (op === 0x3f || op === 0x40) {
      p++;
    } else if (op === 0x41 || op === 0x42) {
      [, p] = readSleb(body, p);
    } else if (op === 0x43) {
      p += 4;
    } else if (op === 0x44) {
      p += 8;
    } else if (op === 0x0e) {
      const [cnt, p2] = readUleb(body, p);
      p = p2;
      for (let k = 0; k <= cnt; k++) [, p] = readUleb(body, p);
    } else if (op === 0xfc || op === 0xfd || op === 0xfe) {
      const [sub, p2] = readUleb(body, p);
      p = p2;
      if (op === 0xfe && sub >= 0x10) {
        [, p] = readUleb(body, p);
        [, p] = readUleb(body, p);
      } else if (op === 0xfc && (sub === 8 || sub === 10)) {
        [, p] = readUleb(body, p);
        p++;
      } else if (op === 0xfc && (sub === 9 || sub === 11)) {
        [, p] = readUleb(body, p);
      }
    }
    out.push(...body.subarray(opStart, p));
  }

  if (replaced !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} call(s) to func ${oldTargetFn} in func ${callerFid}, found ${replaced}`
    );
  }
  return Buffer.from(out);
}

/**
 * `fnSyncConsoleLayout() -> ()`
 * Repositions `ConsoleLogParent.pos2d.x` natively inside WASM when in-world (`GameLogic != 0`):
 *  - When `gRmlHudEnabled != 0`: `pos2d.x = 266.0f * min(screenX / 1024.0f, screenY / 600.0f)`
 *  - When `gRmlHudEnabled == 0`: `pos2d.x = 0.0f`
 */
function buildFnSyncConsoleLayout(gRmlHudEnabled: number): Buffer {
  const e = new WasmEmitter();
  // Locals: 0=sp (i32), 1=app (i32), 2=ent (i32), 3=varPos (i32), 4=sig (i32), 5=targetX (f32)
  e.block();
  // Check g_pApp != 0 && *(g_pApp + 1800) != 0 (in-world GameLogic active)
  e.i32Const(VA_G_APP_PTR).i32Load(0).localTee(1).i32Eqz().brIf(0);
  e.localGet(1).i32Load(1800).i32Eqz().brIf(0);

  // Allocate 16-byte stack frame for temporary std::string
  e.globalGet(0).i32Const(16).i32Sub().localTee(0).globalSet(0);

  // Find Entity "ConsoleLogParent" under GetBaseApp() + 1620
  e.localGet(0).i32Const(VA_STR_CONSOLE_LOG_PARENT).call(FN_STD_STRING_FROM_CSTR).drop();
  e.call(FN_GET_BASE_APP).i32Const(1620).i32Add().localGet(0).call(FN_GET_ENTITY_BY_NAME).localSet(2);
  e.freeStdString(0);

  e.localGet(2).if_();
  // Lookup Variant "pos2d" in ConsoleLogParent->GetShared() (ent + 76)
  e.localGet(0).i32Const(VA_STR_POS2D).call(FN_STD_STRING_FROM_CSTR).drop();
  e.localGet(2).i32Const(76).i32Add().localGet(0).call(FN_VARIANT_DB_GET_VAR).localSet(3);
  e.freeStdString(0);

  e.localGet(3).if_();
  e.globalGet(gRmlHudEnabled).if_();
  e.i32Const(VA_SCREEN_SIZE_X).i32Load(0).f32ConvertI32S().f32Const(1180.0).f32Div();
  e.i32Const(VA_SCREEN_SIZE_Y).i32Load(0).f32ConvertI32S().f32Const(680.0).f32Div();
  e.f32Min().f32Const(266.0).f32Mul().localSet(5);
  e.else_();
  e.f32Const(0.0).localSet(5);
  e.end();

  // Variant::Set(CL_Vec2f(targetX, currentY)): only mutate & fire signal when x changed
  e.localGet(3).f32Load(8).localGet(5).f32Ne().if_();
  e.localGet(3).i32Const(3).i32Store(0);
  e.localGet(3).localGet(5).f32Store(8);
  e.localGet(3).i32Load(36).localTee(4).if_();
  e.localGet(4).localGet(3).call(FN_SIGNAL_FIRE);
  e.end();
  e.end();
  e.end();
  e.end();

  // Restore stack pointer
  e.localGet(0).i32Const(16).i32Add().globalSet(0);
  e.end();

  return e.buildBody([
    [5, VAL_I32],
    [1, VAL_F32],
  ]);
}

function buildFnWrapCreateConsoleLog(fnSyncConsoleLayout: number): Buffer {
  const e = new WasmEmitter();
  e.call(FN_CREATE_CONSOLE_LOG);
  e.call(fnSyncConsoleLayout);
  return e.buildBody();
}

function buildFnWrapRenderBux(gRmlHudEnabled: number): Buffer {
  const e = new WasmEmitter();
  e.globalGet(gRmlHudEnabled).if_();
  e.ret();
  e.end();
  e.localGet(0).localGet(1).call(FN_RENDER_BUX_ON_RENDER);
  return e.buildBody();
}

function buildFnWrapBuxTouch(gRmlHudEnabled: number): Buffer {
  const e = new WasmEmitter();
  e.globalGet(gRmlHudEnabled).if_();
  e.ret();
  e.end();
  e.localGet(0).call(FN_BUX_OPEN_STORE);
  return e.buildBody();
}

function buildFnWrapPollEvent(gRmlModalOpen: number): Buffer {
  // Param 0: evPtr (i32) -> i32; Local 1: evType (i32)
  const e = new WasmEmitter();
  e.loop();
  e.localGet(0).call(FN_SDL_POLL_EVENT).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();

  e.globalGet(gRmlModalOpen).i32Eqz().if_();
  e.i32Const(1).ret();
  e.end();

  e.localGet(0).i32Load(0).localSet(1);
  // Drop SDL_KEYDOWN (768), SDL_KEYUP (769), SDL_MOUSEMOTION..MOUSEWHEEL (1024..1027), SDL_FINGER* (1792..1794)
  e.localGet(1).i32Const(768).i32Eq();
  e.localGet(1).i32Const(769).i32Eq().i32Or();
  e.localGet(1).i32Const(1024).i32GeS().localGet(1).i32Const(1027).i32LeS().i32And().i32Or();
  e.localGet(1).i32Const(1792).i32GeS().localGet(1).i32Const(1794).i32LeS().i32And().i32Or();
  e.brIf(0); // continue draining filtered world input events

  e.i32Const(1).ret();
  e.end();
  e.i32Const(0);
  return e.buildBody([[1, VAL_I32]]);
}

function buildFnWrapIsTextFocused(gRmlModalOpen: number): Buffer {
  const e = new WasmEmitter();
  e.globalGet(gRmlModalOpen).if_();
  e.i32Const(1).ret();
  e.end();
  e.call(FN_IS_TEXT_FOCUSED);
  return e.buildBody();
}

function buildFnRmlSetHudEnabled(gRmlHudEnabled: number, fnSyncConsoleLayout: number): Buffer {
  const e = new WasmEmitter();
  e.localGet(0).i32Const(0).i32Ne().globalSet(gRmlHudEnabled);
  e.call(fnSyncConsoleLayout);
  return e.buildBody();
}

function buildFnRmlSetModalOpen(gRmlModalOpen: number): Buffer {
  const e = new WasmEmitter();
  e.localGet(0).i32Const(0).i32Ne().globalSet(gRmlModalOpen);
  return e.buildBody();
}

function buildFnRmlIsInWorld(): Buffer {
  const e = new WasmEmitter();
  // Local 0: appPtr
  e.i32Const(VA_G_APP_PTR).i32Load(0).localTee(0).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();
  e.localGet(0).i32Load(1800).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();
  e.call(FN_GET_RENDER_BUX).i32Const(0).i32Ne();
  return e.buildBody([[1, VAL_I32]]);
}

function buildFnRmlGetPlayerGems(): Buffer {
  const e = new WasmEmitter();
  // Local 0: ptr
  e.i32Const(VA_G_APP_PTR).i32Load(0).localTee(0).i32Eqz().if_();
  e.i32Const(-1).ret();
  e.end();
  e.localGet(0).i32Load(1800).localTee(0).i32Eqz().if_();
  e.i32Const(-1).ret();
  e.end();
  e.localGet(0).i32Load(296);
  return e.buildBody([[1, VAL_I32]]);
}

function buildFnRmlGetDisplayedGems(fnGetPlayerGems: number): Buffer {
  const e = new WasmEmitter();
  // Local 0: renderBuxComp
  e.call(FN_GET_RENDER_BUX).localTee(0).if_();
  e.localGet(0).i32Load8U(100).i32Eqz().if_();
  e.localGet(0).f64Load(120).f64Const(0.5).f64Add().i32TruncSatF64S().ret();
  e.end();
  e.end();
  e.call(fnGetPlayerGems);
  return e.buildBody([[1, VAL_I32]]);
}

function buildFnRmlOpenStore(): Buffer {
  const e = new WasmEmitter();
  e.i32Const(0).call(FN_BUX_OPEN_STORE);
  return e.buildBody();
}

function buildFnRmlSendPacket(): Buffer {
  // Params: 0=pktType (i32), 1=cstrPtr (i32) -> i32 (1 on success, 0 on unavailable)
  // Locals: 2=appOrNet (i32), 3=sp (i32)
  const e = new WasmEmitter();
  e.localGet(1).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();
  e.i32Const(VA_G_APP_PTR).i32Load(0).localTee(2).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();
  e.localGet(2).i32Load(1904).localTee(2).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();
  e.localGet(2).i32Load(12).localTee(2).i32Eqz().if_();
  e.i32Const(0).ret();
  e.end();

  e.globalGet(0).i32Const(16).i32Sub().localTee(3).globalSet(0);
  e.localGet(3).localGet(1).call(FN_STD_STRING_FROM_CSTR).drop();
  e.localGet(0).localGet(3).localGet(2).call(FN_SEND_PACKET);
  e.freeStdString(3);
  e.localGet(3).i32Const(16).i32Add().globalSet(0);
  e.i32Const(1);
  return e.buildBody([[2, VAL_I32]]);
}

function buildFnRmlPlayClickSound(): Buffer {
  const e = new WasmEmitter();
  e.i32Const(VA_G_AUDIO_MANAGER).i32Load(84).if_();
  e.globalGet(0).i32Const(16).i32Sub().localTee(0).globalSet(0);
  e.localGet(0).i32Const(VA_STR_AUDIO_CLICK_WAV).call(FN_STD_STRING_FROM_CSTR).drop();
  e.i32Const(VA_G_AUDIO_MANAGER)
    .localGet(0)
    .i32Const(0)
    .i32Const(0)
    .i32Const(1)
    .i32Const(0)
    .call(FN_AUDIO_MANAGER_NEW_PLAY)
    .drop();
  e.freeStdString(0);
  e.localGet(0).i32Const(16).i32Add().globalSet(0);
  e.end();
  return e.buildBody([[1, VAL_I32]]);
}

function buildFnRmlIsAudioEnabled(): Buffer {
  const e = new WasmEmitter();
  e.i32Const(VA_G_AUDIO_MANAGER).i32Load(84).localTee(0).if_(VAL_I32);
  e.localGet(0).i32Load8U(48).i32Const(1).i32And();
  e.else_();
  e.i32Const(0);
  e.end();
  return e.buildBody([[1, VAL_I32]]);
}

export function patchRmlUiNativeBridge(buf: Uint8Array): Buffer {
  const sections = parseSections(buf);
  const sec1 = sections.find((s) => s.id === 1);
  const sec2 = sections.find((s) => s.id === 2);
  const sec3 = sections.find((s) => s.id === 3);
  const sec6 = sections.find((s) => s.id === 6);
  const sec7 = sections.find((s) => s.id === 7);
  const sec9 = sections.find((s) => s.id === 9);
  const sec10 = sections.find((s) => s.id === 10);

  if (!sec1 || !sec2 || !sec3 || !sec6 || !sec7 || !sec9 || !sec10) {
    throw new Error("Missing required WASM sections for RmlUi native patch");
  }

  const { funcImports, globalImports } = countImports(sec2.data);
  const [funcCount, fp1] = readUleb(sec3.data, 0);

  // Append 2 mutable i32 globals: gRmlHudEnabled (default 1), gRmlModalOpen (default 0)
  const g1 = appendMutableI32Global(sec6.data, globalImports, 1);
  const g2 = appendMutableI32Global(g1.data, globalImports, 0);
  sec6.data = g2.data;
  const gRmlHudEnabled = g1.globalIdx;
  const gRmlModalOpen = g2.globalIdx;

  // Ensure function types
  let tData = sec1.data;
  const tVoidVoid = ensureFuncType(tData, [], []);
  tData = tVoidVoid.data;
  const tVoidI32 = ensureFuncType(tData, [], [VAL_I32]);
  tData = tVoidI32.data;
  const tI32Void = ensureFuncType(tData, [VAL_I32], []);
  tData = tI32Void.data;
  const tI32I32 = ensureFuncType(tData, [VAL_I32], [VAL_I32]);
  tData = tI32I32.data;
  const tTwoI32Void = ensureFuncType(tData, [VAL_I32, VAL_I32], []);
  tData = tTwoI32Void.data;
  const tTwoI32RetI32 = ensureFuncType(tData, [VAL_I32, VAL_I32], [VAL_I32]);
  sec1.data = tTwoI32RetI32.data;

  // Reserve 15 new WASM functions
  const baseFn = funcImports + funcCount;
  const fnSyncConsoleLayout = baseFn + 0; // () -> ()
  const fnWrapCreateConsoleLog = baseFn + 1; // () -> ()
  const fnWrapRenderBux = baseFn + 2; // (i32, i32) -> ()
  const fnWrapBuxTouch = baseFn + 3; // (i32) -> ()
  const fnWrapPollEvent = baseFn + 4; // (i32) -> (i32)
  const fnWrapIsTextFocused = baseFn + 5; // () -> (i32)
  const fnRmlSetHudEnabled = baseFn + 6; // (i32) -> ()
  const fnRmlSetModalOpen = baseFn + 7; // (i32) -> ()
  const fnRmlIsInWorld = baseFn + 8; // () -> (i32)
  const fnRmlGetPlayerGems = baseFn + 9; // () -> (i32)
  const fnRmlGetDisplayedGems = baseFn + 10; // () -> (i32)
  const fnRmlOpenStore = baseFn + 11; // () -> ()
  const fnRmlSendPacket = baseFn + 12; // (i32, i32) -> (i32)
  const fnRmlPlayClickSound = baseFn + 13; // () -> ()
  const fnRmlIsAudioEnabled = baseFn + 14; // () -> (i32)

  const newTypeIndices = [
    tVoidVoid.typeIdx,
    tVoidVoid.typeIdx,
    tTwoI32Void.typeIdx,
    tI32Void.typeIdx,
    tI32I32.typeIdx,
    tVoidI32.typeIdx,
    tI32Void.typeIdx,
    tI32Void.typeIdx,
    tVoidI32.typeIdx,
    tVoidI32.typeIdx,
    tVoidI32.typeIdx,
    tVoidVoid.typeIdx,
    tTwoI32RetI32.typeIdx,
    tVoidVoid.typeIdx,
    tVoidI32.typeIdx,
  ];

  sec3.data = Buffer.concat([
    Buffer.from(writeUleb(funcCount + newTypeIndices.length)),
    Buffer.from(sec3.data.subarray(fp1)),
    Buffer.from(newTypeIndices.flatMap((idx) => writeUleb(idx))),
  ]);

  // Redirect indirect element table slots for RenderBuxComponent
  sec9.data = patchElementSlots(sec9.data, [
    {
      slot: TBL_SLOT_RENDER_BUX,
      expectedFn: FN_RENDER_BUX_ON_RENDER,
      replacementFn: fnWrapRenderBux,
    },
    {
      slot: TBL_SLOT_BUX_TOUCH,
      expectedFn: FN_BUX_OPEN_STORE,
      replacementFn: fnWrapBuxTouch,
    },
  ]);

  // Parse existing code bodies and apply instruction-accurate call redirections
  let cp = 0;
  const [codeCount, cp1] = readUleb(sec10.data, cp);
  cp = cp1;
  if (codeCount !== funcCount) throw new Error("WASM function/code count mismatch in RmlUi patch");
  const bodies: Buffer[] = [];
  for (let i = 0; i < codeCount; i++) {
    const [sz, cp2] = readUleb(sec10.data, cp);
    bodies.push(Buffer.from(sec10.data.subarray(cp2, cp2 + sz)));
    cp = cp2 + sz;
  }

  for (const callerFid of CALLERS_CREATE_CONSOLE_LOG) {
    const idx = callerFid - funcImports;
    bodies[idx] = replaceDirectCallsInBody(
      bodies[idx],
      FN_CREATE_CONSOLE_LOG,
      fnWrapCreateConsoleLog,
      1,
      callerFid
    );
  }

  for (const callerFid of CALLERS_SDL_POLL_EVENT) {
    const idx = callerFid - funcImports;
    bodies[idx] = replaceDirectCallsInBody(
      bodies[idx],
      FN_SDL_POLL_EVENT,
      fnWrapPollEvent,
      2,
      callerFid
    );
  }

  for (const callerFid of CALLERS_IS_TEXT_FOCUSED) {
    const idx = callerFid - funcImports;
    bodies[idx] = replaceDirectCallsInBody(
      bodies[idx],
      FN_IS_TEXT_FOCUSED,
      fnWrapIsTextFocused,
      1,
      callerFid
    );
  }

  // Append our 15 compiled WASM function bodies
  bodies.push(
    buildFnSyncConsoleLayout(gRmlHudEnabled),
    buildFnWrapCreateConsoleLog(fnSyncConsoleLayout),
    buildFnWrapRenderBux(gRmlHudEnabled),
    buildFnWrapBuxTouch(gRmlHudEnabled),
    buildFnWrapPollEvent(gRmlModalOpen),
    buildFnWrapIsTextFocused(gRmlModalOpen),
    buildFnRmlSetHudEnabled(gRmlHudEnabled, fnSyncConsoleLayout),
    buildFnRmlSetModalOpen(gRmlModalOpen),
    buildFnRmlIsInWorld(),
    buildFnRmlGetPlayerGems(),
    buildFnRmlGetDisplayedGems(fnRmlGetPlayerGems),
    buildFnRmlOpenStore(),
    buildFnRmlSendPacket(),
    buildFnRmlPlayClickSound(),
    buildFnRmlIsAudioEnabled()
  );

  const codeChunks: Buffer[] = [Buffer.from(writeUleb(bodies.length))];
  for (const b of bodies) {
    codeChunks.push(Buffer.from(writeUleb(b.length)), b);
  }
  sec10.data = Buffer.concat(codeChunks);

  // Export native RmlUi bridge functions in Section 7
  sec7.data = appendExports(sec7.data, [
    { name: "rmlSyncConsoleLayout", funcIdx: fnSyncConsoleLayout },
    { name: "rmlSetHudEnabled", funcIdx: fnRmlSetHudEnabled },
    { name: "rmlSetModalOpen", funcIdx: fnRmlSetModalOpen },
    { name: "rmlIsInWorld", funcIdx: fnRmlIsInWorld },
    { name: "rmlGetPlayerGems", funcIdx: fnRmlGetPlayerGems },
    { name: "rmlGetDisplayedGems", funcIdx: fnRmlGetDisplayedGems },
    { name: "rmlOpenStore", funcIdx: fnRmlOpenStore },
    { name: "rmlSendPacket", funcIdx: fnRmlSendPacket },
    { name: "rmlPlayClickSound", funcIdx: fnRmlPlayClickSound },
    { name: "rmlIsAudioEnabled", funcIdx: fnRmlIsAudioEnabled },
  ]);

  const out = encodeModule(sections);
  if (!WebAssembly.validate(new Uint8Array(out))) {
    throw new Error("patchRmlUiNativeBridge produced invalid WebAssembly");
  }
  return out;
}
