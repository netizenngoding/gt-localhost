// Real C++ RmlUi (compiled via Emscripten to WASM) runtime for Growtopia HUD/Dialogs.
// Wraps rmlui_wasm.js and overlays WebGL2-rendered RmlUi documents on top of the game canvas.
import rmluiModule from './rmlui/rmlui_wasm.js';

const RMLUI_CANVAS_ID = '__rmlui_gl_canvas__';

// Minimal DOM keyCode -> Rml::Input::KeyIdentifier mapping for text inputs & navigation
function domKeyToRmlKey(ev) {
  const k = ev.key;
  if (k === 'Backspace') return 66;     // KI_BACK
  if (k === 'Tab') return 67;           // KI_TAB
  if (k === 'Enter') return 70;         // KI_RETURN
  if (k === 'Escape') return 76;        // KI_ESCAPE
  if (k === ' ') return 1;              // KI_SPACE
  if (k === 'PageUp') return 79;        // KI_PRIOR
  if (k === 'PageDown') return 80;      // KI_NEXT
  if (k === 'End') return 81;           // KI_END
  if (k === 'Home') return 82;          // KI_HOME
  if (k === 'ArrowLeft') return 83;     // KI_LEFT
  if (k === 'ArrowUp') return 84;       // KI_UP
  if (k === 'ArrowRight') return 85;    // KI_RIGHT
  if (k === 'ArrowDown') return 86;     // KI_DOWN
  if (k === 'Delete') return 93;        // KI_DELETE
  const code = ev.keyCode || 0;
  if (code >= 48 && code <= 57) return 2 + (code - 48);   // KI_0..KI_9 (2..11)
  if (code >= 65 && code <= 90) return 12 + (code - 65);  // KI_A..KI_Z (12..37)
  return 0;
}

function domModifiersToRml(ev) {
  let m = 0;
  if (ev.ctrlKey) m |= 1;
  if (ev.shiftKey) m |= 2;
  if (ev.altKey) m |= 4;
  if (ev.metaKey) m |= 8;
  return m;
}

export class RmlUiNative {
  constructor() {
    this.ready = false;
    this.initPromise = null;
    this.mod = null;
    this.canvas = null;
    this.gl = null;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.docs = new Map();        // path -> handle
    this.modalDocs = new Set();   // modal doc handles
    this.hudDocs = new Set();     // non-modal HUD doc handles
    this.docHandlers = new Map(); // docHandle -> { models, onEvent, isModal, visible }
    this.virtualFiles = new Map(); // virtual path -> Uint8Array
    this._fetchCache = new Map();  // path -> Uint8Array (game VFS resources)
    this._missingPaths = new Set();
    this._failedPaths = new Set();
    this._mountQueue = Promise.resolve();
    this._spritePreload = null;
    this.clientWasmExports = null;
    this.soundMuted = false;
    this._lastFrameAt = 0;
    this._frameInterval = 16;
    this._needsRender = true;
    this._canvasVisible = true;
    this._coarsePointer = false;
    this._rafActive = false;

    this._onFrame = this._onFrame.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onWindowMouseMove = this._onWindowMouseMove.bind(this);
    this._onWindowMouseDown = this._onWindowMouseDown.bind(this);
    this._onWindowMouseUp = this._onWindowMouseUp.bind(this);
    this._onWindowWheel = this._onWindowWheel.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
  }

  init(clientWasmExports) {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit(clientWasmExports);
    return this.initPromise;
  }

  async _doInit(clientWasmExports) {
    if (!clientWasmExports && typeof window !== 'undefined') {
      if (window.NativeChatHeads && typeof window.NativeChatHeads.wasmExports === 'function') {
        clientWasmExports = window.NativeChatHeads.wasmExports();
      } else if (window.__RML_WASM_EXPORTS) {
        clientWasmExports = window.__RML_WASM_EXPORTS;
      }
    }
    this.clientWasmExports = clientWasmExports;

    let canvas = document.getElementById(RMLUI_CANVAS_ID);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = RMLUI_CANVAS_ID;
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '10025';
      document.body.appendChild(canvas);
    }
    this.canvas = canvas;
    this._canvasVisible = false;
    canvas.style.display = 'none';
    try { this._coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_e) {}
    this._resize();

    const glAttribs = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      majorVersion: 2,
      minorVersion: 0,
    };

    const Module = {
      canvas,
      locateFile: (path) => {
        if (path.endsWith('.wasm')) return new URL('./rmlui/' + path, import.meta.url).href;
        return path;
      },
      print: (...a) => console.log('[RmlUi]', ...a),
      printErr: (...a) => console.warn('[RmlUi]', ...a),
    };

    this.mod = await rmluiModule(Module);

    const ctxHandle = this.mod.GL.createContext(canvas, glAttribs);
    if (!ctxHandle) throw new Error('Failed to create WebGL2 context for RmlUi');
    this.ctxHandle = ctxHandle;
    this.mod.GL.makeContextCurrent(ctxHandle);
    const ctxObj = this.mod.GL.getContext(ctxHandle);
    this.gl = ctxObj && ctxObj.GLctx;
    if (!this.gl) throw new Error('RmlUi GL context is null');

    const fetchFnPtr = this.mod.addFunction(this._fetchCb.bind(this), 'iiii');
    this.mod._rml_set_fetch_callback(fetchFnPtr);

    const eventFnPtr = this.mod.addFunction(this._onNativeUiEvent.bind(this), 'viii');
    this.mod._rml_set_event_callback(eventFnPtr);

    const clickFnPtr = this.mod.addFunction(() => {
      if (this.soundMuted) return;
      try {
        const ex = this.clientWasmExports ||
          (window.NativeChatHeads && window.NativeChatHeads.wasmExports && window.NativeChatHeads.wasmExports()) ||
          window.__RML_WASM_EXPORTS;
        if (ex && typeof ex.rmlPlayClickSound === 'function') {
          ex.rmlPlayClickSound();
          return;
        }
        if (typeof window.playNativeVfsSfx === 'function') {
          const fsApi = (typeof window.FS !== 'undefined' && window.FS) || (window.Module && window.Module.FS);
          let played = false;
          if (fsApi && typeof fsApi.stat === 'function') {
            for (const p of ['/audio/click.wav', '/audio/switch.wav']) {
              try {
                fsApi.stat(p);
                window.playNativeVfsSfx(p);
                played = true;
                break;
              } catch (_) {}
            }
          }
          if (!played) window.playNativeVfsSfx('/audio/switch.wav');
        }
      } catch (e) { console.warn('[RmlUi] click sound err', e); }
    }, 'v');
    this.mod._rml_set_click_sound_callback(clickFnPtr);

    // _rml_init loads fonts synchronously through _fetchCb, before the UI
    // manifest is available. Prime this one required file asynchronously first.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/branding/CenturyGothicBold.ttf', { signal: controller.signal });
        if (response.ok) {
          const font = new Uint8Array(await response.arrayBuffer());
          this._fetchCache.set('fonts/CenturyGothicBold.ttf', font);
        }
      } finally { clearTimeout(timer); }
    } catch (err) { console.warn('[RmlUi] Font preload failed', err); }

    const okInit = this.mod._rml_init();
    if (!okInit) throw new Error('RmlUi init failed');
    this.mod._rml_init_gl();

    this._resize();
    const namePtr = this._allocCString('gt');
    this.mod._rml_create_context(namePtr, this.w, this.h);
    this.mod._rml_free(namePtr);
    this._syncDpRatio();

    window.addEventListener('resize', () => this._resize());

    // Canvas listeners (active when modal dialog is open)
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);

    // Window capture listeners for non-modal HUD widgets (#top_panel / #left_panel)
    window.addEventListener('mousemove', this._onWindowMouseMove, true);
    window.addEventListener('mousedown', this._onWindowMouseDown, true);
    window.addEventListener('mouseup', this._onWindowMouseUp, true);
    window.addEventListener('wheel', this._onWindowWheel, { capture: true, passive: false });
    // Mobile: mouse events are not reliably synthesized for DOM/canvas overlays.
    window.addEventListener('touchstart', this._onTouchStart, { capture: true, passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', this._onTouchEnd, { capture: true, passive: false });
    window.addEventListener('touchcancel', this._onTouchEnd, { capture: true, passive: false });

    this.ready = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._startLoop();
      else this._setCanvasVisible(false);
    });
    console.log('[RmlUi] Native Emscripten module ready');
    return this;
  }

  _computeDpScale() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    return Math.max(0.52, Math.min(1.18, Math.min(h / 680, w / 1180)));
  }

  _syncDpRatio() {
    if (!this.mod || !this.mod._rml_set_dp_ratio) return;
    const ratio = this._computeDpScale() * this.dpr;
    this.mod._rml_set_dp_ratio(ratio);
  }

  _resize() {
    // Mobile GPUs choke on a full-screen DPR=2 WebGL surface; 1.5 keeps
    // text readable while cutting fill-rate roughly in half.
    const maxDpr = this._coarsePointer ? 1 : 2;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr));
    this.dpr = dpr;
    this._needsRender = true;
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w;
    this.h = h;
    if (this.mod && this.ready) {
      this.mod._rml_resize(w, h);
      this._syncDpRatio();
    }
    if (this.gl) this.gl.viewport(0, 0, w, h);
  }

  _setCanvasVisible(visible) {
    const next = !!visible;
    if (this._canvasVisible === next || !this.canvas) return;
    this._canvasVisible = next;
    this.canvas.style.display = next ? 'block' : 'none';
  }

  _markDirty(immediate) {
    this._needsRender = true;
    if (immediate) this._lastFrameAt = 0;
    this._startLoop();
  }

  _startLoop() {
    if (!this.ready || this._rafActive) return;
    if (!(this.modalDocs.size > 0 || this.hudDocs.size > 0) || document.hidden) return;
    this._rafActive = true;
    requestAnimationFrame(this._onFrame);
  }

  _onFrame(now) {
    this._rafActive = false;
    if (!this.ready) return;
    const hasDocs = this.modalDocs.size > 0 || this.hudDocs.size > 0;
    if (!hasDocs || document.hidden) {
      this._setCanvasVisible(false);
      return;
    }
    this._setCanvasVisible(true);
    // Dialogs animate and need a steady cadence. The in-world HUD is static,
    // so only repaint it when a packet/interaction actually changed something.
    // This keeps the full-screen UI surface away from the game's frame budget
    // while preserving the exact same visuals and input behaviour.
    const hasModal = this.modalDocs.size > 0;
    const smallScreen = this._coarsePointer || window.innerWidth < 900;
    // Full 60 fps when something actually needs drawing (desktop), 30 fps on
    // phones; idle HUD does zero work, which is where the frame-time win comes
    // from. Visual behaviour stays exactly the same as before.
    this._frameInterval = smallScreen ? 33 : 16;
    if (!hasModal && !this._needsRender) {
      // Fully idle: stop the rAF chain until a packet or input marks the HUD
      // dirty again. No per-frame callback at all while just playing.
      this._rafActive = false;
      return;
    }
    const t = typeof now === 'number' ? now : performance.now();
    if (t - this._lastFrameAt >= this._frameInterval) {
      this._lastFrameAt = t;
      this._needsRender = false;
      try {
        this.mod._rml_update();
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.mod._rml_render();
      } catch (e) {
        if (!this._renderErr) { this._renderErr = true; console.warn('[RmlUi] frame error', e); }
      }
    }
    this._startLoop();
  }

  _fetchCb(pathPtr, outBufPtr, outLenPtr) {
    try {
      const path = this.mod.UTF8ToString(pathPtr);
      if (path.length < 3) return 0;
      if (Array.isArray(this._skipTemplates) && this._skipTemplates.some((name) => path.endsWith(name))) {
        const base = path.split('/').pop() || 'Skipped';
        const tplName = base.replace(/.rml$/i, '');
        const empty = new TextEncoder().encode('<template name="' + tplName + '"></template>');
        const ptr = this.mod._rml_alloc(empty.length);
        this.mod.HEAPU8.set(empty, ptr);
        this.mod.HEAP32[outBufPtr >>> 2] = ptr;
        this.mod.HEAP32[outLenPtr >>> 2] = empty.length;
        return 1;
      }
      const vkey = path.replace(/^\/+/, '');
      const apiIdx = vkey.indexOf('api/');
      const vbuf = this.virtualFiles.get(vkey) ||
        this.virtualFiles.get(this._normalizeRmlPath(path)) ||
        this.virtualFiles.get('GameData/UI/' + this._normalizeRmlPath(path)) ||
        (apiIdx >= 0 ? this.virtualFiles.get(vkey.slice(apiIdx)) : null);
      if (vbuf && vbuf.length > 0) {
        const ptr = this.mod._rml_alloc(vbuf.length);
        this.mod.HEAPU8.set(vbuf, ptr);
        this.mod.HEAP32[outBufPtr >>> 2] = ptr;
        this.mod.HEAP32[outLenPtr >>> 2] = vbuf.length;
        return 1;
      }
      // Game UI resources are already inside the client's Emscripten VFS.
      // Reading them synchronously from memory avoids a blocking XHR per RML
      // template/RCSS/texture (WorldUI used to take ~4.5s over the tunnel).
      const cached = this._fetchCache.get(path);
      if (cached && cached.length > 0) {
        const ptr = this.mod._rml_alloc(cached.length);
        this.mod.HEAPU8.set(cached, ptr);
        this.mod.HEAP32[outBufPtr >>> 2] = ptr;
        this.mod.HEAP32[outLenPtr >>> 2] = cached.length;
        return 1;
      }
      const fsApi = (typeof window !== 'undefined' && (window.FS || (window.Module && window.Module.FS))) || null;
      if (fsApi && typeof fsApi.readFile === 'function') {
        const rel = path.startsWith('/') ? path : '/' + path;
        for (const tryPath of [rel, rel.replace(/^\/branding\/fonts\//, '/branding/')]) {
          try {
            let data = fsApi.readFile(tryPath);
            if (typeof data === 'string') {
              const enc = new TextEncoder().encode(data);
              data = enc;
            } else if (data && !(data instanceof Uint8Array)) {
              data = new Uint8Array(data);
            }
            if (data && data.length > 0) {
              const copy = new Uint8Array(data.length);
              copy.set(data);
              this._fetchCache.set(path, copy);
              const ptr = this.mod._rml_alloc(copy.length);
              this.mod.HEAPU8.set(copy, ptr);
              this.mod.HEAP32[outBufPtr >>> 2] = ptr;
              this.mod.HEAP32[outLenPtr >>> 2] = copy.length;
              return 1;
            }
          } catch (_fsErr) {}
        }
      }
      // RmlUi calls this synchronously from WASM. Templates/styles stay async,
      // but image decorators (item icons, sprites) must be available during the
      // same render pass; otherwise they settle as blank white boxes.
      if (this._failedPaths.has(path)) return 0;
      const isImage = /\.(?:png|jpe?g|webp|gif|bmp|rttex)(?:[?#]|$)/i.test(path);
      if (isImage) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', this._resolveUrl(path), false);
          xhr.overrideMimeType('text/plain; charset=x-user-defined');
          xhr.send(null);
          if (xhr.status === 200 || xhr.status === 0) {
            const text = xhr.responseText;
            const len = text.length;
            if (len > 0) {
              const ptr = this.mod._rml_alloc(len);
              const dst = new Uint8Array(this.mod.HEAPU8.buffer, ptr, len);
              for (let i = 0; i < len; i++) dst[i] = text.charCodeAt(i) & 0xff;
              try { const copy = new Uint8Array(len); copy.set(dst); this._fetchCache.set(path, copy); } catch (_cacheErr) {}
              this.mod.HEAP32[outBufPtr >>> 2] = ptr;
              this.mod.HEAP32[outLenPtr >>> 2] = len;
              return 1;
            }
          }
        } catch (_imgErr) {}
        this._failedPaths.add(path);
        return 0;
      }
      // Missing templates/styles are retried by the async mount loop.
      if (!this._failedPaths.has(path)) this._missingPaths.add(path);
      return 0;
    } catch (e) {
      return 0;
    }
  }

  async _fetchMissingResources(paths) {
    let loaded = 0;
    const queue = Array.from(new Set(paths)).filter((path) => !this._fetchCache.has(path));
    const worker = async () => {
      while (queue.length) {
        const path = queue.shift();
        try {
          const url = new URL(this._resolveUrl(path), window.location.href);
          if (url.origin !== window.location.origin) throw new Error('cross-origin resource');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await fetch(url.href, { signal: controller.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (!bytes.length) throw new Error('empty resource');
            this._fetchCache.set(path, bytes);
            this._failedPaths.delete(path);
            loaded++;
          } finally { clearTimeout(timer); }
        } catch (_) { this._failedPaths.add(path); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
    return loaded;
  }

  async _prepareRenderAssets(models) {
    // Textures are first requested by RmlUi during Render(), not loadDocument.
    // Prime the small shipped sprite set before showing the document so the
    // synchronous native callback never has to fetch them on the game thread.
    if (!this._spritePreload) {
      this._spritePreload = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let metadata;
        try {
          const response = await fetch('/GameData/UI/rml-sprites.json', { signal: controller.signal });
          if (!response.ok) throw new Error('sprite manifest HTTP ' + response.status);
          metadata = await response.json();
        } finally { clearTimeout(timer); }
        const paths = Object.values(metadata.textures || {})
          .map((entry) => String(entry.url || '').replace(/^\/+/, ''))
          .filter((path) => path.startsWith('GameData/sprites/'));
        await this._fetchMissingResources(paths);
      })().catch((err) => { console.warn('[RmlUi] Sprite preload failed:', err); this._spritePreload = null; });
    }
    await this._spritePreload;
    const icons = new Set(['api/item-icon/14730.png', 'api/item-icon/15144.png', 'api/item-icon/16226.png', 'api/item-icon/3902.png']);
    const visit = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 8 || icons.size >= 64) return;
      for (const [key, value] of Object.entries(obj)) {
        if (/^(?:Icon|IconItemId|itemId|iconItemId|Id)$/i.test(key)) {
          const id = Number(value);
          if (Number.isInteger(id) && id > 0 && id < 1000000) icons.add('api/item-icon/' + id + '.png');
        }
        if (typeof value === 'string' && /^\/?(?:api\/item-icon|branding\/modern-ui)\/[\w./-]+\.png$/i.test(value)) {
          icons.add(value.replace(/^\/+/, ''));
        }
        if (value && typeof value === 'object') visit(value, depth + 1);
        if (icons.size >= 64) break;
      }
    };
    visit(models, 0);
    await this._fetchMissingResources([...icons]);
  }

  _resolveUrl(path) {
    if (!path) return path;
    if (/^https?:/.test(path)) return path;
    let rel = path.startsWith('/') ? path : '/' + path;
    if (rel.startsWith('/branding/fonts/')) {
      rel = '/branding/' + rel.slice('/branding/fonts/'.length);
    }
    return new URL(rel, window.location.href).href;
  }

  _utf8Len(s) {
    let l = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) l++;
      else if (c < 0x800) l += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { l += 4; i++; }
      else l += 3;
    }
    return l;
  }

  _allocCString(str) {
    const s = String(str ?? '');
    const len = this._utf8Len(s) + 1;
    const ptr = this.mod._rml_alloc(len);
    this.mod.stringToUTF8(s, ptr, len);
    return ptr;
  }

  _normalizeRmlPath(rmlUrl) {
    let p = String(rmlUrl || '').trim().replace(/^\/+/, '');
    if (p.startsWith('GameData/UI/')) p = p.slice('GameData/UI/'.length);
    return p;
  }

  setSoundMuted(muted) {
    this.soundMuted = !!muted;
    if (this.ready && this.mod._rml_set_sound_muted) {
      this.mod._rml_set_sound_muted(this.soundMuted ? 1 : 0);
    }
  }

  setDataModels(modelsObj) {
    if (!this.ready || !modelsObj) return;
    const jsonPtr = this._allocCString(JSON.stringify(modelsObj));
    this.mod._rml_set_data_models_json(jsonPtr);
    this.mod._rml_free(jsonPtr);
    this._markDirty();
  }

  getDataModel(modelName) {
    if (!this.ready || !modelName) return {};
    const namePtr = this._allocCString(modelName);
    const outPtr = this.mod._rml_get_data_model_json(namePtr);
    this.mod._rml_free(namePtr);
    if (!outPtr) return {};
    try {
      return JSON.parse(this.mod.UTF8ToString(outPtr));
    } catch (_) {
      return {};
    }
  }

  loadDocument(rmlPath) {
    if (!this.ready) return 0;
    const norm = this._normalizeRmlPath(rmlPath);
    const pathPtr = this._allocCString(norm);
    const h = this.mod._rml_load_document(pathPtr);
    this.mod._rml_free(pathPtr);
    if (!h) {
      console.warn('[RmlUi] failed to load', norm);
      return 0;
    }
    this.docs.set(norm, h);
    return h;
  }

  loadDocumentFromMemory(rmlString) {
    if (!this.ready) return 0;
    const s = String(rmlString ?? '');
    const len = this._utf8Len(s);
    const ptr = this.mod._rml_alloc(len + 1);
    this.mod.stringToUTF8(s, ptr, len + 1);
    const h = this.mod._rml_load_document_from_memory(ptr, len);
    this.mod._rml_free(ptr);
    return h;
  }

  closeDocument(rmlPathOrHandle) {
    let h = rmlPathOrHandle;
    if (typeof rmlPathOrHandle === 'string') {
      const norm = this._normalizeRmlPath(rmlPathOrHandle);
      h = this.docs.get(norm);
      this.docs.delete(norm);
    } else {
      for (const [k, v] of this.docs.entries()) {
        if (v === h) this.docs.delete(k);
      }
    }
    if (h) {
      this.modalDocs.delete(h);
      this.hudDocs.delete(h);
      this.docHandlers.delete(h);
      this.mod._rml_close_document(h);
    }
    this._setCanvasVisible(this.modalDocs.size > 0 || this.hudDocs.size > 0);
    this._syncPointerEvents();
    this._markDirty(true);
  }

  getElementRect(docHandle, elementId) {
    if (!this.ready || !docHandle || !elementId || !this.mod._rml_get_element_rect) return null;
    const idPtr = this._allocCString(elementId);
    const outPtr = this.mod._rml_alloc(16);
    const ok = this.mod._rml_get_element_rect(docHandle, idPtr, outPtr);
    let rect = null;
    if (ok) {
      const idx = outPtr >>> 2;
      const x = this.mod.HEAPF32[idx] / this.dpr;
      const y = this.mod.HEAPF32[idx + 1] / this.dpr;
      const w = this.mod.HEAPF32[idx + 2] / this.dpr;
      const h = this.mod.HEAPF32[idx + 3] / this.dpr;
      rect = { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
    }
    this.mod._rml_free(outPtr);
    this.mod._rml_free(idPtr);
    return rect;
  }

  setElementClass(docHandle, elementId, cls, active) {
    if (!this.ready || !docHandle || !elementId || !cls || !this.mod._rml_set_element_class) return;
    const idPtr = this._allocCString(elementId);
    const clsPtr = this._allocCString(cls);
    this.mod._rml_set_element_class(docHandle, idPtr, clsPtr, active ? 1 : 0);
    this.mod._rml_free(clsPtr);
    this.mod._rml_free(idPtr);
    this._markDirty();
  }

  setVirtualFile(path, uint8Array) {
    if (!path || !uint8Array || !uint8Array.length) return;
    const key = String(path).replace(/^\/+/, '');
    const bytes = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);
    this.virtualFiles.set(key, bytes);
    if (this.ready && this.mod._rml_set_virtual_file) {
      const pathPtr = this._allocCString(key);
      const dataPtr = this.mod._rml_alloc(bytes.length);
      this.mod.HEAPU8.set(bytes, dataPtr);
      this.mod._rml_set_virtual_file(pathPtr, dataPtr, bytes.length);
      this.mod._rml_free(dataPtr);
      this.mod._rml_free(pathPtr);
      this._markDirty();
    }
  }

  deleteVirtualFile(path) {
    if (!path) return;
    const key = String(path).replace(/^\/+/, '');
    this.virtualFiles.delete(key);
    if (this.ready && this.mod._rml_delete_virtual_file) {
      const pathPtr = this._allocCString(key);
      this.mod._rml_delete_virtual_file(pathPtr);
      this.mod._rml_free(pathPtr);
      this._markDirty();
    }
  }

  setPortraitRgba(docHandle, elementId, vpath, rgbaBytes, width, height) {
    if (!this.ready || !docHandle || !elementId || !vpath || !rgbaBytes || width <= 0 || height <= 0) return;
    if (this.mod._rml_set_portrait_rgba) {
      const idPtr = this._allocCString(elementId);
      const pathPtr = this._allocCString(vpath);
      const bytes = rgbaBytes instanceof Uint8Array ? rgbaBytes : new Uint8Array(rgbaBytes);
      const pxPtr = this.mod._rml_alloc(bytes.length);
      this.mod.HEAPU8.set(bytes, pxPtr);
      this.mod._rml_set_portrait_rgba(docHandle, idPtr, pathPtr, pxPtr, width | 0, height | 0);
      this.mod._rml_free(pxPtr);
      this.mod._rml_free(pathPtr);
      this.mod._rml_free(idPtr);
      this._markDirty();
    }
  }

  setElementAttr(docHandle, elementId, attrName, attrVal) {
    if (!this.ready || !docHandle || !elementId || !attrName || !this.mod._rml_set_element_attr) return;
    const idPtr = this._allocCString(elementId);
    const namePtr = this._allocCString(attrName);
    const valPtr = this._allocCString(attrVal == null ? '' : String(attrVal));
    this.mod._rml_set_element_attr(docHandle, idPtr, namePtr, valPtr);
    this.mod._rml_free(valPtr);
    this.mod._rml_free(namePtr);
    this.mod._rml_free(idPtr);
    this._markDirty();
  }

  setElementRml(docHandle, elementId, rmlStr) {
    if (!this.ready || !docHandle || !elementId || !this.mod._rml_set_element_rml) return;
    const idPtr = this._allocCString(elementId);
    const rmlPtr = this._allocCString(rmlStr);
    this.mod._rml_set_element_rml(docHandle, idPtr, rmlPtr);
    this.mod._rml_free(rmlPtr);
    this.mod._rml_free(idPtr);
    this._markDirty(true);
  }

  mountDocument(hostEl, rmlUrl, options = {}) {
    const job = this._mountQueue.then(() => this._mountDocument(hostEl, rmlUrl, options));
    this._mountQueue = job.catch(() => {});
    return job;
  }

  async _mountDocument(_hostEl, rmlUrl, options = {}) {
    await this.init();
    const models = options.models || {};
    const onEvent = options.onEvent || null;
    const isModal = options.modal !== false;
    await this._prepareRenderAssets(models);

    const skipTemplates = Array.isArray(options.skipTemplates) ? options.skipTemplates : [];
    let h = null;
    // Discover missing files without ever blocking the browser on network I/O.
    // Each retry may expose another level of linked templates/stylesheets.
    for (let pass = 0; pass < 8; pass++) {
      this.setDataModels(models);
      this._missingPaths.clear();
      const prevSkip = this._skipTemplates;
      this._skipTemplates = skipTemplates;
      try { h = this.loadDocument(rmlUrl); }
      finally { this._skipTemplates = prevSkip; }
      const missing = Array.from(this._missingPaths);
      if (!missing.length) break;
      const loaded = await this._fetchMissingResources(missing);
      if (!loaded) break;
      if (pass === 7) break;
      if (h) this.closeDocument(h);
      h = null;
    }
    if (!h) throw new Error('Native RmlUi failed to load: ' + rmlUrl);

    if (Array.isArray(options.hideElementIds)) {
      for (const id of options.hideElementIds) {
        const idPtr = this._allocCString(id);
        const dispPtr = this._allocCString('none');
        this.mod._rml_set_element_display(h, idPtr, dispPtr);
        this.mod._rml_free(idPtr);
        this.mod._rml_free(dispPtr);
      }
    }

    if (Array.isArray(options.removeBodyClasses)) {
      for (const cls of options.removeBodyClasses) {
        this.setElementClass(h, '@body', cls, false);
      }
    }

    const entry = { models, onEvent, isModal, visible: !options.initiallyHidden };
    this.docHandlers.set(h, entry);
    if (entry.visible) {
      if (isModal) this.modalDocs.add(h);
      else this.hudDocs.add(h);
    } else {
      this.mod._rml_hide_document(h);
    }
    this._setCanvasVisible(this.modalDocs.size > 0 || this.hudDocs.size > 0);
    this._syncPointerEvents();
    this._markDirty(true);

    const self = this;
    return {
      handle: h,
      isNative: true,
      bodyEl: null,
      refresh() {
        self.setDataModels(entry.models);
      },
      getElementRect(id) {
        return self.getElementRect(h, id);
      },
      setElementClass(id, cls, active) {
        self.setElementClass(h, id, cls, active);
      },
      setElementRml(id, rml) {
        self.setElementRml(h, id, rml);
      },
      setElementAttr(id, attrName, attrVal) {
        self.setElementAttr(h, id, attrName, attrVal);
      },
      setVirtualFile(path, bytes) {
        self.setVirtualFile(path, bytes);
      },
      deleteVirtualFile(path) {
        self.deleteVirtualFile(path);
      },
      setPortraitRgba(id, vpath, rgbaBytes, width, height) {
        self.setPortraitRgba(h, id, vpath, rgbaBytes, width, height);
      },
      getModel(name) {
        return self.getDataModel(name);
      },
      setVisible(flag) {
        entry.visible = !!flag;
        if (entry.visible) {
          self.mod._rml_show_document(h);
          if (entry.isModal) self.modalDocs.add(h); else self.hudDocs.add(h);
          self._markDirty(true);
        } else {
          self.mod._rml_hide_document(h);
          if (entry.isModal) self.modalDocs.delete(h); else self.hudDocs.delete(h);
        }
        self._setCanvasVisible(self.modalDocs.size > 0 || self.hudDocs.size > 0);
        self._syncPointerEvents();
        self._markDirty(true);
      },
      destroy() {
        self.closeDocument(h);
      },
    };
  }

  _onNativeUiEvent(docHandle, actionPtr, attrsJsonPtr) {
    const action = this.mod.UTF8ToString(actionPtr);
    let attrs = {};
    try {
      attrs = JSON.parse(this.mod.UTF8ToString(attrsJsonPtr) || '{}');
    } catch (_) {}

    const entry = this.docHandlers.get(docHandle);
    if (!entry) return;

    // Pull latest two-way bound form values (e.g. <input>, <radio>) back into JS models
    if (entry.models) {
      for (const modelName of Object.keys(entry.models)) {
        const updated = this.getDataModel(modelName);
        if (updated && typeof updated === 'object') {
          Object.assign(entry.models[modelName], updated);
        }
      }
    }

    if (typeof entry.onEvent === 'function') {
      const arg = Array.isArray(attrs.args)
        ? (attrs.args.length > 1 ? attrs.args[1] : attrs.args[0])
        : undefined;
      entry.onEvent(action, {
        element: {
          getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
        },
        arg,
        attrs,
        models: entry.models,
      });
    }
    this._markDirty(true);
  }

  _syncPointerEvents() {
    if (!this.canvas) return;
    const hasModal = this.modalDocs.size > 0;
    this.canvas.style.pointerEvents = hasModal ? 'auto' : 'none';
    const ex = this.clientWasmExports ||
      (window.NativeChatHeads && window.NativeChatHeads.wasmExports && window.NativeChatHeads.wasmExports()) ||
      window.__RML_WASM_EXPORTS;
    if (ex && typeof ex.rmlSetModalOpen === 'function') {
      try { ex.rmlSetModalOpen(hasModal ? 1 : 0); } catch (_) {}
    }
  }

  _eventPos(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * this.dpr);
    const y = Math.floor((ev.clientY - rect.top) * this.dpr);
    return [x, y];
  }

  _onMouseMove(ev) {
    if (!this.ready) return;
    const [x, y] = this._eventPos(ev);
    this.mod._rml_mouse_move(x, y, domModifiersToRml(ev));
    this._markDirty();
  }
  _onMouseDown(ev) {
    if (!this.ready) return;
    const [x, y] = this._eventPos(ev);
    const mod = domModifiersToRml(ev);
    this.mod._rml_mouse_move(x, y, mod);
    const btn = ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0;
    this.mod._rml_mouse_button_down(btn, mod);
    this._markDirty();
  }
  _onMouseUp(ev) {
    if (!this.ready) return;
    if (this.modalDocs.size === 0 && !this._hudCapturedMouse) return;
    this._hudCapturedMouse = false;
    const btn = ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0;
    this.mod._rml_mouse_button_up(btn, domModifiersToRml(ev));
    this._markDirty();
  }
  _onWheel(ev) {
    if (!this.ready) return;
    ev.preventDefault();
    this.mod._rml_mouse_wheel(ev.deltaY / 40.0, domModifiersToRml(ev));
    this._markDirty();
  }
  _onKeyDown(ev) {
    if (!this.ready || this.modalDocs.size === 0) return;
    const ki = domKeyToRmlKey(ev);
    const mod = domModifiersToRml(ev);
    if (ki) this.mod._rml_key_down(ki, mod);
    if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const ptr = this._allocCString(ev.key);
      this.mod._rml_text_input(ptr);
      this.mod._rml_free(ptr);
    }
    if (ev.key !== 'Escape') {
      ev.stopPropagation();
    }
    this._markDirty(true);
  }
  _onKeyUp(ev) {
    if (!this.ready || this.modalDocs.size === 0) return;
    const ki = domKeyToRmlKey(ev);
    if (ki) this.mod._rml_key_up(ki, domModifiersToRml(ev));
    if (ev.key !== 'Escape') ev.stopPropagation();
    this._markDirty();
  }

  _touchPoint(ev) {
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
    if (!t) return null;
    return this._eventPos(t);
  }

  _onTouchStart(ev) {
    if (!this.ready || !ev.touches || ev.touches.length !== 1) return;
    const p = this._touchPoint(ev);
    if (!p) return;
    const [x, y] = p;
    const overModal = this.modalDocs.size > 0;
    if (!overModal && (this.hudDocs.size === 0 || !this.mod._rml_is_point_over_ui(x, y))) return;
    this._hudCapturedTouch = true;
    this._touchLastY = y;
    this._touchMoved = false;
    ev.preventDefault();
    ev.stopPropagation();
    this.mod._rml_mouse_move(x, y, 0);
    this.mod._rml_mouse_button_down(0, 0);
    this._markDirty(true);
  }

  _onTouchMove(ev) {
    if (!this.ready || !this._hudCapturedTouch || !ev.touches || ev.touches.length !== 1) return;
    const p = this._touchPoint(ev);
    if (!p) return;
    const [x, y] = p;
    ev.preventDefault();
    ev.stopPropagation();
    this.mod._rml_mouse_move(x, y, 0);
    const dy = y - (this._touchLastY || y);
    if (Math.abs(dy) > 0) {
      if (Math.abs(dy) > 8) this._touchMoved = true;
      // Finger drags up -> content scrolls down, matching a mouse wheel.
      this.mod._rml_mouse_wheel(-dy / 36.0, 0);
      this._touchLastY = y;
    }
    this._markDirty();
  }

  _onTouchEnd(ev) {
    if (!this.ready || !this._hudCapturedTouch) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._hudCapturedTouch = false;
    this._touchLastY = 0;
    this.mod._rml_mouse_button_up(0, 0);
    this._markDirty();
  }

  _onWindowMouseMove(ev) {
    if (!this.ready || this.modalDocs.size > 0 || this.hudDocs.size === 0) return;
    const [x, y] = this._eventPos(ev);
    this.mod._rml_mouse_move(x, y, domModifiersToRml(ev));
    // Only repaint when the cursor is actually over a HUD widget; moving the
    // mouse across the world should not wake the UI renderer at all. Repaint
    // once more when leaving so stale hover highlights are cleared.
    const overHud = this.mod._rml_is_point_over_ui(x, y);
    if (overHud || this._wasOverHud) this._markDirty();
    this._wasOverHud = overHud;
  }
  _onWindowMouseDown(ev) {
    if (!this.ready || this.modalDocs.size > 0 || this.hudDocs.size === 0) return;
    const [x, y] = this._eventPos(ev);
    if (this.mod._rml_is_point_over_ui(x, y)) {
      this._hudCapturedMouse = true;
      ev.stopPropagation();
      ev.preventDefault();
      const btn = ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0;
      this.mod._rml_mouse_button_down(btn, domModifiersToRml(ev));
      this._markDirty(true);
    }
  }
  _onWindowMouseUp(ev) {
    if (!this.ready || this.modalDocs.size > 0 || !this._hudCapturedMouse) return;
    ev.stopPropagation();
    ev.preventDefault();
    this._hudCapturedMouse = false;
    const btn = ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0;
    this.mod._rml_mouse_button_up(btn, domModifiersToRml(ev));
    this._markDirty();
  }
  _onWindowWheel(ev) {
    if (!this.ready || this.modalDocs.size > 0 || this.hudDocs.size === 0) return;
    const [x, y] = this._eventPos(ev);
    if (this.mod._rml_is_point_over_ui(x, y)) {
      ev.stopPropagation();
      ev.preventDefault();
      const mod = domModifiersToRml(ev);
      this.mod._rml_mouse_move(x, y, mod);
      this.mod._rml_mouse_wheel(ev.deltaY / 40.0, mod);
      this._markDirty();
    }
  }
}

export const rmluiNative = new RmlUiNative();
if (typeof window !== 'undefined') {
  window.__rmluiNative = rmluiNative;
}
