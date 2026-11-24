/**
 * Native WASM `add_color_slider|` dialog element & active-script watermark removal.
 *
 * Syntax inside any Growtopia dialog string:
 *   add_color_slider|<name>|<label>|<mode>|<value>|<max>|
 *
 * Modes (`<mode>` first char, case-insensitive):
 *   - 'h' : Hue (0..360 smooth rainbow spectrum bar, live updates dialog HSV theme)
 *   - 's' : Saturation (0..100 smooth gradient bar, live updates dialog HSV theme)
 *   - 'v' : Brightness / Value (0..100 smooth gradient bar, live updates dialog HSV theme)
 *   - 'a' : Transparency / Opacity (0..100 smooth alpha gradient bar, live updates dialog alpha)
 *   - 'r' / 'g' / 'b' : Direct RGB channel (0..255 smooth gradient)
 *   - 'x' : Generic numeric slider (does not live-tint dialog background/border)
 *
 * Patches applied to pinned `upstream.wasm`:
 *   1. `func_5173` (`RenderActiveScriptsWatermark`): replaced with no-op (`00 0b`) so the
 *      `play.magnolia.test - N script(s) active` overlay can never render.
 *   2. Indirect table (`sid = 9`) slot `2310` (`func_5624`, `HandleCustomDialogCommand`):
 *      redirected to `fnHandleColorSliderDialog`, which builds `add_color_slider|` rows
 *      using native Proton `CreateTextLabelEntity`, `CreateOverlayRectEntity` (72-strip
 *      seamless continuous gradient bar), and `CreateSlider` (`func_5196`), completely hiding
 *      `CreateSlider`'s default 3px white line (`prevTail->next`), and delegating all other
 *      commands to `func_5624`.
 *   3. `func_4334` (`SliderComponent::OnProgressChanged`): extended to call
 *      `fnOnSliderProgressChanged` after `func_2512`, updating the right-aligned value label,
 *      keeping full-bar `touchPadding` synced, re-tinting S/V/A smooth gradient bars, and
 *      live-previewing `pDialogBgEnt` background + border at 60 FPS while dragging.
 *   4. Smooth uninterrupted slider input hooks:
 *      - Table slot `3771` (`func_4374`, `ScrollComponent::OnTouchMove`) -> `fnOnScrollTouchMove`:
 *        prevents `GameDialog`'s `ScrollComponent` from hijacking `m_pEntHandled` after 5px of
 *        horizontal slider movement.
 *      - Table slot `3856` (`func_4331`, `SliderComponent::OnTouchStart`) -> `fnOnSliderTouchStart`:
 *        snaps knob immediately when clicking anywhere along the gradient bar and locks drag focus.
 *      - Table slot `3855` (`func_4332`, `SliderComponent::OnTouchEnd`) -> `fnOnSliderTouchEnd` &
 *        Table slot `3853` (`func_4335`, `SliderComponent::OnInput`) -> `fnOnSliderInput`:
 *        eliminates cursor-overshoot desync and guarantees clean drag tracking even when the
 *        pointer leaves the knob or dialog bounds (`ignoreTouchesOutsideRect = 1`).
 *   5. `func_1770` (`DialogButtonClicked`): injected right before the dialog entity loop to call
 *      `fnAppendColorSlidersToPacket`, serializing `<name>|<intValue>\n` into `dialog_return`
 *      without touching Ubisoft's `input_slider|` Captcha path.
 */

const VAL_I32 = 0x7f;
const VAL_I64 = 0x7e;
const VAL_F32 = 0x7d;
const VOID_BLOCK = 0x40;

// Smooth gradient resolution (72 overlapping micro-strips => ~5px/strip, <4/255 step, zero seams)
const NUM_GRADIENT_STRIPS = 72;
const MAX_GRADIENT_STRIP_IDX = NUM_GRADIENT_STRIPS - 1; // 71

// Verified passive-segment-0 C-string virtual addresses in pinned `upstream.wasm`
const VA_SLIDER_BTN_RTTEX = 9825;     // "interface/slider_button.rttex"
const VA_IGNORE_OUTSIDE_RECT = 25117; // "ignoreTouchesOutsideRect"
const VA_BORDER_COLOR = 32170;        // "borderColor"
const VA_TOUCH_PADDING = 45617;       // "touchPadding"

// Verified function indices in pinned `upstream.wasm`
const FN_OPERATOR_DELETE = 308;       // (i32) -> ()
const FN_GET_BASE_APP = 312;          // () -> (i32)
const FN_SIGNAL_FIRE = 318;           // (i32, i32) -> ()
const FN_GET_ENTITY_BY_NAME = 319;    // (i32, i32) -> (i32)
const FN_STD_STRING_FROM_CSTR = 330;  // (i32, i32) -> (i32)
const FN_SETUP_TEXT_ENTITY = 380;     // (i32, i32, f32) -> ()
const FN_SET_ALIGNMENT_ENTITY = 415;  // (i32, i32) -> ()
const FN_GET_FONT_AND_SCALE = 427;    // (i32, i32, f32) -> ()
const FN_CREATE_OVERLAY_RECT = 462;   // (i32, i32, i32, i32, i32) -> (i32)
const FN_PARSE_INT_DEFAULT = 639;     // (i32, i32) -> (i32)
const FN_VARIANTDB_GET_VAR = 889;     // (i32, i32) -> (i32)
const FN_GET_COMPONENT_BY_NAME = 995; // (i32, i32, i32) -> (i32)
const FN_GET_SCROLL_CHILD = 1097;     // (i32) -> (i32)
const FN_STD_STRING_APPEND = 1559;    // (i32, i32, i32) -> (i32)
const FN_DIALOG_BUTTON_CLICKED = 1770;// (i32) -> ()
const FN_SLIDER_UPDATE_THUMB = 2512;  // (i32) -> ()
const FN_VARIANT_SET_STR = 4132;      // (i32, i32) -> ()
const FN_SLIDER_TOUCH_START = 4331;   // (i32, i32) -> ()
const FN_SLIDER_TOUCH_END = 4332;     // (i32, i32) -> ()
const FN_SLIDER_ON_PROGRESS = 4334;   // (i32, i32) -> ()
const FN_SLIDER_ON_INPUT = 4335;      // (i32, i32) -> ()
const FN_SCROLL_TOUCH_MOVE = 4374;    // (i32, i32) -> ()
const FN_SET_NAME = 5090;             // (i32, i32) -> ()
const FN_WATERMARK_RENDER = 5173;     // () -> ()
const FN_CREATE_TEXT_LABEL = 5192;    // (i32, i32, f32, f32, i32) -> (i32)
const FN_CREATE_SLIDER = 5196;        // (i32, f32, f32, f32, i32, i32, i32, i32, i32, f32, f32, i32) -> (i32)
const FN_CUSTOM_DIALOG_CMD = 5624;    // (i32, i32, i32, i32, i32, i32) -> (i32)

// Verified indirect element table (`sid = 9`) slots in pinned `upstream.wasm`
const TBL_SLOT_CUSTOM_DIALOG_CMD = 2310;
const TBL_SLOT_SCROLL_TOUCH_MOVE = 3771;
const TBL_SLOT_SLIDER_ON_INPUT = 3853;
const TBL_SLOT_SLIDER_TOUCH_END = 3855;
const TBL_SLOT_SLIDER_TOUCH_START = 3856;

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

function writeSleb64(val: bigint): number[] {
  const out: number[] = [];
  let v = BigInt.asIntN(64, val);
  while (true) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0)) {
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

function asciiI64LE(str8: string): bigint {
  if (str8.length !== 8) throw new Error(`Expected 8 ASCII bytes, got ${str8.length}`);
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(str8.charCodeAt(i) & 0xff) << BigInt(i * 8);
  }
  return BigInt.asIntN(64, v);
}

class Emitter {
  public readonly bytes: number[] = [];

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  i32Const(v: number): this {
    return this.raw(0x41, ...writeSleb32(v));
  }
  i64Const(v: bigint): this {
    return this.raw(0x42, ...writeSleb64(v));
  }
  f32Const(v: number): this {
    return this.raw(0x43, ...writeF32(v));
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
  call(fnIdx: number): this {
    return this.raw(0x10, ...writeUleb(fnIdx));
  }
  callIndirect(typeIdx: number, tableIdx = 0): this {
    return this.raw(0x11, ...writeUleb(typeIdx), ...writeUleb(tableIdx));
  }
  block(bt = VOID_BLOCK): this {
    return this.raw(0x02, bt);
  }
  loop(bt = VOID_BLOCK): this {
    return this.raw(0x03, bt);
  }
  if_(bt = VOID_BLOCK): this {
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
  return_(): this {
    return this.raw(0x0f);
  }
  drop(): this {
    return this.raw(0x1a);
  }
  select(): this {
    return this.raw(0x1b);
  }

  // Memory ops
  i32Load(offset = 0, align = 2): this {
    return this.raw(0x28, ...writeUleb(align), ...writeUleb(offset));
  }
  i64Load(offset = 0, align = 0): this {
    return this.raw(0x29, ...writeUleb(align), ...writeUleb(offset));
  }
  f32Load(offset = 0, align = 2): this {
    return this.raw(0x2a, ...writeUleb(align), ...writeUleb(offset));
  }
  i32Load8S(offset = 0): this {
    return this.raw(0x2c, 0x00, ...writeUleb(offset));
  }
  i32Load8U(offset = 0): this {
    return this.raw(0x2d, 0x00, ...writeUleb(offset));
  }
  i32Load16S(offset = 0, align = 1): this {
    return this.raw(0x2e, ...writeUleb(align), ...writeUleb(offset));
  }
  i32Store(offset = 0, align = 2): this {
    return this.raw(0x36, ...writeUleb(align), ...writeUleb(offset));
  }
  i64Store(offset = 0, align = 2): this {
    return this.raw(0x37, ...writeUleb(align), ...writeUleb(offset));
  }
  f32Store(offset = 0, align = 2): this {
    return this.raw(0x38, ...writeUleb(align), ...writeUleb(offset));
  }
  i32Store8(offset = 0): this {
    return this.raw(0x3a, 0x00, ...writeUleb(offset));
  }

  // Comparisons & arithmetic
  i32Eqz(): this { return this.raw(0x45); }
  i32Eq(): this { return this.raw(0x46); }
  i32Ne(): this { return this.raw(0x47); }
  i32LtS(): this { return this.raw(0x48); }
  i32GtS(): this { return this.raw(0x4a); }
  i32LeS(): this { return this.raw(0x4c); }
  i32GeS(): this { return this.raw(0x4e); }
  i64Eqz(): this { return this.raw(0x50); }
  f32Eq(): this { return this.raw(0x5b); }
  f32Gt(): this { return this.raw(0x5e); }
  f32Le(): this { return this.raw(0x5f); }
  f32Ge(): this { return this.raw(0x60); }
  i32Add(): this { return this.raw(0x6a); }
  i32Sub(): this { return this.raw(0x6b); }
  i32Mul(): this { return this.raw(0x6c); }
  i32DivS(): this { return this.raw(0x6d); }
  i32RemS(): this { return this.raw(0x6f); }
  i32And(): this { return this.raw(0x71); }
  i32Or(): this { return this.raw(0x72); }
  i32Shl(): this { return this.raw(0x74); }
  i32ShrU(): this { return this.raw(0x76); }
  i64Or(): this { return this.raw(0x84); }
  i64Xor(): this { return this.raw(0x85); }
  f32Add(): this { return this.raw(0x92); }
  f32Sub(): this { return this.raw(0x93); }
  f32Mul(): this { return this.raw(0x94); }
  f32Div(): this { return this.raw(0x95); }
  f32Min(): this { return this.raw(0x96); }
  f32Max(): this { return this.raw(0x97); }
  i32TruncF32S(): this { return this.raw(0xa8); }
  f32ConvertI32S(): this { return this.raw(0xb2); }

  /**
   * Writes a 12-byte libc++ short-mode `std::string` (`len <= 10`) at `spLocal + offset`
   * with zero heap allocations.
   */
  writeInlineSso(spLocal: number, offset: number, str: string): this {
    if (str.length > 10) throw new Error(`SSO overflow for "${str}"`);
    const buf = Buffer.alloc(12, 0);
    buf.write(str, 0, "ascii");
    buf[11] = str.length;
    const lo = buf.readBigInt64LE(0);
    const hi = buf.readInt32LE(8);
    this.localGet(spLocal).i64Const(lo).i64Store(offset, 2);
    this.localGet(spLocal).i32Const(hi).i32Store(offset + 8, 2);
    return this;
  }

  /**
   * Frees a 12-byte libc++ `std::string` at `spLocal + offset` if heap-allocated (`byte[11] < 0`).
   */
  freeStdString(spLocal: number, offset: number): this {
    this.localGet(spLocal).i32Load8S(offset + 11).i32Const(0).i32LtS().if_();
    this.localGet(spLocal).i32Load(offset, 2).call(FN_OPERATOR_DELETE);
    this.end();
    return this;
  }

  /**
   * Clamps top-of-stack `i32` (using `tmpLocal`) into `[minVal, maxVal]` and leaves it on stack.
   * WASM `select` pops `[trueVal, falseVal, cond]` -> `cond ? trueVal : falseVal`.
   */
  clampI32(tmpLocal: number, minVal: number, maxVal: number): this {
    this.localSet(tmpLocal);
    this.i32Const(minVal).localGet(tmpLocal).localGet(tmpLocal).i32Const(minVal).i32LtS().select();
    this.localSet(tmpLocal);
    this.i32Const(maxVal).localGet(tmpLocal).localGet(tmpLocal).i32Const(maxVal).i32GtS().select();
    return this;
  }

  /**
   * Clamps top-of-stack `i32` (using `tmpLocal`) into `[minVal, local(maxLocal)]` and leaves it on stack.
   */
  clampI32Local(tmpLocal: number, minVal: number, maxLocal: number): this {
    this.localSet(tmpLocal);
    this.i32Const(minVal).localGet(tmpLocal).localGet(tmpLocal).i32Const(minVal).i32LtS().select();
    this.localSet(tmpLocal);
    this.localGet(maxLocal).localGet(tmpLocal).localGet(tmpLocal).localGet(maxLocal).i32GtS().select();
    return this;
  }

  buildFunctionBody(localGroups: Array<[number, number]>): Buffer {
    this.end(); // function end
    const header: number[] = [...writeUleb(localGroups.length)];
    for (const [cnt, t] of localGroups) {
      header.push(...writeUleb(cnt), t);
    }
    return Buffer.from([...header, ...this.bytes]);
  }
}

function countImports(sec2: Uint8Array): { funcImports: number; globalImports: number } {
  let p = 0;
  const [count, p1] = readUleb(sec2, p);
  p = p1;
  let funcImports = 0;
  let globalImports = 0;
  for (let i = 0; i < count; i++) {
    const [modLen, m1] = readUleb(sec2, p);
    p = m1 + modLen;
    const [nameLen, n1] = readUleb(sec2, p);
    p = n1 + nameLen;
    const kind = sec2[p++];
    if (kind === 0) {
      const [, next] = readUleb(sec2, p);
      p = next;
      funcImports++;
    } else if (kind === 1) {
      p++; // elemtype
      const flags = sec2[p++];
      const [, t1] = readUleb(sec2, p);
      p = t1;
      if (flags & 1) {
        const [, t2] = readUleb(sec2, p);
        p = t2;
      }
    } else if (kind === 2) {
      const flags = sec2[p++];
      const [, m2] = readUleb(sec2, p);
      p = m2;
      if (flags & 1) {
        const [, m3] = readUleb(sec2, p);
        p = m3;
      }
    } else if (kind === 3) {
      p += 2;
      globalImports++;
    }
  }
  return { funcImports, globalImports };
}

function appendMutableI32Global(sec6: Uint8Array, globalImports: number): { data: Buffer; globalIdx: number } {
  const [gCount, p1] = readUleb(sec6, 0);
  const globalIdx = globalImports + gCount;
  const entry = Buffer.from([VAL_I32, 0x01, 0x41, 0x00, 0x0b]); // (global (mut i32) (i32.const 0))
  const data = Buffer.concat([
    Buffer.from(writeUleb(gCount + 1)),
    Buffer.from(sec6.subarray(p1)),
    entry,
  ]);
  return { data, globalIdx };
}

function ensureFuncType(
  sec1: Uint8Array,
  params: number[],
  results: number[]
): { data: Buffer; typeIdx: number } {
  let p = 0;
  const [count, p1] = readUleb(sec1, p);
  p = p1;
  for (let i = 0; i < count; i++) {
    if (sec1[p++] !== 0x60) throw new Error("Unexpected non-func type in WASM type section");
    const [np, q1] = readUleb(sec1, p);
    p = q1;
    const ps = sec1.subarray(p, p + np);
    p += np;
    const [nr, q2] = readUleb(sec1, p);
    p = q2;
    const rs = sec1.subarray(p, p + nr);
    p += nr;
    if (
      np === params.length &&
      nr === results.length &&
      params.every((v, k) => ps[k] === v) &&
      results.every((v, k) => rs[k] === v)
    ) {
      return { data: Buffer.from(sec1), typeIdx: i };
    }
  }
  const entry = Buffer.from([
    0x60,
    ...writeUleb(params.length),
    ...params,
    ...writeUleb(results.length),
    ...results,
  ]);
  const out = Buffer.concat([
    Buffer.from(writeUleb(count + 1)),
    Buffer.from(sec1.subarray(p1)),
    entry,
  ]);
  return { data: out, typeIdx: count };
}

/**
 * Emits `fnHsvToRgba(h: i32, s: i32, v: i32, a: i32) -> i32`
 * Returns Proton `MAKE_RGBA(R, G, B, A)` = `(B << 24) | (G << 16) | (R << 8) | A`.
 */
function buildFnHsvToRgba(): Buffer {
  // Params: 0:h, 1:s, 2:v, 3:a
  // Locals: 4:sector(i32), 5:r(i32), 6:g(i32), 7:b(i32), 8:tmp(i32)
  //         9:sf(f32), 10:vf(f32), 11:f(f32), 12:p(f32), 13:q(f32), 14:t(f32), 15:rf(f32), 16:gf(f32), 17:bf(f32)
  const e = new Emitter();
  e.localGet(0).i32Const(360).i32RemS().i32Const(360).i32Add().i32Const(360).i32RemS().localSet(0);
  e.localGet(1).clampI32(8, 0, 100).localSet(1);
  e.localGet(2).clampI32(8, 0, 100).localSet(2);
  e.localGet(3).clampI32(8, 0, 255).localSet(3);

  e.localGet(1).f32ConvertI32S().f32Const(0.01).f32Mul().localSet(9);
  e.localGet(2).f32ConvertI32S().f32Const(0.01).f32Mul().localSet(10);

  e.localGet(0).i32Const(60).i32DivS().localSet(4);
  e.localGet(0).i32Const(60).i32RemS().f32ConvertI32S().f32Const(60.0).f32Div().localSet(11);

  e.localGet(10).f32Const(1.0).localGet(9).f32Sub().f32Mul().localSet(12);
  e.localGet(10).f32Const(1.0).localGet(9).localGet(11).f32Mul().f32Sub().f32Mul().localSet(13);
  e.localGet(10).f32Const(1.0).localGet(9).f32Const(1.0).localGet(11).f32Sub().f32Mul().f32Sub().f32Mul().localSet(14);

  e.localGet(4).i32Eqz().if_();
  e.localGet(10).localSet(15).localGet(14).localSet(16).localGet(12).localSet(17);
  e.else_().localGet(4).i32Const(1).i32Eq().if_();
  e.localGet(13).localSet(15).localGet(10).localSet(16).localGet(12).localSet(17);
  e.else_().localGet(4).i32Const(2).i32Eq().if_();
  e.localGet(12).localSet(15).localGet(10).localSet(16).localGet(14).localSet(17);
  e.else_().localGet(4).i32Const(3).i32Eq().if_();
  e.localGet(12).localSet(15).localGet(13).localSet(16).localGet(10).localSet(17);
  e.else_().localGet(4).i32Const(4).i32Eq().if_();
  e.localGet(14).localSet(15).localGet(12).localSet(16).localGet(10).localSet(17);
  e.else_();
  e.localGet(10).localSet(15).localGet(12).localSet(16).localGet(13).localSet(17);
  e.end().end().end().end().end();

  e.localGet(15).f32Const(255.0).f32Mul().f32Const(0.5).f32Add().i32TruncF32S().clampI32(8, 0, 255).localSet(5);
  e.localGet(16).f32Const(255.0).f32Mul().f32Const(0.5).f32Add().i32TruncF32S().clampI32(8, 0, 255).localSet(6);
  e.localGet(17).f32Const(255.0).f32Mul().f32Const(0.5).f32Add().i32TruncF32S().clampI32(8, 0, 255).localSet(7);

  e.localGet(7).i32Const(24).i32Shl();
  e.localGet(6).i32Const(16).i32Shl().i32Or();
  e.localGet(5).i32Const(8).i32Shl().i32Or();
  e.localGet(3).i32Or();

  return e.buildFunctionBody([
    [5, VAL_I32],
    [9, VAL_F32],
  ]);
}

/**
 * Emits `fnFormatSliderValue(dstStrPtr: i32, val: i32, modeChar: i32, includeStyle: i32) -> ()`
 * Writes a 12-byte inline SSO `std::string` at `dstStrPtr` (e.g. "`w82%" when includeStyle=1, or "82" when 0).
 */
function buildFnFormatSliderValue(): Buffer {
  const e = new Emitter();
  e.localGet(0).i64Const(0n).i64Store(0, 0);
  e.localGet(0).i32Const(0).i32Store(8, 0);
  e.localGet(1).clampI32(9, 0, 9999).localSet(1);
  e.i32Const(0).localSet(4);

  e.localGet(3).if_();
  e.localGet(0).i32Const(0x60).i32Store8(0); // '`'
  e.localGet(0).i32Const(0x77).i32Store8(1); // 'w'
  e.i32Const(2).localSet(4);
  e.end();

  e.localGet(1).i32Const(1000).i32GeS().if_();
  e.localGet(0).localGet(4).i32Add().localGet(1).i32Const(1000).i32DivS().i32Const(48).i32Add().i32Store8(0);
  e.localGet(4).i32Const(1).i32Add().localSet(4);
  e.end();

  e.localGet(1).i32Const(100).i32GeS().if_();
  e.localGet(0).localGet(4).i32Add().localGet(1).i32Const(100).i32DivS().i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(0);
  e.localGet(4).i32Const(1).i32Add().localSet(4);
  e.end();

  e.localGet(1).i32Const(10).i32GeS().if_();
  e.localGet(0).localGet(4).i32Add().localGet(1).i32Const(10).i32DivS().i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(0);
  e.localGet(4).i32Const(1).i32Add().localSet(4);
  e.end();

  e.localGet(0).localGet(4).i32Add().localGet(1).i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(0);
  e.localGet(4).i32Const(1).i32Add().localSet(4);

  e.localGet(3).if_();
  e.localGet(2).i32Const(115).i32Eq();
  e.localGet(2).i32Const(118).i32Eq().i32Or();
  e.localGet(2).i32Const(97).i32Eq().i32Or();
  e.if_();
  e.localGet(0).localGet(4).i32Add().i32Const(0x25).i32Store8(0); // '%'
  e.localGet(4).i32Const(1).i32Add().localSet(4);
  e.end();
  e.end();

  e.localGet(0).localGet(4).i32Add().i32Const(0).i32Store8(0);
  e.localGet(0).localGet(4).i32Store8(11);

  return e.buildFunctionBody([[6, VAL_I32]]);
}

/**
 * Emits `fnOnSliderProgressChanged(pSliderComp: i32) -> ()`
 * Updates right-aligned live value readout, keeps full-bar `touchPadding` synced on `sliderButton`,
 * re-tints S/V/A 72-strip smooth gradient bars, and live-updates `pDialogBgEnt` background + border!
 */
function buildFnOnSliderProgressChanged(
  fnHsvToRgba: number,
  fnFormatSliderValue: number
): Buffer {
  /*
   * Stack frame = 96 bytes (`sp` = local 1):
   *   sp + 0  .. 11 : strTmp ("touchPadding" / "cval|<retName>" / "borderColor")
   *   sp + 12 .. 23 : strProgress ("progress")
   *   sp + 24 .. 35 : strSlider ("Slider")
   *   sp + 36 .. 47 : strTextRender ("TextRender")
   *   sp + 48 .. 59 : strText ("text")
   *   sp + 60 .. 71 : strVal (formatted value SSO)
   *   sp + 72 .. 83 : strColor ("color")
   *   sp + 84 .. 95 : strRectRender ("RectRender")
   *
   * Locals:
   *   0: pSliderComp (param)
   *   1..32: i32 locals
   *   33: prog (f32), 34: trackW (f32), 35: knobX (f32)
   */
  const FRAME = 96;
  const e = new Emitter();

  e.globalGet(0).i32Const(FRAME).i32Sub().localTee(1).globalSet(0);

  e.block();
  {
    e.localGet(0).i32Eqz().brIf(0);
    e.localGet(0).i32Load(32, 2).localTee(2).i32Eqz().brIf(0);
    e.localGet(2).i32Load(124, 2).localTee(3).i32Eqz().brIf(0);

    // Read Entity::m_name at pSliderEnt + 40
    e.localGet(2).i32Load(40, 2).localGet(2).i32Const(40).i32Add();
    e.localGet(2).i32Load8S(51).localTee(32).i32Const(0).i32LtS().select().localSet(4);
    e.localGet(2).i32Load(44, 2).localGet(32).localGet(32).i32Const(0).i32LtS().select().localSet(5);

    e.localGet(5).i32Const(13).i32LtS().brIf(0);
    e.localGet(4).i64Load(0, 0).i64Const(asciiI64LE("cslider|")).i64Xor().i64Eqz().i32Eqz().brIf(0);
    e.localGet(4).i32Load8U(9).i32Const(124).i32Ne().brIf(0);
    e.localGet(4).i32Load8U(8).localSet(6); // modeChar

    // Parse maxVal from namePtr[10..] up to '|'
    e.i32Const(0).localSet(7);
    e.i32Const(10).localSet(8);
    e.block().loop();
    {
      e.localGet(8).localGet(5).i32GeS().brIf(1);
      e.localGet(4).localGet(8).i32Add().i32Load8U(0).localTee(32);
      e.i32Const(124).i32Eq().if_();
      e.localGet(8).i32Const(1).i32Add().localSet(8);
      e.br(2);
      e.end();
      e.localGet(7).i32Const(10).i32Mul().localGet(32).i32Const(48).i32Sub().i32Add().localSet(7);
      e.localGet(8).i32Const(1).i32Add().localSet(8);
      e.br(0);
    }
    e.end().end();

    e.localGet(7).i32Const(0).i32LeS().if_().i32Const(100).localSet(7).end();
    e.localGet(4).localGet(8).i32Add().localSet(9); // retNamePtr
    e.localGet(5).localGet(8).i32Sub().localTee(10).i32Const(0).i32LeS().brIf(0);

    // Materialize inline SSO strings
    e.writeInlineSso(1, 12, "progress");
    e.writeInlineSso(1, 24, "Slider");
    e.writeInlineSso(1, 36, "TextRender");
    e.writeInlineSso(1, 48, "text");
    e.writeInlineSso(1, 72, "color");
    e.writeInlineSso(1, 84, "RectRender");

    // Read current progress from pSliderComp + 36 (with NaN guard: f == f)
    e.localGet(0).i32Const(36).i32Add().localGet(1).i32Const(12).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
    e.i32Eqz().brIf(0);
    e.localGet(11).f32Load(8, 2).localSet(33);
    e.localGet(33).localGet(33).f32Eq().i32Eqz().if_().f32Const(0.0).localSet(33).end();
    e.localGet(33).f32Const(0.0).f32Max().f32Const(1.0).f32Min().localSet(33);
    e.localGet(33).localGet(7).f32ConvertI32S().f32Mul().f32Const(0.5).f32Add().i32TruncF32S();
    e.clampI32Local(32, 0, 7).localSet(12);

    // Keep `sliderButton` `touchPadding` expanded across the entire gradient track `[0..trackW]`
    // so clicking ANYWHERE on the color bar hits `sliderButton` natively!
    e.localGet(0).i32Load(112, 2).localTee(13).if_();
    {
      e.localGet(0).i32Load(88, 2).localTee(32).if_();
      {
        e.localGet(32).f32Load(0, 2).localSet(34); // trackW
        e.localGet(33).localGet(34).f32Mul().localSet(35); // knobX = prog * trackW
        e.localGet(1).i32Const(VA_TOUCH_PADDING).call(FN_STD_STRING_FROM_CSTR).drop();
        e.localGet(13).i32Const(76).i32Add().localGet(1).call(FN_VARIANTDB_GET_VAR).localSet(11);
        e.freeStdString(1, 0);
        e.localGet(11).if_();
        {
          // CL_Rectf(leftPad, topPad, rightPad, bottomPad) at pVar + 8..20 (type = 8)
          e.localGet(11).localGet(35).f32Const(8.0).f32Add().f32Store(8, 2); // leftPad = knobX + 8
          e.localGet(11).f32Const(4.0).f32Store(12, 2);                      // topPad = 4
          e.localGet(11).localGet(34).localGet(35).f32Sub().f32Const(8.0).f32Add().f32Store(16, 2); // rightPad = (trackW - knobX) + 8
          e.localGet(11).f32Const(4.0).f32Store(20, 2);                      // bottomPad = 4
          e.localGet(11).i32Const(8).i32Store(0, 2);
          e.localGet(11).i32Load(36, 2).localTee(32).if_();
          e.localGet(32).localGet(11).call(FN_SIGNAL_FIRE);
          e.end();
        }
        e.end();
      }
      e.end();
    }
    e.end();

    // Update live value label "cval|<retName>" on parentEnt
    e.writeInlineSso(1, 0, "cval|");
    e.localGet(1).localGet(9).localGet(10).call(FN_STD_STRING_APPEND).drop();
    e.localGet(3).localGet(1).call(FN_GET_ENTITY_BY_NAME).localSet(13);
    e.freeStdString(1, 0);

    e.localGet(13).if_();
    {
      e.localGet(13).localGet(1).i32Const(36).i32Add().i32Const(0).call(FN_GET_COMPONENT_BY_NAME).localTee(14);
      e.if_();
      {
        e.localGet(14).i32Const(36).i32Add().localGet(1).i32Const(48).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
        e.if_();
        {
          e.localGet(1).i32Const(60).i32Add().localGet(12).localGet(6).i32Const(1).call(fnFormatSliderValue);
          e.localGet(11).localGet(1).i32Const(60).i32Add().call(FN_VARIANT_SET_STR);
          e.localGet(13).i32Const(3).call(FN_SET_ALIGNMENT_ENTITY);
        }
        e.end();
      }
      e.end();
    }
    e.end();

    // If modeChar == 'x' (120), skip dialog theme color sync
    e.localGet(6).i32Const(120).i32Eq().brIf(0);

    // Resolve pDialogBg = *(*(GetScrollChild(pSliderEnt) + 124) + 124)
    e.localGet(2).call(FN_GET_SCROLL_CHILD).localTee(28).i32Eqz().brIf(0);
    e.localGet(28).i32Load(124, 2).localTee(28).i32Eqz().brIf(0);
    e.localGet(28).i32Load(124, 2).localTee(28).i32Eqz().brIf(0);

    // Read existing dialog bg color as fallback
    e.localGet(28).i32Const(76).i32Add().localGet(1).i32Const(72).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
    e.i32Eqz().brIf(0);
    e.localGet(11).i32Load(8, 2).localSet(32); // curRgba = 0xBBGGRRAA
    e.localGet(32).i32Const(8).i32ShrU().i32Const(255).i32And().localSet(21);  // curR
    e.localGet(32).i32Const(16).i32ShrU().i32Const(255).i32And().localSet(22); // curG
    e.localGet(32).i32Const(24).i32ShrU().i32Const(255).i32And().localSet(23); // curB
    e.localGet(32).i32Const(255).i32And().localSet(20);                        // A
    e.i32Const(202).localSet(17); // default H
    e.i32Const(71).localSet(18);  // default S
    e.i32Const(28).localSet(19);  // default V
    e.i32Const(0).localSet(24);   // hasHsv
    e.i32Const(0).localSet(25);   // hasRgb

    // Pass 1 over parentEnt's children: read all sibling "cslider|..." values
    e.localGet(3).i32Const(52).i32Add().localSet(16); // sentinel
    e.localGet(3).i32Load(56, 2).localSet(15);        // head
    e.block().loop();
    {
      e.localGet(15).localGet(16).i32Eq().brIf(1);
      e.localGet(15).i32Load(8, 2).localTee(13).if_();
      {
        e.localGet(13).i32Load(40, 2).localGet(13).i32Const(40).i32Add();
        e.localGet(13).i32Load8S(51).localTee(32).i32Const(0).i32LtS().select().localSet(4);
        e.localGet(13).i32Load(44, 2).localGet(32).localGet(32).i32Const(0).i32LtS().select().localSet(5);

        e.block();
        {
          e.localGet(5).i32Const(13).i32LtS().brIf(0);
          e.localGet(4).i64Load(0, 0).i64Const(asciiI64LE("cslider|")).i64Xor().i64Eqz().i32Eqz().brIf(0);
          e.localGet(4).i32Load8U(9).i32Const(124).i32Ne().brIf(0);
          e.localGet(4).i32Load8U(8).localSet(26); // cMode

          e.i32Const(0).localSet(27);
          e.i32Const(10).localSet(8);
          e.block().loop();
          {
            e.localGet(8).localGet(5).i32GeS().brIf(1);
            e.localGet(4).localGet(8).i32Add().i32Load8U(0).localTee(32);
            e.i32Const(124).i32Eq().brIf(1);
            e.localGet(27).i32Const(10).i32Mul().localGet(32).i32Const(48).i32Sub().i32Add().localSet(27);
            e.localGet(8).i32Const(1).i32Add().localSet(8);
            e.br(0);
          }
          e.end().end();
          e.localGet(27).i32Const(0).i32LeS().if_().i32Const(100).localSet(27).end();

          e.localGet(13).localGet(1).i32Const(24).i32Add().i32Const(0).call(FN_GET_COMPONENT_BY_NAME).localTee(14);
          e.i32Eqz().brIf(0);
          e.localGet(14).i32Const(36).i32Add().localGet(1).i32Const(12).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
          e.i32Eqz().brIf(0);
          e.localGet(11).f32Load(8, 2).f32Const(0.0).f32Max().f32Const(1.0).f32Min();
          e.localGet(27).f32ConvertI32S().f32Mul().f32Const(0.5).f32Add().i32TruncF32S();
          e.clampI32Local(32, 0, 27).localSet(12);

          e.localGet(26).i32Const(104).i32Eq().if_(); // 'h'
          e.localGet(12).localSet(17).i32Const(1).localSet(24);
          e.else_().localGet(26).i32Const(115).i32Eq().if_(); // 's'
          e.localGet(12).localSet(18).i32Const(1).localSet(24);
          e.else_().localGet(26).i32Const(118).i32Eq().if_(); // 'v'
          e.localGet(12).localSet(19).i32Const(1).localSet(24);
          e.else_().localGet(26).i32Const(97).i32Eq().if_(); // 'a'
          e.localGet(27).i32Const(100).i32Eq().if_();
          e.localGet(12).f32ConvertI32S().f32Const(2.55).f32Mul().f32Const(0.5).f32Add().i32TruncF32S().clampI32(32, 0, 255).localSet(20);
          e.else_();
          e.localGet(12).clampI32(32, 0, 255).localSet(20);
          e.end();
          e.else_().localGet(26).i32Const(114).i32Eq().if_(); // 'r'
          e.localGet(12).clampI32(32, 0, 255).localSet(21).i32Const(1).localSet(25);
          e.else_().localGet(26).i32Const(103).i32Eq().if_(); // 'g'
          e.localGet(12).clampI32(32, 0, 255).localSet(22).i32Const(1).localSet(25);
          e.else_().localGet(26).i32Const(98).i32Eq().if_(); // 'b'
          e.localGet(12).clampI32(32, 0, 255).localSet(23).i32Const(1).localSet(25);
          e.end().end().end().end().end().end().end();
        }
        e.end();
      }
      e.end();
      e.localGet(15).i32Load(4, 2).localSet(15);
      e.br(0);
    }
    e.end().end();

    // Pass 2: if hasHsv, live re-tint "cbar|s", "cbar|v", "cbar|a" 72-strip smooth gradient tracks!
    e.localGet(24).if_();
    {
      e.localGet(3).i32Load(56, 2).localSet(15);
      e.block().loop();
      {
        e.localGet(15).localGet(16).i32Eq().brIf(1);
        e.localGet(15).i32Load(8, 2).localTee(13).if_();
        {
          e.localGet(13).i32Load8S(51).i32Const(6).i32Eq().if_();
          {
            e.localGet(13).i32Load(40, 2).i32Const(0x72616263).i32Eq(); // "cbar"
            e.localGet(13).i32Load8U(44).i32Const(124).i32Eq().i32And(); // '|'
            e.if_();
            {
              e.localGet(13).i32Load8U(45).localSet(26);
              e.localGet(26).i32Const(115).i32Eq();
              e.localGet(26).i32Const(118).i32Eq().i32Or();
              e.localGet(26).i32Const(97).i32Eq().i32Or();
              e.if_();
              {
                e.i32Const(0).localSet(29); // segIdx = 0..71
                e.localGet(13).i32Const(52).i32Add().localSet(31);
                e.localGet(13).i32Load(56, 2).localSet(30);
                e.block().loop();
                {
                  e.localGet(30).localGet(31).i32Eq().brIf(1);
                  e.localGet(29).i32Const(NUM_GRADIENT_STRIPS).i32GeS().brIf(1);
                  e.localGet(30).i32Load(8, 2).localTee(14).if_();
                  {
                    e.localGet(14).i32Const(76).i32Add().localGet(1).i32Const(72).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
                    e.if_();
                    {
                      e.localGet(26).i32Const(115).i32Eq().if_(); // 's': (H, seg*100/71, max(V, 45), 255)
                      e.localGet(17);
                      e.localGet(29).i32Const(100).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS();
                      e.localGet(19).i32Const(45).localGet(19).i32Const(45).i32GtS().select();
                      e.i32Const(255).call(fnHsvToRgba).localSet(32);
                      e.else_().localGet(26).i32Const(118).i32Eq().if_(); // 'v': (H, S, seg*100/71, 255)
                      e.localGet(17).localGet(18);
                      e.localGet(29).i32Const(100).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS();
                      e.i32Const(255).call(fnHsvToRgba).localSet(32);
                      e.else_(); // 'a': (H, S, max(V, 35), 35 + seg*220/71)
                      e.localGet(17).localGet(18);
                      e.localGet(19).i32Const(35).localGet(19).i32Const(35).i32GtS().select();
                      e.i32Const(35).localGet(29).i32Const(220).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Add();
                      e.call(fnHsvToRgba).localSet(32);
                      e.end().end();

                      e.localGet(11).localGet(32).i32Store(8, 2);
                      e.localGet(11).i32Const(5).i32Store(0, 2);
                      e.localGet(11).i32Load(36, 2).localTee(32).if_();
                      e.localGet(32).localGet(11).call(FN_SIGNAL_FIRE);
                      e.end();
                    }
                    e.end();
                  }
                  e.end();
                  e.localGet(29).i32Const(1).i32Add().localSet(29);
                  e.localGet(30).i32Load(4, 2).localSet(30);
                  e.br(0);
                }
                e.end().end();
              }
              e.end();
            }
            e.end();
          }
          e.end();
        }
        e.end();
        e.localGet(15).i32Load(4, 2).localSet(15);
        e.br(0);
      }
      e.end().end();
    }
    e.end();

    // Compute new bgRgba (local 29) and borderRgba (local 30)
    e.localGet(24).if_();
    {
      e.localGet(17).localGet(18).localGet(19).localGet(20).call(fnHsvToRgba).localSet(29);
      e.localGet(17).localGet(18).localGet(19).i32Const(22).i32Add().clampI32(32, 0, 100).i32Const(255).call(fnHsvToRgba).localSet(30);
    }
    e.else_();
    {
      e.localGet(23).i32Const(24).i32Shl();
      e.localGet(22).i32Const(16).i32Shl().i32Or();
      e.localGet(21).i32Const(8).i32Shl().i32Or();
      e.localGet(20).i32Or().localSet(29);

      e.localGet(23).i32Const(35).i32Add().clampI32(32, 0, 255).i32Const(24).i32Shl();
      e.localGet(22).i32Const(35).i32Add().clampI32(32, 0, 255).i32Const(16).i32Shl().i32Or();
      e.localGet(21).i32Const(35).i32Add().clampI32(32, 0, 255).i32Const(8).i32Shl().i32Or();
      e.i32Const(255).i32Or().localSet(30);
    }
    e.end();

    // Apply bgRgba to pDialogBg ("color" on pDialogBg + 76)
    e.localGet(28).i32Const(76).i32Add().localGet(1).i32Const(72).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11);
    e.if_();
    {
      e.localGet(11).localGet(29).i32Store(8, 2);
      e.localGet(11).i32Const(5).i32Store(0, 2);
      e.localGet(11).i32Load(36, 2).localTee(32).if_();
      e.localGet(32).localGet(11).call(FN_SIGNAL_FIRE);
      e.end();
    }
    e.end();

    // Apply borderRgba to pDialogBg's RectRender ("borderColor" on pRectComp + 36)
    e.localGet(28).localGet(1).i32Const(84).i32Add().i32Const(0).call(FN_GET_COMPONENT_BY_NAME).localTee(14);
    e.if_();
    {
      e.localGet(1).i32Const(VA_BORDER_COLOR).call(FN_STD_STRING_FROM_CSTR).drop();
      e.localGet(14).i32Const(36).i32Add().localGet(1).call(FN_VARIANTDB_GET_VAR).localSet(11);
      e.freeStdString(1, 0);
      e.localGet(11).if_();
      {
        e.localGet(11).localGet(30).i32Store(8, 2);
        e.localGet(11).i32Const(5).i32Store(0, 2);
        e.localGet(11).i32Load(36, 2).localTee(32).if_();
        e.localGet(32).localGet(11).call(FN_SIGNAL_FIRE);
        e.end();
      }
      e.end();
    }
    e.end();
  }
  e.end();

  e.localGet(1).i32Const(FRAME).i32Add().globalSet(0);

  return e.buildFunctionBody([
    [32, VAL_I32],
    [3, VAL_F32],
  ]);
}

/**
 * Emits `fnHandleColorSliderDialog(parentEnt, posPtr, maxSizePtr, fieldsVecPtr, dialogStatePtr, extraStatePtr) -> i32`
 * Hooks table slot `2310` (`func_5624`). Handles `add_color_slider|`, delegates everything else to `func_5624`.
 */
function buildFnHandleColorSliderDialog(
  fnHsvToRgba: number,
  fnFormatSliderValue: number,
  gActiveSliderComp: number
): Buffer {
  /*
   * Params: 0:parentEnt, 1:posPtr, 2:maxSizePtr, 3:fieldsVecPtr, 4:dialogStatePtr, 5:extraStatePtr
   * Stack frame = 128 bytes (`sp` = local 6):
   *   sp + 0   .. 3   : fontID (i32)
   *   sp + 4   .. 7   : fontScale (f32)
   *   sp + 8   .. 15  : vec2 pos2d (f32 x, f32 y)
   *   sp + 16  .. 23  : vec2 size2d (f32 w, f32 h)
   *   sp + 24  .. 35  : emptyStr ("")
   *   sp + 36  .. 47  : strTmp1
   *   sp + 48  .. 59  : strVal (formatted initial readout)
   *   sp + 60  .. 71  : strCbar / strAttr ("cbar|<m>", "alpha", "size2d", "scale2d")
   *   sp + 72  .. 83  : strColor ("color")
   *   sp + 84  .. 95  : strProgress ("progress")
   *   sp + 96  .. 111 : scratch ASCII buffer ("<m>|<max>|")
   *
   * Locals:
   *   6:sp, 7:begin, 8:numFields, 9:modeChar, 10:val, 11:maxVal, 12:defaultMax, 13:fontID,
   *   14:pEnt, 15:pBarHolder, 16:segIdx, 17:rgba, 18:pSliderComp, 19:pVar, 20:namePtr, 21:nameLen,
   *   22:prevTailOrScratchLen, 23:tmp
   *   24:fontScale(f32), 25:lineH(f32), 26:curX(f32), 27:curY(f32), 28:xTrack(f32), 29:trackW(f32),
   *   30:barH(f32), 31:yTrack(f32), 32:segW(f32), 33:segX(f32)
   */
  const FRAME = 128;
  const e = new Emitter();

  e.block();
  {
    e.localGet(3).i32Load(0, 2).localSet(7); // begin
    e.localGet(3).i32Load(4, 2).localGet(7).i32Sub().i32Const(12).i32DivS().localTee(8);
    e.i32Const(5).i32LtS().brIf(0);

    e.localGet(7).i32Load8S(11).i32Const(0).i32GeS().brIf(0);
    e.localGet(7).i32Load(4, 2).i32Const(16).i32Ne().brIf(0);
    e.localGet(7).i32Load(0, 2).localSet(23);
    e.localGet(23).i64Load(0, 0).i64Const(asciiI64LE("add_colo")).i64Xor();
    e.localGet(23).i64Load(8, 0).i64Const(asciiI64LE("r_slider")).i64Xor().i64Or();
    e.i64Eqz().i32Eqz().brIf(0);

    // Clear any stale active slider pointer when building slider rows
    e.i32Const(0).globalSet(gActiveSliderComp);

    e.globalGet(0).i32Const(FRAME).i32Sub().localTee(6).globalSet(0);

    // Read field[1] (<name>) ptr & len
    e.localGet(7).i32Load(12, 2).localGet(7).i32Const(12).i32Add();
    e.localGet(7).i32Load8S(23).localTee(23).i32Const(0).i32LtS().select().localSet(20);
    e.localGet(7).i32Load(16, 2).localGet(23).localGet(23).i32Const(0).i32LtS().select().localSet(21);

    // Read field[3] (<mode>) first char lowered
    e.localGet(7).i32Load(36, 2).localGet(7).i32Const(36).i32Add();
    e.localGet(7).i32Load8S(47).localTee(23).i32Const(0).i32LtS().select().localSet(14);
    e.localGet(7).i32Load(40, 2).localGet(23).localGet(23).i32Const(0).i32LtS().select();
    e.i32Const(0).i32GtS().if_();
    e.localGet(14).i32Load8U(0).i32Const(0x20).i32Or().localSet(9);
    e.else_();
    e.i32Const(104).localSet(9);
    e.end();

    // Default max by modeChar
    e.localGet(9).i32Const(104).i32Eq().if_();
    e.i32Const(360).localSet(12);
    e.else_();
    e.localGet(9).i32Const(114).i32Eq();
    e.localGet(9).i32Const(103).i32Eq().i32Or();
    e.localGet(9).i32Const(98).i32Eq().i32Or().if_();
    e.i32Const(255).localSet(12);
    e.else_();
    e.i32Const(100).localSet(12);
    e.end().end();

    // Parse val = field[4], maxVal = field[5] (optional)
    e.localGet(7).i32Const(48).i32Add().i32Const(0).call(FN_PARSE_INT_DEFAULT).localSet(10);
    e.localGet(8).i32Const(6).i32GeS().if_();
    e.localGet(7).i32Const(60).i32Add().localGet(12).call(FN_PARSE_INT_DEFAULT).localSet(11);
    e.else_();
    e.localGet(12).localSet(11);
    e.end();
    e.localGet(11).i32Const(0).i32LeS().if_().localGet(12).localSet(11).end();
    e.localGet(11).i32Const(9999).i32GtS().if_().i32Const(9999).localSet(11).end();
    e.localGet(10).clampI32Local(23, 0, 11).localSet(10);

    // Get DPI-scaled small font
    e.localGet(6).localGet(6).i32Const(4).i32Add().f32Const(32.0).call(FN_GET_FONT_AND_SCALE);
    e.localGet(6).i32Load(0, 2).localSet(13);
    e.localGet(6).f32Load(4, 2).localSet(24);

    // lineH = f32(*(i16*)(GetBaseApp()->GetFont(fontID) + 14)) * fontScale
    e.call(FN_GET_BASE_APP).localTee(23);
    e.localGet(13);
    e.localGet(23).i32Load(0, 2).i32Load(48, 2).callIndirect(3, 0);
    e.i32Load16S(14, 1).f32ConvertI32S().localGet(24).f32Mul().localSet(25);

    // Layout coordinates
    e.localGet(1).f32Load(0, 2).localSet(26); // curX
    e.localGet(1).f32Load(4, 2).localSet(27); // curY
    e.localGet(26).f32Const(14.0).f32Add().localSet(28); // xTrack = curX + 14
    e.localGet(2).f32Load(0, 2).f32Const(36.0).f32Sub().f32Const(180.0).f32Max().localSet(29); // trackW
    e.localGet(25).f32Const(0.68).f32Mul().f32Const(14.0).f32Max().localSet(30); // barH
    e.localGet(27).localGet(25).f32Add().localGet(30).f32Const(0.65).f32Mul().f32Add().f32Const(5.0).f32Add().localSet(31); // yTrack

    e.writeInlineSso(6, 24, "");
    e.writeInlineSso(6, 72, "color");
    e.writeInlineSso(6, 84, "progress");

    // 1) Left label entity at (curX, curY)
    e.localGet(0).localGet(6).i32Const(24).i32Add().localGet(26).localGet(27).localGet(7).i32Const(24).i32Add();
    e.call(FN_CREATE_TEXT_LABEL).localTee(14);
    e.localGet(13).localGet(24).call(FN_SETUP_TEXT_ENTITY);

    // 2) Right live value readout entity "cval|<name>"
    e.writeInlineSso(6, 36, "cval|");
    e.localGet(6).i32Const(36).i32Add().localGet(20).localGet(21).call(FN_STD_STRING_APPEND).drop();
    e.localGet(6).i32Const(48).i32Add().localGet(10).localGet(9).i32Const(1).call(fnFormatSliderValue);
    e.localGet(0).localGet(6).i32Const(36).i32Add();
    e.localGet(28).localGet(29).f32Add().localGet(27);
    e.localGet(6).i32Const(48).i32Add().call(FN_CREATE_TEXT_LABEL).localSet(14);
    e.freeStdString(6, 36);
    e.localGet(14).localGet(13).localGet(24).call(FN_SETUP_TEXT_ENTITY);
    e.localGet(14).i32Const(3).call(FN_SET_ALIGNMENT_ENTITY);

    // 3) Outer dark border frame centered on yTrack + 1.5f
    e.localGet(6).localGet(28).f32Const(2.0).f32Sub().f32Store(8, 2);
    e.localGet(6).localGet(31).f32Const(1.5).f32Add().localGet(30).f32Const(0.5).f32Mul().f32Sub().f32Const(2.0).f32Sub().f32Store(12, 2);
    e.localGet(6).localGet(29).f32Const(4.0).f32Add().f32Store(16, 2);
    e.localGet(6).localGet(30).f32Const(4.0).f32Add().f32Store(20, 2);
    e.localGet(0).localGet(6).i32Const(8).i32Add().localGet(6).i32Const(16).i32Add().i32Const(0x1c140eeb).i32Const(0);
    e.call(FN_CREATE_OVERLAY_RECT).drop();

    // 4) Gradient holder entity "cbar|<m>" at (xTrack, yTrack + 1.5f - barH * 0.5f), alpha 0
    e.localGet(6).localGet(28).f32Store(8, 2);
    e.localGet(6).localGet(31).f32Const(1.5).f32Add().localGet(30).f32Const(0.5).f32Mul().f32Sub().f32Store(12, 2);
    e.localGet(6).localGet(29).f32Store(16, 2);
    e.localGet(6).localGet(30).f32Store(20, 2);
    e.localGet(0).localGet(6).i32Const(8).i32Add().localGet(6).i32Const(16).i32Add().i32Const(0).i32Const(0);
    e.call(FN_CREATE_OVERLAY_RECT).localSet(15);

    e.writeInlineSso(6, 60, "cbar|x");
    e.localGet(6).localGet(9).i32Store8(65);
    e.localGet(15).i32Const(20).i32Add().localGet(6).i32Const(60).i32Add().call(FN_SET_NAME);

    // 72 seamless continuous gradient micro-strips inside pBarHolder
    e.localGet(29).f32Const(NUM_GRADIENT_STRIPS).f32Div().localSet(32); // segW = trackW / 72.0f
    e.i32Const(0).localSet(16);
    e.block().loop();
    {
      e.localGet(16).i32Const(NUM_GRADIENT_STRIPS).i32GeS().brIf(1);
      // segX = seg * segW; width = (seg < 71) ? (segW + 1.0f) : (trackW - segX)
      e.localGet(16).f32ConvertI32S().localGet(32).f32Mul().localTee(33);
      e.localGet(6).localGet(33).f32Store(8, 2);
      e.drop();
      e.localGet(6).f32Const(0.0).f32Store(12, 2);
      e.localGet(6);
      e.localGet(32).f32Const(1.0).f32Add();
      e.localGet(29).localGet(33).f32Sub();
      e.localGet(16).i32Const(MAX_GRADIENT_STRIP_IDX).i32LtS().select();
      e.f32Store(16, 2);
      e.localGet(6).localGet(30).f32Store(20, 2);

      // Compute smooth gradient RGBA for strip `segIdx` (0..71)
      e.localGet(9).i32Const(104).i32Eq().if_(); // 'h': smooth 5-degree rainbow steps (0..355)
      e.localGet(16).i32Const(360).i32Mul().i32Const(NUM_GRADIENT_STRIPS).i32DivS();
      e.i32Const(95).i32Const(95).i32Const(255).call(fnHsvToRgba).localSet(17);
      e.else_().localGet(9).i32Const(115).i32Eq().if_(); // 's'
      e.i32Const(202).localGet(16).i32Const(100).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(85).i32Const(255).call(fnHsvToRgba).localSet(17);
      e.else_().localGet(9).i32Const(118).i32Eq().if_(); // 'v'
      e.i32Const(202).i32Const(75).localGet(16).i32Const(100).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(255).call(fnHsvToRgba).localSet(17);
      e.else_().localGet(9).i32Const(97).i32Eq().if_(); // 'a'
      e.i32Const(202).i32Const(75).i32Const(65);
      e.i32Const(35).localGet(16).i32Const(220).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Add();
      e.call(fnHsvToRgba).localSet(17);
      e.else_().localGet(9).i32Const(114).i32Eq().if_(); // 'r'
      e.i32Const(24).i32Const(24).i32Shl().i32Const(24).i32Const(16).i32Shl().i32Or();
      e.localGet(16).i32Const(255).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(8).i32Shl().i32Or().i32Const(255).i32Or().localSet(17);
      e.else_().localGet(9).i32Const(103).i32Eq().if_(); // 'g'
      e.i32Const(24).i32Const(24).i32Shl();
      e.localGet(16).i32Const(255).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(16).i32Shl().i32Or();
      e.i32Const(24).i32Const(8).i32Shl().i32Or().i32Const(255).i32Or().localSet(17);
      e.else_().localGet(9).i32Const(98).i32Eq().if_(); // 'b'
      e.localGet(16).i32Const(255).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(24).i32Shl();
      e.i32Const(24).i32Const(16).i32Shl().i32Or().i32Const(24).i32Const(8).i32Shl().i32Or().i32Const(255).i32Or().localSet(17);
      e.else_(); // 'x'
      e.i32Const(205).localGet(16).i32Const(90).i32Mul().i32Const(MAX_GRADIENT_STRIP_IDX).i32DivS().i32Const(75).i32Const(255).call(fnHsvToRgba).localSet(17);
      e.end().end().end().end().end().end().end();

      e.localGet(15).localGet(6).i32Const(8).i32Add().localGet(6).i32Const(16).i32Add().localGet(17).i32Const(0);
      e.call(FN_CREATE_OVERLAY_RECT).drop();
      e.localGet(16).i32Const(1).i32Add().localSet(16);
      e.br(0);
    }
    e.end().end();

    // Capture `prevTail = *(parentEnt + 52)` BEFORE calling `CreateSlider` (`func_5196`)!
    // `func_5196` appends `pWhiteLineEnt` FIRST (`line 71`), followed by 5 `TextLabel` entities,
    // followed by `pSliderEnt`. Thus `*(*(prevTail + 4) + 8)` is ALWAYS `pWhiteLineEnt`!
    e.localGet(0).i32Load(52, 2).localSet(22);

    // 5) Create native interactive SliderComponent via CreateSlider (func_5196)
    e.localGet(6).i32Const(36).i32Add().i32Const(VA_SLIDER_BTN_RTTEX).call(FN_STD_STRING_FROM_CSTR).drop();
    e.localGet(0);                              // pBG (parentEnt)
    e.localGet(28);                             // xTrack
    e.localGet(31);                             // yTrack
    e.localGet(29);                             // sizeX (trackW)
    e.localGet(6).i32Const(36).i32Add();        // &"interface/slider_button.rttex"
    e.localGet(6).i32Const(24).i32Add();        // &""
    e.localGet(6).i32Const(24).i32Add();        // &""
    e.localGet(6).i32Const(24).i32Add();        // &""
    e.localGet(13);                             // fontID
    e.localGet(24);                             // fontScale
    e.f32Const(1.0);                            // buttonScale = 1.0f
    e.localGet(6).i32Const(24).i32Add();        // &""
    e.call(FN_CREATE_SLIDER).localSet(18);
    e.freeStdString(6, 36);

    // Completely eliminate CreateSlider's 3px white line (`alpha = 0.0f`, `size2d = (0,0)`, `color = 0`)
    e.localGet(22).if_();
    {
      e.localGet(22).i32Load(4, 2).localSet(23);
      e.localGet(23).i32Const(0).i32Ne();
      e.localGet(23).localGet(0).i32Const(52).i32Add().i32Ne().i32And();
      e.if_();
      {
        e.localGet(23).i32Load(8, 2).localTee(14).if_();
        {
          // alpha = 0.0f (causes RectRenderComponent::OnRender to exit immediately!)
          e.writeInlineSso(6, 60, "alpha");
          e.localGet(14).i32Const(76).i32Add().localGet(6).i32Const(60).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(19);
          e.if_();
          e.localGet(19).f32Const(0.0).f32Store(8, 2);
          e.localGet(19).i32Const(1).i32Store(0, 2);
          e.localGet(19).i32Load(36, 2).localTee(23).if_().localGet(23).localGet(19).call(FN_SIGNAL_FIRE).end();
          e.end();

          // size2d = (0.0f, 0.0f)
          e.writeInlineSso(6, 60, "size2d");
          e.localGet(14).i32Const(76).i32Add().localGet(6).i32Const(60).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(19);
          e.if_();
          e.localGet(19).i64Const(0n).i64Store(8, 2);
          e.localGet(19).i32Const(3).i32Store(0, 2);
          e.localGet(19).i32Load(36, 2).localTee(23).if_().localGet(23).localGet(19).call(FN_SIGNAL_FIRE).end();
          e.end();

          // color = 0
          e.localGet(14).i32Const(76).i32Add().localGet(6).i32Const(72).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(19);
          e.if_();
          e.localGet(19).i32Const(0).i32Store(8, 2);
          e.localGet(19).i32Const(5).i32Store(0, 2);
          e.localGet(19).i32Load(36, 2).localTee(23).if_().localGet(23).localGet(19).call(FN_SIGNAL_FIRE).end();
          e.end();
        }
        e.end();
      }
      e.end();
    }
    e.end();

    // Configure `m_pSliderButton` + `pSliderEnt` ("cslider|<m>|<maxVal>|<name>") and set initial "progress"
    e.localGet(18).if_();
    {
      // Upgrade `m_pSliderButton`: full 1.0x crisp knob scale + `ignoreTouchesOutsideRect = 1`
      e.localGet(18).i32Load(112, 2).localTee(14).if_();
      {
        e.writeInlineSso(6, 60, "scale2d");
        e.localGet(14).i32Const(76).i32Add().localGet(6).i32Const(60).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(19);
        e.if_();
        e.localGet(19).f32Const(1.0).f32Store(8, 2);
        e.localGet(19).f32Const(1.0).f32Store(12, 2);
        e.localGet(19).i32Const(3).i32Store(0, 2);
        e.localGet(19).i32Load(36, 2).localTee(23).if_().localGet(23).localGet(19).call(FN_SIGNAL_FIRE).end();
        e.end();

        e.localGet(6).i32Const(36).i32Add().i32Const(VA_IGNORE_OUTSIDE_RECT).call(FN_STD_STRING_FROM_CSTR).drop();
        e.localGet(14).i32Const(76).i32Add().localGet(6).i32Const(36).i32Add().call(FN_VARIANTDB_GET_VAR).localSet(19);
        e.freeStdString(6, 36);
        e.localGet(19).if_();
        e.localGet(19).i32Const(1).i32Store(8, 2);
        e.localGet(19).i32Const(5).i32Store(0, 2);
        e.localGet(19).i32Load(36, 2).localTee(23).if_().localGet(23).localGet(19).call(FN_SIGNAL_FIRE).end();
        e.end();
      }
      e.end();

      e.localGet(18).i32Load(32, 2).localTee(14).if_();
      {
        // Format "<m>|<maxVal>|" into sp + 96
        e.localGet(6).localGet(9).i32Store8(96);
        e.localGet(6).i32Const(124).i32Store8(97);
        e.i32Const(2).localSet(22);
        e.localGet(11).i32Const(1000).i32GeS().if_();
        e.localGet(6).localGet(22).i32Add().localGet(11).i32Const(1000).i32DivS().i32Const(48).i32Add().i32Store8(96);
        e.localGet(22).i32Const(1).i32Add().localSet(22);
        e.end();
        e.localGet(11).i32Const(100).i32GeS().if_();
        e.localGet(6).localGet(22).i32Add().localGet(11).i32Const(100).i32DivS().i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(96);
        e.localGet(22).i32Const(1).i32Add().localSet(22);
        e.end();
        e.localGet(11).i32Const(10).i32GeS().if_();
        e.localGet(6).localGet(22).i32Add().localGet(11).i32Const(10).i32DivS().i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(96);
        e.localGet(22).i32Const(1).i32Add().localSet(22);
        e.end();
        e.localGet(6).localGet(22).i32Add().localGet(11).i32Const(10).i32RemS().i32Const(48).i32Add().i32Store8(96);
        e.localGet(22).i32Const(1).i32Add().localSet(22);
        e.localGet(6).localGet(22).i32Add().i32Const(124).i32Store8(96);
        e.localGet(22).i32Const(1).i32Add().localSet(22);

        e.writeInlineSso(6, 36, "cslider|");
        e.localGet(6).i32Const(36).i32Add().localGet(6).i32Const(96).i32Add().localGet(22).call(FN_STD_STRING_APPEND).drop();
        e.localGet(6).i32Const(36).i32Add().localGet(20).localGet(21).call(FN_STD_STRING_APPEND).drop();
        e.localGet(14).i32Const(20).i32Add().localGet(6).i32Const(36).i32Add().call(FN_SET_NAME);
        e.freeStdString(6, 36);

        // Set "progress" = f32(val) / f32(maxVal) and fire signal (positions thumb, sets full-bar touchPadding & updates preview)
        e.localGet(18).i32Const(36).i32Add().localGet(6).i32Const(84).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(19);
        e.if_();
        {
          e.localGet(19).localGet(10).f32ConvertI32S().localGet(11).f32ConvertI32S().f32Div().f32Store(8, 2);
          e.localGet(19).i32Const(1).i32Store(0, 2);
          e.localGet(19).i32Load(36, 2).localTee(23).if_();
          e.localGet(23).localGet(19).call(FN_SIGNAL_FIRE);
          e.end();
        }
        e.end();
      }
      e.end();
    }
    e.end();

    // Advance dialog Y cursor
    e.localGet(1).localGet(31).localGet(30).f32Const(0.65).f32Mul().f32Add().f32Const(14.0).f32Add().f32Store(4, 2);

    e.localGet(6).i32Const(FRAME).i32Add().globalSet(0);
    e.i32Const(1).return_();
  }
  e.end();

  e.localGet(0).localGet(1).localGet(2).localGet(3).localGet(4).localGet(5).call(FN_CUSTOM_DIALOG_CMD);

  return e.buildFunctionBody([
    [18, VAL_I32],
    [10, VAL_F32],
  ]);
}

/**
 * Emits `fnOnScrollTouchMove(pScrollComp: i32, pVList: i32) -> ()`
 * Hooks table slot `3771` (`func_4374`).
 * Yields `ScrollComponent` whenever any slider knob (`sliderButton` or `gActiveSliderComp`) owns
 * the pointer, preventing `ScrollComponent` from stealing `m_pEntHandled` after 5px of movement!
 */
function buildFnOnScrollTouchMove(gActiveSliderComp: number): Buffer {
  // Params: 0:pScrollComp, 1:pVList
  // Locals: 2:finger, 3:tracker, 4:handledEnt
  const e = new Emitter();

  e.block(); // yield block -> jumps to reset & return
  {
    // Fast path: active color slider drag in progress
    e.globalGet(gActiveSliderComp).i32Const(0).i32Ne().brIf(0);

    // Also check if `touchTracker[finger].m_pEntHandled` is any `"sliderButton"`
    e.i32Const(0).localSet(2);
    e.localGet(1).if_();
    {
      e.localGet(1).i32Load(80, 2).i32Const(5).i32Eq().if_();
      e.localGet(1).i32Load(88, 2).localSet(2);
      e.end();
    }
    e.end();
    e.localGet(2).i32Const(0).i32LtS().localGet(2).i32Const(11).i32GtS().i32Or().if_();
    e.i32Const(0).localSet(2);
    e.end();

    e.call(FN_GET_BASE_APP).i32Load(1772, 2).localTee(3).if_();
    {
      // touchTracker[finger] is at base + finger * 28 (308 in upstream WASM was the clamp for finger > 11)
      e.localGet(3).localGet(2).i32Const(28).i32Mul().i32Add().localTee(3);
      e.i32Load(20, 2).localTee(4).if_();
      {
        // "sliderButton" -> len == 12, heap SSO (`byte[51] < 0`, `*(ent + 44) == 12`)
        e.localGet(4).i32Load8S(51).i32Const(0).i32LtS().if_();
        {
          e.localGet(4).i32Load(44, 2).i32Const(12).i32Eq().if_();
          {
            e.localGet(4).i32Load(40, 2).i64Load(0, 0).i64Const(asciiI64LE("sliderBu")).i64Xor().i64Eqz().brIf(4);
          }
          e.end();
        }
        e.end();
      }
      e.end();
    }
    e.end();

    // Not dragging a slider -> run standard ScrollComponent::OnTouchMove
    e.localGet(0).localGet(1).call(FN_SCROLL_TOUCH_MOVE);
    e.return_();
  }
  e.end();

  // Reset ScrollComponent drag state so dialog stays completely still while sliding
  e.localGet(0).if_();
  e.localGet(0).i32Const(-1).i32Store(160, 2);
  e.localGet(0).i32Const(0).i32Store8(168);
  e.localGet(0).i64Const(0n).i64Store(172, 2);
  e.end();

  return e.buildFunctionBody([[3, VAL_I32]]);
}

/**
 * Emits `fnOnSliderTouchStart(pSliderComp: i32, pVList: i32) -> ()`
 * Hooks table slot `3856` (`func_4331`).
 * Locks `m_bHandled = 1` + `gActiveSliderComp`, and when clicking anywhere on a `cslider|`
 * gradient bar, immediately snaps the knob right under the cursor!
 */
function buildFnOnSliderTouchStart(gActiveSliderComp: number): Buffer {
  /*
   * Params: 0:pSliderComp, 1:pVList
   * Stack frame = 48 bytes (`sp` = local 2):
   *   sp + 0  .. 11 : strPos2d ("pos2d")
   *   sp + 12 .. 23 : strSize2d ("size2d")
   *   sp + 24 .. 35 : strProgress ("progress")
   *
   * Locals: 2:sp, 3:btn, 4:pEnt, 5:namePtr, 6:nameLen, 7:finger, 8:tracker, 9:pVar, 10:tmp
   *         11:trackW(f32), 12:halfBtnW(f32), 13:newX(f32)
   */
  const FRAME = 48;
  const e = new Emitter();

  // Run stock SliderComponent::OnTouchStart first
  e.localGet(0).localGet(1).call(FN_SLIDER_TOUCH_START);

  e.globalGet(0).i32Const(FRAME).i32Sub().localTee(2).globalSet(0);

  e.block();
  {
    e.localGet(0).i32Eqz().brIf(0);
    e.localGet(0).i32Load8U(124).i32Const(1).i32Ne().brIf(0); // only when dragging started
    e.localGet(0).i32Load(112, 2).localTee(3).i32Eqz().brIf(0); // btn

    // Mark active slider drag and lock touchTracker[finger]
    e.localGet(0).globalSet(gActiveSliderComp);
    e.i32Const(0).localSet(7);
    e.localGet(1).if_();
    {
      e.localGet(1).i32Load(80, 2).i32Const(5).i32Eq().if_();
      e.localGet(1).i32Load(88, 2).localSet(7);
      e.end();
    }
    e.end();
    e.localGet(7).i32Const(0).i32LtS().localGet(7).i32Const(11).i32GtS().i32Or().if_();
    e.i32Const(0).localSet(7);
    e.end();
    e.call(FN_GET_BASE_APP).i32Load(1772, 2).localTee(8).if_();
    {
      // touchTracker[finger] is at base + finger * 28
      e.localGet(8).localGet(7).i32Const(28).i32Mul().i32Add().localTee(8);
      e.i32Const(1).i32Store8(0);
      e.localGet(8).localGet(3).i32Store(20, 2);
    }
    e.end();

    // Check if owner entity is a "cslider|" and pVList arg0 is CL_Vec2f (type 3)
    e.localGet(1).i32Eqz().brIf(0);
    e.localGet(1).i32Load(0, 2).i32Const(3).i32Ne().brIf(0);
    e.localGet(0).i32Load(32, 2).localTee(4).i32Eqz().brIf(0);

    e.localGet(4).i32Load(40, 2).localGet(4).i32Const(40).i32Add();
    e.localGet(4).i32Load8S(51).localTee(10).i32Const(0).i32LtS().select().localSet(5);
    e.localGet(4).i32Load(44, 2).localGet(10).localGet(10).i32Const(0).i32LtS().select().localSet(6);
    e.localGet(6).i32Const(13).i32LtS().brIf(0);
    e.localGet(5).i64Load(0, 0).i64Const(asciiI64LE("cslider|")).i64Xor().i64Eqz().i32Eqz().brIf(0);

    e.localGet(0).i32Load(88, 2).localTee(10).i32Eqz().brIf(0);
    e.localGet(10).f32Load(0, 2).localTee(11).f32Const(1.0).f32Le().brIf(0); // trackW > 1

    e.writeInlineSso(2, 0, "pos2d");
    e.writeInlineSso(2, 12, "size2d");
    e.writeInlineSso(2, 24, "progress");

    // halfBtnW = 0.5f * btn.size2d.x (fallback to 16.0f if unloaded or <= 0)
    e.f32Const(16.0).localSet(12);
    e.localGet(3).i32Const(76).i32Add().localGet(2).i32Const(12).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(9);
    e.if_();
    {
      e.localGet(9).f32Load(8, 2).localSet(13);
      e.localGet(13).f32Const(0.0).f32Gt().if_();
      e.localGet(13).f32Const(0.5).f32Mul().localSet(12);
      e.end();
    }
    e.end();

    // Guard localClickX against NaN, then compute newX = clamp(localClickX - halfBtnW, 0.0f, trackW)
    e.localGet(1).f32Load(8, 2).localSet(13);
    e.localGet(13).localGet(13).f32Eq().i32Eqz().brIf(0);
    e.localGet(13).localGet(12).f32Sub().f32Const(0.0).f32Max().localGet(11).f32Min().localSet(13);

    // Update btn pos2d.x
    e.localGet(3).i32Const(76).i32Add().localGet(2).call(FN_VARIANTDB_GET_VAR).localTee(9).if_();
    {
      e.localGet(9).localGet(13).f32Store(8, 2);
      e.localGet(9).i32Const(3).i32Store(0, 2);
      e.localGet(9).i32Load(36, 2).localTee(10).if_().localGet(10).localGet(9).call(FN_SIGNAL_FIRE).end();
    }
    e.end();

    // Update SliderComponent "progress" = newX / trackW (fires OnProgressChanged -> updates readout, touchPadding & theme!)
    e.localGet(0).i32Const(36).i32Add().localGet(2).i32Const(24).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(9).if_();
    {
      e.localGet(9).localGet(13).localGet(11).f32Div().f32Store(8, 2);
      e.localGet(9).i32Const(1).i32Store(0, 2);
      e.localGet(9).i32Load(36, 2).localTee(10).if_().localGet(10).localGet(9).call(FN_SIGNAL_FIRE).end();
    }
    e.end();
  }
  e.end();

  e.localGet(2).i32Const(FRAME).i32Add().globalSet(0);
  return e.buildFunctionBody([
    [9, VAL_I32],
    [3, VAL_F32],
  ]);
}

/**
 * Emits `fnOnSliderTouchEnd(pSliderComp: i32, pVList: i32) -> ()`
 * Hooks table slot `3855` (`func_4332`).
 */
function buildFnOnSliderTouchEnd(gActiveSliderComp: number): Buffer {
  const e = new Emitter();
  e.globalGet(gActiveSliderComp).localGet(0).i32Eq().if_();
  e.i32Const(0).globalSet(gActiveSliderComp);
  e.end();
  e.localGet(0).localGet(1).call(FN_SLIDER_TOUCH_END);
  return e.buildFunctionBody([]);
}

/**
 * Emits `fnOnSliderInput(pSliderComp: i32, pVList: i32) -> ()`
 * Hooks table slot `3853` (`func_4335`).
 * Keeps `m_pEntHandled` locked during `cslider|` drags, eliminates overshoot cursor desync on
 * `CLICK_MOVE` (`msg == 2`), and cleanly releases drag state on `CLICK_END` (`msg == 1`) even if
 * the mouse was released outside the knob/dialog!
 */
function buildFnOnSliderInput(gActiveSliderComp: number): Buffer {
  /*
   * Params: 0:pSliderComp, 1:pVList
   * Stack frame = 16 bytes (`sp` = local 2):
   *   sp + 0 .. 11 : strPos2d ("pos2d")
   *
   * Locals: 2:sp, 3:msg, 4:btn, 5:pEnt, 6:namePtr, 7:nameLen, 8:tracker, 9:posVar, 10:tmp
   *         11:oldKnobX(f32), 12:oldLastTouchX(f32), 13:newKnobX(f32), 14:msgF(f32)
   */
  const FRAME = 16;
  const e = new Emitter();

  e.globalGet(0).i32Const(FRAME).i32Sub().localTee(2).globalSet(0);

  e.block(); // fallback block -> delegates directly to FN_SLIDER_ON_INPUT
  {
    e.localGet(0).i32Eqz().brIf(0);
    e.localGet(1).i32Eqz().brIf(0);

    // Check if owner entity is a "cslider|"
    e.localGet(0).i32Load(32, 2).localTee(5).i32Eqz().brIf(0);
    e.localGet(5).i32Load(40, 2).localGet(5).i32Const(40).i32Add();
    e.localGet(5).i32Load8S(51).localTee(10).i32Const(0).i32LtS().select().localSet(6);
    e.localGet(5).i32Load(44, 2).localGet(10).localGet(10).i32Const(0).i32LtS().select().localSet(7);
    e.localGet(7).i32Const(13).i32LtS().brIf(0);
    e.localGet(6).i64Load(0, 0).i64Const(asciiI64LE("cslider|")).i64Xor().i64Eqz().i32Eqz().brIf(0);

    // Only intercept when actively dragging this slider
    e.localGet(0).i32Load8U(124).i32Const(1).i32Ne().brIf(0);
    e.localGet(0).i32Load(112, 2).localTee(4).i32Eqz().brIf(0);

    // Decode msg (0 = CLICK_START, 1 = CLICK_END, 2 = CLICK_MOVE)
    e.i32Const(-1).localSet(3);
    e.localGet(1).i32Load(0, 2).i32Const(1).i32Eq().if_();
    {
      e.localGet(1).f32Load(8, 2).localTee(14);
      e.f32Const(0.0).f32Ge();
      e.localGet(14).f32Const(10.0).f32Le().i32And();
      e.if_();
      e.localGet(14).i32TruncF32S().localSet(3);
      e.end();
    }
    e.end();

    // Ensure touchTracker[finger] stays locked on `btn` so `func_4335` never drops the drag
    e.i32Const(0).localSet(8);
    e.i32Const(0).localSet(10); // finger = 0 default
    e.localGet(1).i32Load(80, 2).i32Const(5).i32Eq().if_();
    e.localGet(1).i32Load(88, 2).localSet(10);
    e.end();
    e.localGet(10).i32Const(0).i32LtS().localGet(10).i32Const(11).i32GtS().i32Or().if_();
    e.i32Const(0).localSet(10);
    e.end();
    e.call(FN_GET_BASE_APP).i32Load(1772, 2).localTee(8).if_();
    {
      e.localGet(8).localGet(10).i32Const(28).i32Mul().i32Add().localTee(8);
      e.i32Const(1).i32Store8(0);
      e.localGet(8).localGet(4).i32Store(20, 2);
    }
    e.end();

    e.writeInlineSso(2, 0, "pos2d");
    e.localGet(4).i32Const(76).i32Add().localGet(2).call(FN_VARIANTDB_GET_VAR).localTee(9).i32Eqz().brIf(0);
    e.localGet(9).f32Load(8, 2).localSet(11); // oldKnobX
    e.localGet(0).f32Load(116, 2).localSet(12); // oldLastTouchX

    // Execute stock SliderComponent::OnInput
    e.localGet(0).localGet(1).call(FN_SLIDER_ON_INPUT);

    // On CLICK_MOVE (msg == 2): clamp m_lastTouchX to virtual bar anchor so cursor overshoot never desyncs!
    e.localGet(3).i32Const(2).i32Eq().if_();
    {
      e.localGet(9).f32Load(8, 2).localSet(13); // newKnobX
      e.localGet(0).localGet(12).localGet(13).localGet(11).f32Sub().f32Add().f32Store(116, 2);
    }
    e.end();

    // On CLICK_END (msg == 1): always release drag cleanly even if cursor left the knob/dialog!
    e.localGet(3).i32Const(1).i32Eq().if_();
    {
      e.localGet(0).i32Const(0).i32Store8(124);
      e.globalGet(gActiveSliderComp).localGet(0).i32Eq().if_();
      e.i32Const(0).globalSet(gActiveSliderComp);
      e.end();
      e.localGet(8).if_();
      {
        e.localGet(8).i32Load(20, 2).localGet(4).i32Eq().if_();
        e.localGet(8).i32Const(0).i32Store8(0);
        e.localGet(8).i32Const(0).i32Store(20, 2);
        e.end();
      }
      e.end();
    }
    e.end();

    e.localGet(2).i32Const(FRAME).i32Add().globalSet(0);
    e.return_();
  }
  e.end();

  e.localGet(0).localGet(1).call(FN_SLIDER_ON_INPUT);
  e.localGet(2).i32Const(FRAME).i32Add().globalSet(0);

  return e.buildFunctionBody([
    [9, VAL_I32],
    [4, VAL_F32],
  ]);
}

/**
 * Emits `fnAppendColorSlidersToPacket(packetStrPtr: i32, entsBegin: i32, entsEnd: i32) -> ()`
 * Appends `<name>|<intVal>\n` for every `cslider|<m>|<max>|<name>` entity in the dialog.
 */
function buildFnAppendColorSlidersToPacket(fnFormatSliderValue: number): Buffer {
  const FRAME = 64;
  const e = new Emitter();

  e.globalGet(0).i32Const(FRAME).i32Sub().localTee(3).globalSet(0);
  e.writeInlineSso(3, 0, "Slider");
  e.writeInlineSso(3, 12, "progress");

  e.block().loop();
  {
    e.localGet(1).localGet(2).i32Eq().brIf(1);
    e.localGet(1).i32Load(0, 2).localTee(4).if_();
    {
      e.localGet(4).i32Load(40, 2).localGet(4).i32Const(40).i32Add();
      e.localGet(4).i32Load8S(51).localTee(15).i32Const(0).i32LtS().select().localSet(5);
      e.localGet(4).i32Load(44, 2).localGet(15).localGet(15).i32Const(0).i32LtS().select().localSet(6);

      e.block();
      {
        e.localGet(6).i32Const(13).i32LtS().brIf(0);
        e.localGet(5).i64Load(0, 0).i64Const(asciiI64LE("cslider|")).i64Xor().i64Eqz().i32Eqz().brIf(0);
        e.localGet(5).i32Load8U(9).i32Const(124).i32Ne().brIf(0);
        e.localGet(5).i32Load8U(8).localSet(7);

        e.i32Const(0).localSet(8);
        e.i32Const(10).localSet(9);
        e.block().loop();
        {
          e.localGet(9).localGet(6).i32GeS().brIf(1);
          e.localGet(5).localGet(9).i32Add().i32Load8U(0).localTee(15);
          e.i32Const(124).i32Eq().if_();
          e.localGet(9).i32Const(1).i32Add().localSet(9);
          e.br(2);
          e.end();
          e.localGet(8).i32Const(10).i32Mul().localGet(15).i32Const(48).i32Sub().i32Add().localSet(8);
          e.localGet(9).i32Const(1).i32Add().localSet(9);
          e.br(0);
        }
        e.end().end();
        e.localGet(8).i32Const(0).i32LeS().if_().i32Const(100).localSet(8).end();
        e.localGet(6).localGet(9).i32Sub().i32Const(0).i32LeS().brIf(0);

        e.localGet(4).localGet(3).i32Const(0).call(FN_GET_COMPONENT_BY_NAME).localTee(10).i32Eqz().brIf(0);
        e.localGet(10).i32Const(36).i32Add().localGet(3).i32Const(12).i32Add().call(FN_VARIANTDB_GET_VAR).localTee(11).i32Eqz().brIf(0);

        e.localGet(11).f32Load(8, 2).f32Const(0.0).f32Max().f32Const(1.0).f32Min();
        e.localGet(8).f32ConvertI32S().f32Mul().f32Const(0.5).f32Add().i32TruncF32S();
        e.clampI32Local(15, 0, 8).localSet(12);

        e.localGet(3).i32Const(24).i32Add().localGet(12).localGet(7).i32Const(0).call(fnFormatSliderValue);
        e.localGet(3).i32Load8U(35).localSet(13);

        e.localGet(0).localGet(5).localGet(9).i32Add().localGet(6).localGet(9).i32Sub().call(FN_STD_STRING_APPEND).drop();

        e.localGet(3).i32Const(124).i32Store8(36);
        e.i32Const(0).localSet(14);
        e.block().loop();
        {
          e.localGet(14).localGet(13).i32GeS().brIf(1);
          e.localGet(3).localGet(14).i32Add().localGet(3).localGet(14).i32Add().i32Load8U(24).i32Store8(37);
          e.localGet(14).i32Const(1).i32Add().localSet(14);
          e.br(0);
        }
        e.end().end();
        e.localGet(3).localGet(13).i32Add().i32Const(10).i32Store8(37);
        e.localGet(0).localGet(3).i32Const(36).i32Add().localGet(13).i32Const(2).i32Add().call(FN_STD_STRING_APPEND).drop();
      }
      e.end();
    }
    e.end();
    e.localGet(1).i32Const(4).i32Add().localSet(1);
    e.br(0);
  }
  e.end().end();

  e.localGet(3).i32Const(FRAME).i32Add().globalSet(0);
  return e.buildFunctionBody([[13, VAL_I32]]);
}

function patchElementTableSlots(
  sec9: Uint8Array,
  replacements: Array<{ slot: number; expectedFn: number; replacementFn: number }>
): Buffer {
  let p = 0;
  const [segCount, p1] = readUleb(sec9, p);
  p = p1;
  if (segCount !== 1) throw new Error(`Unexpected WASM element segment count: ${segCount}`);
  const [flags, p2] = readUleb(sec9, p);
  p = p2;
  if (flags !== 0 || sec9[p++] !== 0x41) throw new Error("Unexpected WASM element segment header");
  const [offset, p3] = readUleb(sec9, p);
  p = p3;
  if (sec9[p++] !== 0x0b) throw new Error("Missing end opcode in WASM element offset expr");
  const headerEnd = p;
  const [elemCount, p4] = readUleb(sec9, p);
  p = p4;

  const entries: number[] = [];
  for (let i = 0; i < elemCount; i++) {
    const [fnIdx, next] = readUleb(sec9, p);
    p = next;
    entries.push(fnIdx);
  }

  for (const { slot, expectedFn, replacementFn } of replacements) {
    const idx = slot - offset;
    if (idx < 0 || idx >= entries.length || entries[idx] !== expectedFn) {
      throw new Error(
        `Element table slot ${slot} mismatch: expected func_${expectedFn}, got func_${entries[idx]}`
      );
    }
    entries[idx] = replacementFn;
  }

  const encodedEntries = entries.flatMap(fn => writeUleb(fn));
  return Buffer.concat([
    Buffer.from(sec9.subarray(0, headerEnd)),
    Buffer.from(writeUleb(entries.length)),
    Buffer.from(encodedEntries),
  ]);
}

function isSlotAlreadyPatched(sec9: Uint8Array, slot: number, unpatchedFn: number): boolean {
  let p = 0;
  const [segCount, p1] = readUleb(sec9, p);
  p = p1;
  if (segCount !== 1) return false;
  const [flags, p2] = readUleb(sec9, p);
  p = p2;
  if (flags !== 0 || sec9[p++] !== 0x41) return false;
  const [offset, p3] = readUleb(sec9, p);
  p = p3;
  if (sec9[p++] !== 0x0b) return false;
  const [elemCount, p4] = readUleb(sec9, p);
  p = p4;
  const idx = slot - offset;
  if (idx < 0 || idx >= elemCount) return false;
  for (let i = 0; i <= idx; i++) {
    const [fnIdx, next] = readUleb(sec9, p);
    p = next;
    if (i === idx) return fnIdx !== unpatchedFn;
  }
  return false;
}

export function patchColorSliderDialog(wasmBytes: Uint8Array): Uint8Array {
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
  const sec6 = sections.find(s => s.id === 6);
  const sec9 = sections.find(s => s.id === 9);
  const sec10 = sections.find(s => s.id === 10);
  if (!sec1 || !sec2 || !sec3 || !sec6 || !sec9 || !sec10) {
    throw new Error("Missing required WASM sections for color slider patch");
  }

  // Idempotent guard keyed on indirect table slot 2310 (works even after upstream patchers append functions)
  if (isSlotAlreadyPatched(sec9.data, TBL_SLOT_CUSTOM_DIALOG_CMD, FN_CUSTOM_DIALOG_CMD)) {
    return buf;
  }

  const { funcImports: numImports, globalImports } = countImports(sec2.data);
  const [funcCount, fp1] = readUleb(sec3.data, 0);

  // Append 1 mutable i32 global (`gActiveSliderComp`) to track active slider drags without heap/address assumptions
  const addedGlobal = appendMutableI32Global(sec6.data, globalImports);
  sec6.data = addedGlobal.data;
  const gActiveSliderComp = addedGlobal.globalIdx;

  // Ensure function types for our 9 appended functions
  let tSec = sec1.data;
  const tHsv = ensureFuncType(tSec, [VAL_I32, VAL_I32, VAL_I32, VAL_I32], [VAL_I32]);
  tSec = tHsv.data;
  const tFmt = ensureFuncType(tSec, [VAL_I32, VAL_I32, VAL_I32, VAL_I32], []);
  tSec = tFmt.data;
  const tOnProg = ensureFuncType(tSec, [VAL_I32], []);
  tSec = tOnProg.data;
  const tHandleCmd = ensureFuncType(
    tSec,
    [VAL_I32, VAL_I32, VAL_I32, VAL_I32, VAL_I32, VAL_I32],
    [VAL_I32]
  );
  tSec = tHandleCmd.data;
  const tAppend = ensureFuncType(tSec, [VAL_I32, VAL_I32, VAL_I32], []);
  tSec = tAppend.data;
  const tTwoI32Void = ensureFuncType(tSec, [VAL_I32, VAL_I32], []);
  sec1.data = tTwoI32Void.data;

  // Reserve 9 new function indices
  const fnHsvToRgba = numImports + funcCount;
  const fnFormatSliderValue = fnHsvToRgba + 1;
  const fnOnSliderProgressChanged = fnHsvToRgba + 2;
  const fnHandleColorSliderDialog = fnHsvToRgba + 3;
  const fnAppendColorSlidersToPacket = fnHsvToRgba + 4;
  const fnOnScrollTouchMove = fnHsvToRgba + 5;
  const fnOnSliderTouchStart = fnHsvToRgba + 6;
  const fnOnSliderTouchEnd = fnHsvToRgba + 7;
  const fnOnSliderInput = fnHsvToRgba + 8;

  sec3.data = Buffer.concat([
    Buffer.from(writeUleb(funcCount + 9)),
    Buffer.from(sec3.data.subarray(fp1)),
    Buffer.from([
      ...writeUleb(tHsv.typeIdx),
      ...writeUleb(tFmt.typeIdx),
      ...writeUleb(tOnProg.typeIdx),
      ...writeUleb(tHandleCmd.typeIdx),
      ...writeUleb(tAppend.typeIdx),
      ...writeUleb(tTwoI32Void.typeIdx),
      ...writeUleb(tTwoI32Void.typeIdx),
      ...writeUleb(tTwoI32Void.typeIdx),
      ...writeUleb(tTwoI32Void.typeIdx),
    ]),
  ]);

  // Redirect indirect table slots for dialog builder + smooth slider/scroll input hooks
  sec9.data = patchElementTableSlots(sec9.data, [
    {
      slot: TBL_SLOT_CUSTOM_DIALOG_CMD,
      expectedFn: FN_CUSTOM_DIALOG_CMD,
      replacementFn: fnHandleColorSliderDialog,
    },
    {
      slot: TBL_SLOT_SCROLL_TOUCH_MOVE,
      expectedFn: FN_SCROLL_TOUCH_MOVE,
      replacementFn: fnOnScrollTouchMove,
    },
    {
      slot: TBL_SLOT_SLIDER_TOUCH_START,
      expectedFn: FN_SLIDER_TOUCH_START,
      replacementFn: fnOnSliderTouchStart,
    },
    {
      slot: TBL_SLOT_SLIDER_TOUCH_END,
      expectedFn: FN_SLIDER_TOUCH_END,
      replacementFn: fnOnSliderTouchEnd,
    },
    {
      slot: TBL_SLOT_SLIDER_ON_INPUT,
      expectedFn: FN_SLIDER_ON_INPUT,
      replacementFn: fnOnSliderInput,
    },
  ]);

  // Parse Code section (sec10)
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

  // 1) No-op func_5173 (active Lua script watermark renderer)
  bodies[FN_WATERMARK_RENDER - numImports] = Buffer.from([0x00, 0x0b]);

  // 2) Extend func_4334 (SliderComponent::OnProgressChanged) to call fnOnSliderProgressChanged
  const expected4334 = Buffer.from([0x00, 0x20, 0x00, 0x10, ...writeUleb(FN_SLIDER_UPDATE_THUMB), 0x0b]);
  const cur4334 = bodies[FN_SLIDER_ON_PROGRESS - numImports];
  if (!cur4334.equals(expected4334)) {
    throw new Error(`Unexpected func_4334 body: ${cur4334.toString("hex")}`);
  }
  bodies[FN_SLIDER_ON_PROGRESS - numImports] = Buffer.from([
    0x00,
    0x20, 0x00, 0x10, ...writeUleb(FN_SLIDER_UPDATE_THUMB),
    0x20, 0x00, 0x10, ...writeUleb(fnOnSliderProgressChanged),
    0x0b,
  ]);

  // 3) Inject fnAppendColorSlidersToPacket into func_1770 (DialogButtonClicked)
  const body1770 = bodies[FN_DIALOG_BUTTON_CLICKED - numImports];
  const needle1770 = Buffer.from("044020012802900510b4020b41002104024002400240", "hex");
  const hit1770 = body1770.indexOf(needle1770);
  if (hit1770 === -1 || body1770.indexOf(needle1770, hit1770 + 1) !== -1) {
    throw new Error("Unique injection site in func_1770 (DialogButtonClicked) not found");
  }
  const injectCall = Buffer.from([
    0x20, 0x01, 0x41, ...writeSleb32(680), 0x6a,       // local.get 1 + 680 (&packetStr)
    0x20, 0x01, 0x28, 0x02, ...writeUleb(692),         // *(local.get 1 + 692) (entsBegin)
    0x20, 0x01, 0x28, 0x02, ...writeUleb(696),         // *(local.get 1 + 696) (entsEnd)
    0x10, ...writeUleb(fnAppendColorSlidersToPacket),  // call fnAppendColorSlidersToPacket
  ]);
  const splitAt = hit1770 + 12;
  bodies[FN_DIALOG_BUTTON_CLICKED - numImports] = Buffer.concat([
    body1770.subarray(0, splitAt),
    injectCall,
    body1770.subarray(splitAt),
  ]);

  // 4) Append our 9 native helper/handler functions
  bodies.push(
    buildFnHsvToRgba(),
    buildFnFormatSliderValue(),
    buildFnOnSliderProgressChanged(fnHsvToRgba, fnFormatSliderValue),
    buildFnHandleColorSliderDialog(fnHsvToRgba, fnFormatSliderValue, gActiveSliderComp),
    buildFnAppendColorSlidersToPacket(fnFormatSliderValue),
    buildFnOnScrollTouchMove(gActiveSliderComp),
    buildFnOnSliderTouchStart(gActiveSliderComp),
    buildFnOnSliderTouchEnd(gActiveSliderComp),
    buildFnOnSliderInput(gActiveSliderComp)
  );

  // Re-encode Code section (sec10)
  const codeChunks: Buffer[] = [Buffer.from(writeUleb(bodies.length))];
  for (const b of bodies) {
    codeChunks.push(Buffer.from(writeUleb(b.length)), b);
  }
  sec10.data = Buffer.concat(codeChunks);

  // Reassemble full WASM binary
  const outChunks: Buffer[] = [Buffer.from(buf.subarray(0, 8))];
  for (const s of sections) {
    outChunks.push(Buffer.from([s.id, ...writeUleb(s.data.length)]), Buffer.from(s.data));
  }
  return Buffer.concat(outChunks);
}
