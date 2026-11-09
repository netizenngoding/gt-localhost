// ============================================================================
// GameSDK.js — High-Level OOP Client SDK, WASM Hook Injector & Custom Packet
//              Interceptor for CreativeGrowtopia (ReGrowtopia V1.50 WASM)
// ============================================================================
// Memungkinkan modifikasi UI C++/Proton & protokol VariantList langsung dari JS:
//   - new GameEntity("About").visible = false;
//   - new GameEntity("Online").position = { x: 400, y: 300 };
//   - GameSDK.onMenu("MainMenu", (menu) => { ... });
//   - GameSDK.onPacket("OnSendPlayerToYoutube", (args) => { ... });
//   - GameSDK.hookWasm(1501, "iii", (orig, parentPtr, fromMain) => orig(parentPtr, fromMain));
//   - GameSDK.listEntities(); // Lihat semua nama Entity aktif dari Console (F12)
// ============================================================================

(function initCreativeGrowtopiaSDK(global) {
  "use strict";

  var utf8Enc = new TextEncoder();
  var utf8Dec = new TextDecoder("utf-8");

  // --------------------------------------------------------------------------
  // 1. Custom VariantList Packet Interceptor (WebSocket ENet Layer)
  //    Installed BEFORE ReGrowtopia-1.50.js opens ws://.../enet
  // --------------------------------------------------------------------------
  var packetListeners = Object.create(null); // fnName -> Array<Function>
  var wildcardPacketListeners = [];
  var enetCodecExports = null;
  var ENET_CTX_PTR = 65536;
  var ENET_IN_PTR = 131104;
  var ENET_OUT_PTR = 393216;
  var ENET_OUT_MAX = 524288;

  // Load 4.3 KB ENet range-coder WASM asynchronously so compressed server packets
  // can also be inspected if needed (custom packets from sendCustomVariant arrive
  // uncompressed for 0ms instant decoding!).
  if (typeof global.fetch === "function" && typeof WebAssembly === "object") {
    global
      .fetch("WebLoaderData/enet_codec.wasm")
      .then(function (r) {
        return r.ok ? r.arrayBuffer() : null;
      })
      .then(function (buf) {
        if (!buf) return;
        return WebAssembly.instantiate(buf);
      })
      .then(function (res) {
        if (res && res.instance) {
          enetCodecExports = res.instance.exports;
        }
      })
      .catch(function () {});
  }

  function decodeVariantListPayload(u8, extOffset, extLen) {
    if (extLen < 1 || extOffset + extLen > u8.length) return null;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var count = u8[extOffset];
    var pos = extOffset + 1;
    var end = extOffset + extLen;
    var args = [];

    for (var i = 0; i < count && pos + 2 <= end; i++) {
      var idx = u8[pos++];
      var vType = u8[pos++];
      if (vType === 2) {
        // TYPE_STRING
        if (pos + 4 > end) break;
        var sLen = dv.getUint32(pos, true);
        pos += 4;
        if (pos + sLen > end) break;
        args[idx] = utf8Dec.decode(u8.slice(pos, pos + sLen));
        pos += sLen;
      } else if (vType === 1) {
        // TYPE_FLOAT
        if (pos + 4 > end) break;
        args[idx] = dv.getFloat32(pos, true);
        pos += 4;
      } else if (vType === 3) {
        // TYPE_VECTOR2
        if (pos + 8 > end) break;
        args[idx] = { x: dv.getFloat32(pos, true), y: dv.getFloat32(pos + 4, true) };
        pos += 8;
      } else if (vType === 4) {
        // TYPE_VECTOR3
        if (pos + 12 > end) break;
        args[idx] = {
          x: dv.getFloat32(pos, true),
          y: dv.getFloat32(pos + 4, true),
          z: dv.getFloat32(pos + 8, true)
        };
        pos += 12;
      } else if (vType === 5) {
        // TYPE_UINT32
        if (pos + 4 > end) break;
        args[idx] = dv.getUint32(pos, true);
        pos += 4;
      } else if (vType === 9) {
        // TYPE_INT32
        if (pos + 4 > end) break;
        args[idx] = dv.getInt32(pos, true);
        pos += 4;
      } else {
        break;
      }
    }
    return args.length > 0 && typeof args[0] === "string" ? args : null;
  }

  function inspectGamePayload(u8) {
    if (!u8 || u8.length < 61) return;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var msgType = dv.getUint32(0, true);
    if (msgType !== 4) return; // NET_MESSAGE_GAME_PACKET
    var tankType = u8[4];
    if (tankType !== 1) return; // PACKET_CALL_FUNCTION (VariantList)
    var extLen = dv.getUint32(56, true);
    if (extLen <= 0 || 60 + extLen > u8.length) return;

    var args = decodeVariantListPayload(u8, 60, extLen);
    if (!args) return;
    var fnName = args[0];
    var netId = dv.getInt32(8, true);

    dispatchIncomingVariant(fnName, args, netId);
  }

  function dispatchIncomingVariant(fnName, args, netId) {
    var list = packetListeners[fnName];
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        try {
          list[i](args, netId);
        } catch (err) {
          console.warn("[GameSDK] Error in packet listener for " + fnName + ":", err);
        }
      }
    }
    for (var j = 0; j < wildcardPacketListeners.length; j++) {
      try {
        wildcardPacketListeners[j](fnName, args, netId);
      } catch (_e) {}
    }
    if (typeof global.handleCustomServerPackets === "function") {
      try {
        global.handleCustomServerPackets(fnName, args, netId);
      } catch (err2) {
        console.warn("[GameSDK] Error in handleCustomServerPackets:", err2);
      }
    }
  }

  var CMD_HEADER_SIZES = { 0: 0, 1: 8, 2: 48, 3: 44, 4: 8, 5: 4, 6: 6, 7: 8, 8: 24, 9: 8, 10: 12, 11: 16, 12: 24 };

  function inspectEnetFrame(rawBytes) {
    if (!rawBytes || rawBytes.length < 14) return;
    var dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    var peerAndFlags = dv.getUint16(0, false);
    var flags = peerAndFlags & 0xc000;
    var hasSentTime = (flags & 0x8000) !== 0;
    var isCompressed = (flags & 0x4000) !== 0;

    var offset = 2 + (hasSentTime ? 2 : 0) + 4; // peerHeader + optional sentTime + crc32
    if (rawBytes.length <= offset) return;

    var body = rawBytes.subarray(offset);
    if (isCompressed) {
      if (!enetCodecExports) return;
      var compLen = body.length;
      if (compLen > 262000) return;
      var mem = new Uint8Array(enetCodecExports.memory.buffer);
      mem.set(body, ENET_IN_PTR);
      var outLen = enetCodecExports.decompress(ENET_CTX_PTR, ENET_IN_PTR, compLen, ENET_OUT_PTR, ENET_OUT_MAX);
      if (outLen <= 0 || outLen > ENET_OUT_MAX) return;
      body = mem.slice(ENET_OUT_PTR, ENET_OUT_PTR + outLen);
    }

    var bodyDv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    var pos = 0;
    while (pos + 4 <= body.length) {
      var cmdNum = body[pos] & 0x0f;
      var hdrSize = CMD_HEADER_SIZES[cmdNum];
      if (!hdrSize || pos + hdrSize > body.length) break;

      if (cmdNum === 6) {
        // SEND_RELIABLE
        var dataLen = bodyDv.getUint16(pos + 4, false);
        var start = pos + 6;
        if (start + dataLen > body.length) break;
        inspectGamePayload(body.subarray(start, start + dataLen));
        pos = start + dataLen;
      } else if (cmdNum === 7 || cmdNum === 9) {
        // SEND_UNRELIABLE / SEND_UNSEQUENCED
        var uLen = bodyDv.getUint16(pos + 6, false);
        var uStart = pos + 8;
        if (uStart + uLen > body.length) break;
        inspectGamePayload(body.subarray(uStart, uStart + uLen));
        pos = uStart + uLen;
      } else if (cmdNum === 8 || cmdNum === 12) {
        // SEND_FRAGMENT
        var fLen = bodyDv.getUint16(pos + 6, false);
        pos += 24 + fLen;
      } else {
        pos += hdrSize;
      }
    }
  }

  (function installWebSocketInterceptor() {
    var NativeWS = global.WebSocket;
    if (!NativeWS || NativeWS._gtSdkWrapped) return;

    function WrappedWebSocket(url, protocols) {
      var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
      if (typeof url === "string" && url.indexOf("/enet") !== -1) {
        GameSDK._activeSocket = ws;
        ws.addEventListener("message", function (ev) {
          try {
            if (ev.data instanceof ArrayBuffer) {
              inspectEnetFrame(new Uint8Array(ev.data));
            } else if (ArrayBuffer.isView(ev.data)) {
              inspectEnetFrame(new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength));
            } else if (typeof Blob !== "undefined" && ev.data instanceof Blob) {
              ev.data.arrayBuffer().then(function (ab) {
                inspectEnetFrame(new Uint8Array(ab));
              }).catch(function () {});
            }
          } catch (_err) {}
        });
      }
      return ws;
    }

    WrappedWebSocket.prototype = NativeWS.prototype;
    WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
    WrappedWebSocket.OPEN = NativeWS.OPEN;
    WrappedWebSocket.CLOSING = NativeWS.CLOSING;
    WrappedWebSocket.CLOSED = NativeWS.CLOSED;
    WrappedWebSocket._gtSdkWrapped = true;
    global.WebSocket = WrappedWebSocket;
  })();

  // --------------------------------------------------------------------------
  // 2. Low-Level WASM Proton / ClanLib ABI Bridge (100% Binary-Verified)
  // --------------------------------------------------------------------------
  var scratchPtr = 0;
  var customBtnCallbacks = Object.create(null); // btnName -> Function (fallback)
  var customBtnPtrCallbacks = Object.create(null); // entityPtr -> Function (exact match)
  var customButtonDispatcherSlot = 0;

  function isWasmReady() {
    var m = global.Module;
    return !!(m && m.wasmTable && m.HEAPU8 && m.HEAPU32 && m.HEAP32 && m.HEAPF32);
  }

  function ensureScratch() {
    if (!isWasmReady()) return 0;
    if (!scratchPtr) {
      scratchPtr = global.Module.wasmTable.get(117)(512); // operator new(512)
    }
    return scratchPtr;
  }

  // TextDecoder rejects SharedArrayBuffer views; slice copies bytes into a normal buffer.
  function readStdString(sPtr) {
    if (!sPtr || !isWasmReady()) return "";
    var u8 = global.Module.HEAPU8;
    var u32 = global.Module.HEAPU32;
    var tag = u8[sPtr + 11];
    if ((tag & 0x80) === 0) {
      var len = tag & 0x7f;
      if (len > 11) return "";
      return utf8Dec.decode(u8.slice(sPtr, sPtr + len));
    }
    var dataPtr = u32[sPtr >> 2];
    var longLen = u32[(sPtr + 4) >> 2];
    if (!dataPtr || longLen > 2048) return "";
    return utf8Dec.decode(u8.slice(dataPtr, dataPtr + longLen));
  }

  function writeStdString(sPtr, str) {
    var m = global.Module;
    var tbl = m.wasmTable;
    var bytes = utf8Enc.encode(String(str == null ? "" : str));
    var u8 = m.HEAPU8;
    var u32 = m.HEAPU32;
    // Free previous heap buffer if sPtr currently holds a long string
    if ((u8[sPtr + 11] & 0x80) !== 0) {
      var oldBuf = u32[sPtr >> 2];
      if (oldBuf) tbl.get(1028)(oldBuf);
      u8 = m.HEAPU8;
      u32 = m.HEAPU32;
    }
    u32[sPtr >> 2] = 0;
    u32[(sPtr + 4) >> 2] = 0;
    u32[(sPtr + 8) >> 2] = 0;
    if (bytes.length <= 10) {
      u8.set(bytes, sPtr);
      u8[sPtr + 11] = bytes.length;
    } else {
      var cap = (bytes.length + 16) & ~15;
      var buf = tbl.get(117)(cap);
      u8 = m.HEAPU8;
      u32 = m.HEAPU32;
      u8.set(bytes, buf);
      u8[buf + bytes.length] = 0;
      u32[sPtr >> 2] = buf;
      u32[(sPtr + 4) >> 2] = bytes.length;
      u32[(sPtr + 8) >> 2] = (cap | 0x80000000) >>> 0;
    }
  }

  function freeStdString(sPtr) {
    if (!sPtr || !isWasmReady()) return;
    var m = global.Module;
    var u8 = m.HEAPU8;
    var u32 = m.HEAPU32;
    if ((u8[sPtr + 11] & 0x80) !== 0) {
      var buf = u32[sPtr >> 2];
      if (buf) m.wasmTable.get(1028)(buf);
      u32 = m.HEAPU32;
    }
    u32[sPtr >> 2] = 0;
    u32[(sPtr + 4) >> 2] = 0;
    u32[(sPtr + 8) >> 2] = 0;
  }

  function getRootEntityPtr() {
    if (!isWasmReady()) return 0;
    try {
      var pApp = global.Module.wasmTable.get(600)(); // GetApp() -> g_pApp
      if (!pApp) return 0;
      // Verified against ReGrowtopia-1.50.wasm Func #5251 @ 154 & Func #4475 @ 211:
      // BaseApp::m_entityRoot is an inline Entity at offset +1620 (NOT a pointer at +124)!
      return (pApp + 1620) >>> 0;
    } catch (_e) {
      return 0;
    }
  }

  function findEntityPtrByName(parentPtr, name) {
    if (!isWasmReady() || !name) return 0;
    var root = parentPtr || getRootEntityPtr();
    if (!root) return 0;
    var s = ensureScratch();
    if (!s) return 0;
    writeStdString(s, name);
    var ptr = global.Module.wasmTable.get(565)(root, s);
    freeStdString(s);
    return ptr || 0;
  }

  function getVarPtr(entPtr, varName) {
    if (!entPtr || !isWasmReady()) return 0;
    var s = ensureScratch() + 32;
    writeStdString(s, varName);
    var v = global.Module.wasmTable.get(625)(entPtr + 76, s);
    freeStdString(s);
    return v || 0;
  }

  // Verified on the pinned client: Component::VariantDB +36; Variant::m_string +24.
  // Native labels store text on TextRender/TextBoxRender, not the Entity's own DB.
  function getTextVarPtr(entPtr) {
    var m=global.Module, v=getVarPtr(entPtr,"text");
    if(v && m.HEAPU32[v >> 2]===2) return v;
    var scratch=ensureScratch()+96;
    var names=["TextRender","TextBoxRender","InputTextRender"];
    for(var i=0;i<names.length;i++) {
      writeStdString(scratch,names[i]);
      var comp=m.wasmTable.get(637)(entPtr,scratch,0);
      freeStdString(scratch);
      if(!comp) continue;
      writeStdString(scratch,"text");
      v=m.wasmTable.get(625)(comp+36,scratch);
      freeStdString(scratch);
      if(v && m.HEAPU32[v >> 2]===2) return v;
    }
    return 0;
  }

  function notifyVariantChanged(vPtr) {
    if (!vPtr || !isWasmReady()) return;
    var sig = global.Module.HEAPU32[(vPtr + 36) >> 2];
    if (sig) {
      global.Module.wasmTable.get(536)(sig, vPtr);
    }
  }

  function listChildrenPtrs(entPtr) {
    var out = [];
    if (!entPtr || !isWasmReady()) return out;
    var u32 = global.Module.HEAPU32;
    var u8 = global.Module.HEAPU8;
    var sentinel = entPtr + 52;
    var node = u32[(entPtr + 56) >> 2];
    var guard = 0;
    while (node && node !== sentinel && guard++ < 512) {
      var childPtr = u32[(node + 8) >> 2];
      if (childPtr && u8[childPtr + 128] === 0) {
        out.push(childPtr);
      }
      node = u32[(node + 4) >> 2];
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // 3. Persistent Entity Rules & Menu Watcher (Auto-applies edits across menus!)
  // --------------------------------------------------------------------------
  var entityRules = Object.create(null); // entityName -> { visible?, x?, y?, scaleX?, scaleY?, alpha?, text?, color? }
  var appliedPtrCache = Object.create(null); // entityName -> lastPtrApplied
  var menuHooks = Object.create(null); // menuName -> Array<Function>
  var activeMenuPtrs = Object.create(null); // menuName -> lastSeenPtr

  function ensureRule(name) {
    if (!entityRules[name]) entityRules[name] = {};
    return entityRules[name];
  }

  function applyRuleToEntity(ent, rule) {
    if (!ent || !ent.exists || !rule) return;
    if (rule.visible !== undefined) ent._applyVisibleNow(rule.visible);
    if (rule.x !== undefined || rule.y !== undefined) {
      var cur = ent._readPosNow();
      ent._applyPosNow(
        rule.x !== undefined ? rule.x : cur.x,
        rule.y !== undefined ? rule.y : cur.y
      );
    }
    if (rule.scaleX !== undefined || rule.scaleY !== undefined) {
      var sc = ent.scale;
      ent._applyScaleNow(
        rule.scaleX !== undefined ? rule.scaleX : sc.x,
        rule.scaleY !== undefined ? rule.scaleY : sc.y
      );
    }
    if (rule.alpha !== undefined) ent._applyAlphaNow(rule.alpha);
    if (rule.color !== undefined) ent._applyColorNow(rule.color);
    if (rule.text !== undefined) ent._applyTextNow(rule.text);
  }

  function tickSceneObserver() {
    if (isWasmReady()) {
      var root = getRootEntityPtr();
      if (root) {
        // 1. Re-apply persistent GameEntity property rules whenever a matching Entity spawns
        var ruleNames = Object.keys(entityRules);
        for (var i = 0; i < ruleNames.length; i++) {
          var rName = ruleNames[i];
          var ptr = findEntityPtrByName(root, rName);
          if (ptr && appliedPtrCache[rName] !== ptr) {
            appliedPtrCache[rName] = ptr;
            applyRuleToEntity(new GameEntity(ptr), entityRules[rName]);
          } else if (!ptr) {
            appliedPtrCache[rName] = 0;
          }
        }

        // 2. Fire GameSDK.onMenu(menuName, cb) listeners whenever a menu Entity enters the tree
        var watchedMenus = Object.keys(menuHooks);
        for (var j = 0; j < watchedMenus.length; j++) {
          var mName = watchedMenus[j];
          var mPtr = findEntityPtrByName(root, mName);
          if (mPtr && activeMenuPtrs[mName] !== mPtr) {
            activeMenuPtrs[mName] = mPtr;
            var cbs = menuHooks[mName];
            var menuEnt = new GameEntity(mPtr);
            for (var k = 0; k < cbs.length; k++) {
              try {
                cbs[k](menuEnt);
              } catch (err) {
                console.warn("[GameSDK] onMenu('" + mName + "') callback error:", err);
              }
            }
          } else if (!mPtr) {
            activeMenuPtrs[mName] = 0;
          }
        }
      }
    }
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(tickSceneObserver);
    }
  }
  if (typeof global.requestAnimationFrame === "function") {
    global.requestAnimationFrame(tickSceneObserver);
  }

  // --------------------------------------------------------------------------
  // 4. OOP Wrapper: class GameEntity
  // --------------------------------------------------------------------------
  function GameEntity(nameOrPtr, parentPtr) {
    if (!(this instanceof GameEntity)) {
      return new GameEntity(nameOrPtr, parentPtr);
    }
    if (typeof nameOrPtr === "number") {
      this._fixedPtr = nameOrPtr >>> 0;
      this._queryName = "";
      this._parentPtr = 0;
    } else {
      this._fixedPtr = 0;
      this._queryName = String(nameOrPtr || "");
      this._parentPtr = parentPtr || 0;
    }
    this._savedPos = null;
  }

  Object.defineProperties(GameEntity.prototype, {
    ptr: {
      get: function () {
        if (this._fixedPtr) {
          if (!isWasmReady()) return 0;
          if (global.Module.HEAPU8[this._fixedPtr + 128] !== 0) return 0;
          return this._fixedPtr;
        }
        return findEntityPtrByName(this._parentPtr, this._queryName);
      }
    },
    exists: {
      get: function () {
        return this.ptr !== 0;
      }
    },
    name: {
      get: function () {
        var p = this.ptr;
        return p ? readStdString(p + 40) : this._queryName;
      },
      set: function (val) {
        var p = this.ptr;
        if (p) writeStdString(p + 40, String(val));
      }
    },
    visible: {
      get: function () {
        var p = this.ptr;
        if (!p) {
          var r = this._queryName && entityRules[this._queryName];
          return r && r.visible !== undefined ? !!r.visible : false;
        }
        var v = getVarPtr(p, "visible");
        return v ? global.Module.HEAPU32[(v + 8) >> 2] !== 0 : true;
      },
      set: function (val) {
        var bVal = !!val;
        if (this._queryName && !this._parentPtr) {
          ensureRule(this._queryName).visible = bVal;
        }
        this._applyVisibleNow(bVal);
      }
    },
    position: {
      get: function () {
        return this._readPosNow();
      },
      set: function (pos) {
        if (!pos || typeof pos !== "object") return;
        var cur = this._readPosNow();
        var nx = pos.x !== undefined ? Number(pos.x) : cur.x;
        var ny = pos.y !== undefined ? Number(pos.y) : cur.y;
        if (this._queryName && !this._parentPtr) {
          var r = ensureRule(this._queryName);
          if (pos.x !== undefined) r.x = nx;
          if (pos.y !== undefined) r.y = ny;
        }
        this._applyPosNow(nx, ny);
      }
    },
    x: {
      get: function () {
        return this._readPosNow().x;
      },
      set: function (val) {
        this.position = { x: Number(val) };
      }
    },
    y: {
      get: function () {
        return this._readPosNow().y;
      },
      set: function (val) {
        this.position = { y: Number(val) };
      }
    },
    size: {
      get: function () {
        var p = this.ptr;
        if (!p) return { width: 0, height: 0 };
        var v = getVarPtr(p, "size2d");
        if (!v) return { width: 0, height: 0 };
        return {
          width: global.Module.HEAPF32[(v + 8) >> 2],
          height: global.Module.HEAPF32[(v + 12) >> 2]
        };
      },
      set: function (sz) {
        var p = this.ptr;
        if (!p || !sz) return;
        var v = getVarPtr(p, "size2d");
        if (!v) return;
        global.Module.HEAPU32[v >> 2] = 3; // TYPE_VECTOR2
        if (sz.width !== undefined) global.Module.HEAPF32[(v + 8) >> 2] = Number(sz.width);
        if (sz.height !== undefined) global.Module.HEAPF32[(v + 12) >> 2] = Number(sz.height);
        notifyVariantChanged(v);
      }
    },
    scale: {
      get: function () {
        var p = this.ptr;
        if (!p) return { x: 1, y: 1 };
        var v = getVarPtr(p, "scale2d");
        if (!v) return { x: 1, y: 1 };
        return {
          x: global.Module.HEAPF32[(v + 8) >> 2],
          y: global.Module.HEAPF32[(v + 12) >> 2]
        };
      },
      set: function (sc) {
        if (!sc) return;
        var cur = this.scale;
        var sx = sc.x !== undefined ? Number(sc.x) : cur.x;
        var sy = sc.y !== undefined ? Number(sc.y) : cur.y;
        if (this._queryName && !this._parentPtr) {
          var r = ensureRule(this._queryName);
          r.scaleX = sx;
          r.scaleY = sy;
        }
        this._applyScaleNow(sx, sy);
      }
    },
    alpha: {
      get: function () {
        var p = this.ptr;
        if (!p) return 1;
        var v = getVarPtr(p, "alpha");
        return v ? global.Module.HEAPF32[(v + 8) >> 2] : 1;
      },
      set: function (val) {
        var a = Number(val);
        if (this._queryName && !this._parentPtr) ensureRule(this._queryName).alpha = a;
        this._applyAlphaNow(a);
      }
    },
    color: {
      get: function () {
        var p = this.ptr;
        if (!p) return 0xffffffff;
        var v = getVarPtr(p, "color");
        return v ? global.Module.HEAPU32[(v + 8) >> 2] >>> 0 : 0xffffffff;
      },
      set: function (rgba) {
        var c = Number(rgba) >>> 0;
        if (this._queryName && !this._parentPtr) ensureRule(this._queryName).color = c;
        this._applyColorNow(c);
      }
    },
    text: {
      get: function () {
        var p = this.ptr;
        if (!p) return "";
        var v = getTextVarPtr(p);
        return v && global.Module.HEAPU32[v >> 2] === 2 ? readStdString(v + 24) : "";
      },
      set: function (str) {
        var s = String(str == null ? "" : str);
        if (this._queryName && !this._parentPtr) ensureRule(this._queryName).text = s;
        this._applyTextNow(s);
      }
    },
    checked: {
      get: function () {
        var p = this.ptr;
        if (!p) return false;
        var v = getVarPtr(p, "checked");
        return v ? global.Module.HEAPU32[(v + 8) >> 2] !== 0 : false;
      },
      set: function (val) {
        var p = this.ptr;
        if (!p) return;
        var v = getVarPtr(p, "checked");
        if (!v) return;
        global.Module.HEAPU32[v >> 2] = 5; // TYPE_UINT32
        global.Module.HEAPU32[(v + 8) >> 2] = val ? 1 : 0;
        notifyVariantChanged(v);
      }
    },
    children: {
      get: function () {
        var p = this.ptr;
        if (!p) return [];
        return listChildrenPtrs(p).map(function (cp) {
          return new GameEntity(cp);
        });
      }
    }
  });

  GameEntity.prototype._readPosNow = function () {
    var p = this.ptr;
    if (!p) return { x: 0, y: 0 };
    var v = getVarPtr(p, "pos2d");
    if (!v) return { x: 0, y: 0 };
    return {
      x: global.Module.HEAPF32[(v + 8) >> 2],
      y: global.Module.HEAPF32[(v + 12) >> 2]
    };
  };

  GameEntity.prototype._applyPosNow = function (x, y) {
    var p = this.ptr;
    if (!p) return;
    var v = getVarPtr(p, "pos2d");
    if (!v) return;
    global.Module.HEAPU32[v >> 2] = 3; // TYPE_VECTOR2
    global.Module.HEAPF32[(v + 8) >> 2] = Number(x);
    global.Module.HEAPF32[(v + 12) >> 2] = Number(y);
    notifyVariantChanged(v);
  };

  GameEntity.prototype._applyVisibleNow = function (vis) {
    var p = this.ptr;
    if (!p) return;
    var v = getVarPtr(p, "visible");
    if (v) {
      global.Module.HEAPU32[v >> 2] = 5; // TYPE_UINT32
      global.Module.HEAPU32[(v + 8) >> 2] = vis ? 1 : 0;
      notifyVariantChanged(v);
    }
    // Also park offscreen (-9999) when hidden so invisible buttons cannot be clicked!
    var cur = this._readPosNow();
    if (!vis) {
      if (cur.x > -5000) this._savedPos = { x: cur.x, y: cur.y };
      this._applyPosNow(-9999, -9999);
    } else if (cur.x <= -5000 && this._savedPos) {
      this._applyPosNow(this._savedPos.x, this._savedPos.y);
    }
  };

  GameEntity.prototype._applyScaleNow = function (sx, sy) {
    var p = this.ptr;
    if (!p) return;
    var v = getVarPtr(p, "scale2d");
    if (!v) return;
    global.Module.HEAPU32[v >> 2] = 3;
    global.Module.HEAPF32[(v + 8) >> 2] = Number(sx);
    global.Module.HEAPF32[(v + 12) >> 2] = Number(sy);
    notifyVariantChanged(v);
  };

  GameEntity.prototype._applyAlphaNow = function (a) {
    var p = this.ptr;
    if (!p) return;
    var v = getVarPtr(p, "alpha");
    if (!v) return;
    global.Module.HEAPU32[v >> 2] = 1; // TYPE_FLOAT
    global.Module.HEAPF32[(v + 8) >> 2] = Number(a);
    notifyVariantChanged(v);
  };

  GameEntity.prototype._applyColorNow = function (rgba) {
    var p = this.ptr;
    if (!p) return;
    var v = getVarPtr(p, "color");
    if (!v) return;
    global.Module.HEAPU32[v >> 2] = 5; // TYPE_UINT32
    global.Module.HEAPU32[(v + 8) >> 2] = rgba >>> 0;
    notifyVariantChanged(v);
  };

  GameEntity.prototype._applyTextNow = function (str) {
    var p = this.ptr;
    if (!p) return;
    var v = getTextVarPtr(p);
    if (!v) return;
    if (global.Module.HEAPU32[v >> 2] === 2) {
      writeStdString(v + 24, str);
      notifyVariantChanged(v);
    }
  };

  GameEntity.prototype.find = function (childName) {
    var p = this.ptr;
    if (!p) return new GameEntity(childName);
    return new GameEntity(findEntityPtrByName(p, childName));
  };

  GameEntity.prototype.destroy = function () {
    var p = this.ptr;
    if (!p) return;
    if (this._ownedFrame) { this._ownedFrame.destroy(); this._ownedFrame = null; }
    delete customBtnPtrCallbacks[p];
    this._applyVisibleNow(false);
    // A tag alone is NOT a removal request: animated rectangle components keep drawing.
    // Schedule native EntityRemove via MessageManager, then exclude it from SDK queries.
    this.kill(0);
    global.Module.HEAPU8[p + 128] = 1;
  };

  function pruneDestroyedCustomCallbacks() {
    if (!isWasmReady()) return;
    var u8 = global.Module.HEAPU8;
    var ptrKeys = Object.keys(customBtnPtrCallbacks);
    for (var i = 0; i < ptrKeys.length; i++) {
      var p = Number(ptrKeys[i]) >>> 0;
      if (!p || u8[p + 128] !== 0) {
        delete customBtnPtrCallbacks[ptrKeys[i]];
      }
    }
  }

  function ensureCustomButtonDispatcher() {
    if (customButtonDispatcherSlot || !isWasmReady()) return customButtonDispatcherSlot;
    var m = global.Module;
    if (typeof m.hookWasmTable !== "function") return 0;

    // Verified against ReGrowtopia-1.50.wasm: Table "Oe" has fixed limits 4438..4438 (`grow()` throws RangeError).
    // Multiplex custom GameSDK `"vi"` button/checkbox callbacks cleanly through TABLE[2222] (`OptionsMenuOnSelect`),
    // dispatching exact `entityPtr` matches first and delegating all native entities to `prevSlot2222`!
    var prevSlot2222 = m.hookWasmTable(
      2222,
      function (pVList) {
        try {
          if (pVList && isWasmReady()) {
            var clickedPtr = m.HEAPU32[(pVList + 44) >> 2] >>> 0;
            if (clickedPtr && m.HEAPU8[clickedPtr + 128] === 0) {
              var ptrCb = customBtnPtrCallbacks[clickedPtr];
              if (typeof ptrCb === "function") {
                ptrCb(new GameEntity(clickedPtr));
                return;
              }
            }
          }
        } catch (err) {
          console.warn("[GameSDK] Button click handler error:", err);
        }
        if (typeof prevSlot2222 === "function") {
          prevSlot2222(pVList);
        }
      },
      "vi"
    );
    customButtonDispatcherSlot = 2222;
    return customButtonDispatcherSlot;
  }

  function connectEntitySelectSignal(btnPtr, tableSlot) {
    if (!btnPtr || !tableSlot || !isWasmReady()) return;
    var m = global.Module;
    var tbl = m.wasmTable;
    var s = ensureScratch() + 64;
    writeStdString(s, "OnButtonSelected");
    var pFuncObj = tbl.get(539)(btnPtr + 76, s);
    freeStdString(s);
    if (!pFuncObj) return;

    // Verified against ReGrowtopia-1.50.wasm Func #2569 @ 31979..31988:
    // sizeof(boost::signals::slot) == 36 bytes (0..35); connResult MUST NOT overlap slotHolder!
    var slotHolder = tbl.get(117)(64);
    var rawNode = tbl.get(117)(24);
    var u32 = m.HEAPU32;
    for (var i = 0; i < 16; i++) u32[(slotHolder >> 2) + i] = 0;
    for (var j = 0; j < 6; j++) u32[(rawNode >> 2) + j] = 0;

    u32[(slotHolder + 8) >> 2] = 277397;
    u32[(slotHolder + 12) >> 2] = tableSlot;
    tbl.get(626)(slotHolder, rawNode);
    tbl.get(627)(slotHolder);
    tbl.get(628)(slotHolder + 40, pFuncObj, slotHolder, 0);
  }

  GameEntity.prototype.addButton = function (opts) {
    var p = this.ptr;
    if (!p || !opts || !isWasmReady()) return new GameEntity(0);
    var m = global.Module;
    var tbl = m.wasmTable;
    var s = ensureScratch();
    var framePtr = 0;
    var btnName = String(opts.name || "sdk_btn_" + Date.now());
    var btnText = String(opts.text || btnName);
    var x = Number(opts.x || 0);
    var y = Number(opts.y || 0);
    var underline = opts.underline ? 1 : 0;
    var linesFit = Number(opts.linesPerScreenY || 15.0);

    var fontOut = s + 128;
    m.HEAP32[fontOut >> 2] = 1;
    m.HEAPF32[(fontOut + 4) >> 2] = tbl.get(2299)(1, 1.0, 6.6);
    tbl.get(2023)(fontOut, fontOut + 4, linesFit);
    var fontId = m.HEAP32[fontOut >> 2];
    var fontScale = m.HEAPF32[(fontOut + 4) >> 2];

    var sName = s + 160;
    var sText = s + 192;
    writeStdString(sName, btnName);
    writeStdString(sText, btnText);
    var btnPtr = tbl.get(1582)(p, sName, x, y, sText, underline);
    freeStdString(sName);
    freeStdString(sText);

    if (btnPtr) {
      tbl.get(655)(btnPtr, fontId, fontScale);
      // Measure native glyph layout before making the frame, including the selected font.
      var naturalWidth = new GameEntity(btnPtr).size.width;
      if (opts.maxWidth && naturalWidth > Number(opts.maxWidth)) {
        fontScale *= Number(opts.maxWidth) / naturalWidth;
        tbl.get(655)(btnPtr, fontId, fontScale);
      }
      if (opts.framed) {
        var screenH = m.HEAP32[392496 >> 2] || 768;
        var pad = opts.padding !== undefined ? Number(opts.padding) : (screenH * 20.0) / 768.0;
        var bgCol = opts.frameColor !== undefined ? (opts.frameColor | 0) : -860321793; // 0xCCB887FF
        var borderCol = opts.borderColor !== undefined ? (opts.borderColor | 0) : bgCol;
        framePtr = tbl.get(2039)(btnPtr, bgCol, borderCol, pad, 1, fontScale, fontId);
        if (opts.bob) {
          tbl.get(2037)(btnPtr, 150);
        }
        if (opts.hotkeyCode !== undefined) {
          // tbl[2117] (Func #785) = SetHotKeyToButton(btnPtr, keycode)
          tbl.get(2117)(btnPtr, Number(opts.hotkeyCode) | 0);
        }
        tbl.get(2029)(btnPtr, 1);
      }
      if (typeof opts.onClick === "function") {
        pruneDestroyedCustomCallbacks();
        var dispSlot = ensureCustomButtonDispatcher();
        if (dispSlot) {
          customBtnPtrCallbacks[btnPtr >>> 0] = opts.onClick;
          customBtnCallbacks[btnName] = opts.onClick;
          connectEntitySelectSignal(btnPtr, dispSlot);
        }
      }
    }
    var result = new GameEntity(btnPtr);
    if (framePtr) result._ownedFrame = new GameEntity(framePtr);
    return result;
  };

  GameEntity.prototype.addLabel = function (opts) {
    var p = this.ptr;
    if (!p || !opts || !isWasmReady()) return new GameEntity(0);
    var m = global.Module;
    var tbl = m.wasmTable;
    var s = ensureScratch();
    var lblName = String(opts.name || "sdk_lbl_" + Date.now());
    var lblText = String(opts.text == null ? "" : opts.text);
    var x = Number(opts.x || 0);
    var y = Number(opts.y || 0);
    var linesFit = Number(opts.linesPerScreenY || 20.0);

    var fontOut = s + 128;
    if (opts.bigFont) {
      m.HEAP32[fontOut >> 2] = 1;
      m.HEAPF32[(fontOut + 4) >> 2] = tbl.get(2299)(1, 1.0, 6.6);
    } else {
      m.HEAP32[fontOut >> 2] = 0;
      m.HEAPF32[(fontOut + 4) >> 2] = 1.0;
    }
    tbl.get(2023)(fontOut, fontOut + 4, linesFit);
    var fontId = m.HEAP32[fontOut >> 2];
    var fontScale = m.HEAPF32[(fontOut + 4) >> 2];

    var sName = s + 160;
    var sText = s + 192;
    writeStdString(sName, lblName);
    writeStdString(sText, lblText);
    var lblPtr = tbl.get(654)(p, sName, x, y, sText);
    freeStdString(sName);
    freeStdString(sText);

    if (lblPtr && lblText.length > 0) {
      tbl.get(655)(lblPtr, fontId, fontScale);
    }
    return new GameEntity(lblPtr);
  };

  GameEntity.prototype.addOverlayBg = function (opts) {
    var p = this.ptr;
    if (!p || !opts || !isWasmReady()) return new GameEntity(0);
    var m = global.Module;
    var tbl = m.wasmTable;
    var s = ensureScratch();
    var ovName = String(opts.name || "sdk_overlay_" + Date.now());
    var filePath = String(opts.file || "interface/large/generic_menu2.rttex");
    var x = Number(opts.x || 0);
    var y = Number(opts.y || 0);
    var w = Number(opts.width || m.HEAP32[392500 >> 2] || 1024);
    var h = Number(opts.height || m.HEAP32[392496 >> 2] || 768);

    var sName = s + 160;
    var sPath = s + 192;
    writeStdString(sName, ovName);
    writeStdString(sPath, filePath);
    var ovPtr = tbl.get(1361)(p, sName, sPath, x, y, 1);
    freeStdString(sName);
    freeStdString(sPath);

    if (ovPtr) {
      var vSize = s + 240;
      m.HEAPF32[vSize >> 2] = w;
      m.HEAPF32[(vSize + 4) >> 2] = h;
      tbl.get(2123)(ovPtr, vSize, 0, 0);
    }
    return new GameEntity(ovPtr);
  };

  GameEntity.prototype.slide = function (slideIn, durationMs, delayMs) {
    var p = this.ptr;
    if (!p || !isWasmReady()) return;
    var dur = durationMs !== undefined ? (durationMs | 0) : 500;
    var dly = delayMs !== undefined ? (delayMs | 0) : 0;
    global.Module.wasmTable.get(1396)(p, slideIn ? 1 : 0, dur, dly, 1);
  };

  GameEntity.prototype.kill = function (delayMs) {
    var p = this.ptr;
    if (!p || !isWasmReady()) return;
    var tbl = global.Module.wasmTable;
    var timing = tbl.get(528)();
    tbl.get(1398)(p, delayMs !== undefined ? (delayMs | 0) : 0, timing);
  };

  GameEntity.prototype.addCheckbox = function (opts) {
    var p = this.ptr;
    if (!p || !opts || !isWasmReady()) return new GameEntity(0);
    var m = global.Module;
    var tbl = m.wasmTable;
    var s = ensureScratch();
    var chkName = String(opts.name || "sdk_chk_" + Date.now());
    var chkText = String(opts.text || chkName);
    var x = Number(opts.x || 0);
    var y = Number(opts.y || 0);
    var checked = opts.checked ? 1 : 0;
    var linesFit = Number(opts.linesPerScreenY || 20.0);

    var fontOut = s + 128;
    m.HEAP32[fontOut >> 2] = 0;
    m.HEAPF32[(fontOut + 4) >> 2] = 1.0;
    tbl.get(2023)(fontOut, fontOut + 4, linesFit);
    var fontId = m.HEAP32[fontOut >> 2];
    var fontScale = m.HEAPF32[(fontOut + 4) >> 2];

    var sName = s + 160;
    var sText = s + 192;
    writeStdString(sName, chkName);
    writeStdString(sText, chkText);
    var chkPtr = tbl.get(656)(p, sName, sText, x, y, checked, fontId, fontScale, 0);
    freeStdString(sName);
    freeStdString(sText);

    if (chkPtr && typeof opts.onChange === "function") {
      pruneDestroyedCustomCallbacks();
      var dispSlot = ensureCustomButtonDispatcher();
      if (dispSlot) {
        var chkHandler = function (ent) {
          opts.onChange(ent.checked, ent);
        };
        customBtnPtrCallbacks[chkPtr >>> 0] = chkHandler;
        customBtnCallbacks[chkName] = chkHandler;
        connectEntitySelectSignal(chkPtr, dispSlot);
      }
    }
    return new GameEntity(chkPtr);
  };

  // --------------------------------------------------------------------------
  // 5. Public GameSDK Namespace (100% Pure Native WASM — Zero HTML Overlays!)
  // --------------------------------------------------------------------------
  function showNativeTextOverlay(msg, customX, customY) {
    if (!msg || !isWasmReady()) return false;
    try {
      var m = global.Module;
      var tbl = m.wasmTable;
      var root = getRootEntityPtr();
      if (root) {
        var oldOv = findEntityPtrByName(root, "TextOverlay");
        if (oldOv) {
          m.HEAPU8[oldOv + 128] = 1; // Tag previous TextOverlay for deletion cleanly
        }
      }
      var s = ensureScratch();
      var screenW = m.HEAP32[392500 >> 2] || global.innerWidth || 1024;
      var screenH = m.HEAP32[392496 >> 2] || global.innerHeight || 768;
      var vecPtr = s + 256;
      var strPtr = s + 272;
      m.HEAPF32[vecPtr >> 2] = customX !== undefined ? Number(customX) : screenW * 0.5;
      m.HEAPF32[(vecPtr + 4) >> 2] = customY !== undefined ? Number(customY) : screenH * 0.5;
      writeStdString(strPtr, String(msg));
      // tbl[1618] = CreateTextOverlay(CL_Vec2f* pos, std::string* text) (Func #5251)
      tbl.get(1618)(vecPtr, strPtr);
      freeStdString(strPtr);
      return true;
    } catch (err) {
      console.warn("[GameSDK] showTextOverlay error:", err);
      return false;
    }
  }

  function openUrlSafely(url) {
    if (!url || typeof url !== "string") return false;
    var safeUrl = url.trim();
    if (!/^https?:\/\//i.test(safeUrl)) return false;

    var win = null;
    try {
      win = global.open(safeUrl, "_blank", "noopener,noreferrer");
    } catch (_e) {}

    if (win) return true;

    // If browser popup policy blocked background window.open, notify purely via native WASM TextOverlay
    // and open on next canvas click without creating any HTML banners!
    showNativeTextOverlay("`wClick anywhere to open link...``");
    var onceOpen = function () {
      global.removeEventListener("pointerup", onceOpen, true);
      try {
        global.open(safeUrl, "_blank", "noopener,noreferrer");
      } catch (_e2) {}
    };
    global.addEventListener("pointerup", onceOpen, true);
    return false;
  }

  var GameSDK = {
    version: "1.50-OP",
    Entity: GameEntity,

    get ready() {
      return isWasmReady() && getRootEntityPtr() !== 0;
    },

    get root() {
      return new GameEntity(getRootEntityPtr());
    },

    get screenSize() {
      if (!isWasmReady()) return { width: global.innerWidth || 1024, height: global.innerHeight || 768 };
      return {
        width: global.Module.HEAP32[392500 >> 2] || global.innerWidth,
        height: global.Module.HEAP32[392496 >> 2] || global.innerHeight
      };
    },

    entity: function (nameOrPtr) {
      return new GameEntity(nameOrPtr);
    },

    clearRules: function (entityName) {
      if (entityName) {
        delete entityRules[entityName];
        delete appliedPtrCache[entityName];
      } else {
        entityRules = Object.create(null);
        appliedPtrCache = Object.create(null);
      }
    },

    onMenu: function (menuName, callback) {
      if (!menuName || typeof callback !== "function") return;
      if (!menuHooks[menuName]) menuHooks[menuName] = [];
      menuHooks[menuName].push(callback);
      // Fire immediately if menu is already on screen!
      var ptr = findEntityPtrByName(0, menuName);
      if (ptr) {
        activeMenuPtrs[menuName] = ptr;
        try {
          callback(new GameEntity(ptr));
        } catch (_e) {}
      }
    },

    onPacket: function (functionName, callback) {
      if (!functionName || typeof callback !== "function") return;
      if (functionName === "*") {
        wildcardPacketListeners.push(callback);
        return;
      }
      if (!packetListeners[functionName]) packetListeners[functionName] = [];
      packetListeners[functionName].push(callback);
    },

    hookWasm: function (tableIndex, signature, wrapperFn) {
      var m = global.Module;
      if (!m || typeof m.hookWasmTable !== "function") {
        throw new Error("[GameSDK] Module.hookWasmTable belum siap — panggil di dalam onRuntimeInitialized!");
      }
      var origHolder = { fn: null };
      origHolder.fn = m.hookWasmTable(
        tableIndex,
        function () {
          var callArgs = [origHolder.fn];
          for (var i = 0; i < arguments.length; i++) callArgs.push(arguments[i]);
          return wrapperFn.apply(null, callArgs);
        },
        signature
      );
      return origHolder.fn;
    },

    listEntities: function (filterSubstring) {
      var rows = [];
      var rootPtr = getRootEntityPtr();
      if (!rootPtr) return rows;
      var needle = filterSubstring ? String(filterSubstring).toLowerCase() : "";

      function walk(ptr, pathPrefix, depth) {
        if (!ptr || depth > 16) return;
        var ent = new GameEntity(ptr);
        var nm = ent.name || "(unnamed)";
        var fullPath = pathPrefix ? pathPrefix + "/" + nm : nm;
        if (!needle || fullPath.toLowerCase().indexOf(needle) !== -1) {
          var pos = ent.position;
          var sz = ent.size;
          rows.push({
            name: nm,
            path: fullPath,
            ptr: ptr,
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            w: Math.round(sz.width),
            h: Math.round(sz.height),
            visible: ent.visible
          });
        }
        var kids = listChildrenPtrs(ptr);
        for (var i = 0; i < kids.length; i++) {
          walk(kids[i], fullPath, depth + 1);
        }
      }

      walk(rootPtr, "", 0);
      if (typeof console !== "undefined" && typeof console.table === "function") {
        console.table(rows);
      }
      return rows;
    },

    openUrl: openUrlSafely,

    showTextOverlay: showNativeTextOverlay,

    toast: function (msg) {
      return showNativeTextOverlay(msg);
    },

    playSfx: function (vfsPath) {
      if (typeof global.playNativeVfsSfx === "function") {
        global.playNativeVfsSfx(vfsPath);
      }
    },

    _abi: {
      ensureScratch: ensureScratch,
      readStdString: readStdString,
      writeStdString: writeStdString,
      freeStdString: freeStdString,
      getRootEntityPtr: getRootEntityPtr,
      findEntityPtrByName: findEntityPtrByName,
      getVarPtr: getVarPtr,
      notifyVariantChanged: notifyVariantChanged,
      connectEntitySelectSignal: connectEntitySelectSignal
    }
  };

  global.GameEntity = GameEntity;
  global.GameSDK = GameSDK;
})(window);
