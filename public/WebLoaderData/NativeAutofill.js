// Native Growtopia console autofill: no HTML UI, no custom panels.
//
// The client already ships a native AutoFill component that renders the exact
// dropdown from the original game (list, gold selection, "F1"/"F2"/TAB hint
// box). Its candidate list lives in a C++ std::vector<Record> at a fixed
// address in this pinned build. We only append item names to that vector so
// `/give 333 1 Indo` completes item names, and we switch the native option on.
//
// Record layout (verified against the pinned client): 3 x std::string (12 bytes
// each) + int32, 40 bytes per element.
(function (global) {
  'use strict';
  var pref = 'magnolia_native_autofill_v2';
  // Verified against the pinned ReGrowtopia 1.50 client.
  var VEC_BEGIN = 393436;
  var VEC_END = 393440;
  var VEC_CAP = 393444;
  var REC_SIZE = 40;
  var ENABLE_FLAG = 369787;
  var APP_PTR = 393364;

  function enabled() {
    try { return global.localStorage.getItem(pref) !== '0'; } catch (_) { return true; }
  }
  function setEnabled(value) {
    try { global.localStorage.setItem(pref, value ? '1' : '0'); } catch (_) {}
    if (applyOption(!!value)) optionApplied = true;
  }

  var names = null;
  var fetching = false;
  var fetchFailedAt = 0;
  var injectedBlock = 0;
  var injectedEnd = 0;
  var optionApplied = false;
  var disabledAfterError = false;

  function sdk() { return global.GameSDK && global.GameSDK.ready ? global.GameSDK : null; }
  function memoryReady() {
    var m = global.Module;
    return !!(m && m.HEAPU8 && m.HEAPU32 && m.wasmTable && typeof m.wasmTable.get === 'function');
  }

  function fetchNames() {
    if (names || fetching) return;
    if (fetchFailedAt && Date.now() - fetchFailedAt < 15000) return;
    fetching = true;
    var url = '/api/autofill-items';
    var hash = global.SERVER_ITEMS_HASH;
    if (hash !== undefined) url += '?v=' + encodeURIComponent(hash);
    global.fetch(url, { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        if (!text) return;
        var list = text.split('\n');
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var name = list[i].trim();
          if (name) out.push(name);
        }
        if (out.length) names = out;
        fetchFailedAt = out.length ? 0 : Date.now();
      })
      .catch(function () { fetchFailedAt = Date.now(); })
      .then(function () { fetching = false; });
  }

  // Switch the native AutoFill option on/off; this is the same flag the
  // in-game Options checkbox writes, so both stay in sync.
  function applyOption(on) {
    try {
      var m = global.Module, g = sdk();
      if (!m || !g) return false;
      m.HEAPU8[ENABLE_FLAG] = on ? 1 : 0;
      var abi = g._abi, s = abi.ensureScratch() + 320;
      abi.writeStdString(s, 'enableAutoFill');
      var app = m.HEAPU32[APP_PTR >> 2];
      var v = app ? m.wasmTable.get(623)(app, s) : 0;
      abi.freeStdString(s);
      if (v) {
        m.HEAPU32[v >> 2] = 5; // TYPE_UINT32
        m.HEAPU32[(v + 8) >> 2] = on ? 1 : 0;
        var sig = m.HEAPU32[(v + 36) >> 2];
        if (sig) m.wasmTable.get(536)(sig, v);
      }
      return true;
    } catch (_) { return false; }
  }

  function writeRecord(m, abi, rec, name) {
    // Hard bounds check: writing past the current heap aborts the whole WASM
    // instance, which used to kill the menu while it was still being built.
    if (!(rec > 0) || rec + REC_SIZE > m.HEAPU8.length) throw new Error("autofill record out of bounds");
    // A freshly operator-new'ed record holds uninitialised bytes. writeStdString
    // reads the "long string" flag at +11 and, when it is set, tries to free the
    // pointer stored at +0 - freeing a garbage pointer is exactly the
    // "memory access out of bounds" abort. Zero the slot first.
    m.HEAPU8.fill(0, rec, rec + REC_SIZE);
    abi.writeStdString(rec, name);
    abi.writeStdString(rec + 12, '');
    abi.writeStdString(rec + 24, '');
    m.HEAPU32[(rec + 36) >> 2] = 0;
  }

  function appendItems(startPtr) {
    var m = global.Module;
    var abi = sdk()._abi;
    var rec = startPtr;
    for (var i = 0; i < names.length; i++) {
      writeRecord(m, abi, rec, names[i]);
      rec += REC_SIZE;
    }
    return rec;
  }

  function inject() {
    if (!names || !names.length || !memoryReady()) return false;
    var m = global.Module;
    var u32 = m.HEAPU32;
    var beg = u32[VEC_BEGIN >> 2] >>> 0;
    var end = u32[VEC_END >> 2] >>> 0;
    var cap = u32[VEC_CAP >> 2] >>> 0;
    if (!beg || end < beg) return false;
    var baseCount = (end - beg) / REC_SIZE;
    if (baseCount < 1) return false; // native command list not loaded yet
    if (beg === injectedBlock && end === injectedEnd) return true;

    var need = names.length * REC_SIZE;
    // The client may clear and re-parse its own list in place; reuse the block.
    if (beg === injectedBlock && cap >= end + need) {
      var stop = appendItems(end);
      m.HEAPU32[VEC_END >> 2] = stop;
      injectedEnd = stop;
      return true;
    }

    var capacity = baseCount + names.length + 64;
    var block = m.wasmTable.get(117)(capacity * REC_SIZE); // operator new
    if (!block) return false;
    if (block + capacity * REC_SIZE > m.HEAPU8.length) return false;
    // Never hand the client an uninitialised block: a stale "long string" flag
    // inside it makes writeStdString free a garbage pointer and abort the WASM
    // instance. Zero first, then copy the native entries in.
    m.HEAPU8.fill(0, block, block + capacity * REC_SIZE);
    m.HEAPU8.copyWithin(block, beg, end);
    var stopPtr = appendItems(block + baseCount * REC_SIZE);
    u32 = m.HEAPU32;
    u32[VEC_BEGIN >> 2] = block;
    u32[VEC_END >> 2] = stopPtr;
    u32[VEC_CAP >> 2] = block + capacity * REC_SIZE;
    injectedBlock = block;
    injectedEnd = stopPtr;
    return true;
  }

  function tick() {
    if (disabledAfterError) return;
    try {
      var g = sdk();
      if (!g) return;
      if (!optionApplied) optionApplied = applyOption(enabled());
      if (!enabled()) return;
      fetchNames();
      if (!names) return;
      inject();
    } catch (err) {
      // Never let the autofill helper take the client down with it.
      disabledAfterError = true;
      injectedBlock = 0;
      injectedEnd = 0;
      console.warn("[Autofill] disabled after error:", err && err.message ? err.message : err);
    }
  }

  global.NativeAutofill = {
    enabled: enabled,
    setEnabled: setEnabled,
    isReady: function () { return !!(names && injectedEnd && injectedBlock); },
    _injectNow: function () { return inject(); }
  };

  global.setInterval(tick, 700);
})(globalThis);
