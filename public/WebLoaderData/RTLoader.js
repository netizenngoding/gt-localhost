var gameVersion = "1.50";


// ============================================================================
// 1. WebAudio Engine Safeguards (installed BEFORE ReGrowtopia-1.50.js loads)
// ============================================================================
(function installWebAudioSafeguards() {
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !Ctx.prototype || Ctx.prototype._gtPatchedDecode) return;
  Ctx.prototype._gtPatchedDecode = true;
  var origDecode = Ctx.prototype.decodeAudioData;
  Ctx.prototype.decodeAudioData = function (audioData, successCb, errorCb) {
    var cleanBuffer = audioData;
    try {
      if (ArrayBuffer.isView(audioData)) {
        cleanBuffer = audioData.buffer.slice(
          audioData.byteOffset,
          audioData.byteOffset + audioData.byteLength
        );
      }
    } catch (_e) {}
    return origDecode.call(
      this,
      cleanBuffer,
      successCb || function () {},
      errorCb || function () {}
    );
  };
})();

// ============================================================================
// 2. Network Routing Bridge
//   - Keep ReGrowtopia-1.50.wasm & ReGrowtopia-1.50.data loading DIRECTLY from
//     https://play.creativeps.eu/creativegrowtopia_web/
//   - Route coordinator & OSD calls (server_data.php, /cache/*, splashes.txt)
//     to our local server origin.
// ============================================================================
function rewriteGameApiUrl(rawUrl) {
  if (typeof rawUrl !== "string") return rawUrl;
  if (
    rawUrl.indexOf("client.wasm") !== -1 ||
    rawUrl.indexOf("client.data") !== -1
  ) {
    return rawUrl;
  }
  if (rawUrl.indexOf("server_data.php") !== -1) {
    return "/growtopia/server_data.php";
  }
  if (rawUrl.indexOf("reEhtkssvWbhygankja.txt") !== -1) {
    return "/reEhtkssvWbhygankja.txt";
  }
  try {
    var parsed = new URL(rawUrl, window.location.origin);
    if (
      parsed.pathname.indexOf("/cache/") === 0 ||
      parsed.pathname.indexOf("/creativegrowtopia_web/cache/") === 0
    ) {
      var cleanCachePath = parsed.pathname.replace(/^\/creativegrowtopia_web\/cache\//, "/cache/");
      return cleanCachePath + parsed.search;
    }
    if (
      parsed.hostname.indexOf("magnolia.test") !== -1 ||
      parsed.hostname.indexOf("growtopia1.com") !== -1 ||
      parsed.hostname.indexOf("growtopia2.com") !== -1 ||
      parsed.hostname.indexOf("ubistatic-a.akamaihd.net") !== -1 ||
      (parsed.hostname === "localhost" && parsed.origin !== window.location.origin)
    ) {
      return parsed.pathname + parsed.search;
    }
  } catch (_e) {}
  return rawUrl;
}

(function installNetworkRewriters() {
  var origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = rewriteGameApiUrl(url);
    return origXhrOpen.apply(this, args);
  };

  if (typeof window.fetch === "function") {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      if (typeof input === "string") {
        input = rewriteGameApiUrl(input);
      } else if (input && typeof input.url === "string") {
        var rewritten = rewriteGameApiUrl(input.url);
        if (rewritten !== input.url) {
          input = new Request(rewritten, input);
        }
      }
      return origFetch(input, init);
    };
  }
})();

// ============================================================================
// 3. Device Detection (PC/Desktop vs Mobile/Touch)
// ============================================================================
function isMobileClient() {
  if (typeof isOnMobileDevice === "function") {
    return !!isOnMobileDevice();
  }
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// ============================================================================
// 4. VFS Audio Aliases, Sunny Menu Background Lock & Dynamic Splashes
// ============================================================================
var SPLASH_TABLE_VA = 369792;
var SPLASH_SLOT_COUNT = 96;
var customSplashLines = [];

function parseSplashLines(rawText) {
  if (typeof rawText !== "string") return [];
  var lines = rawText.split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.indexOf("#") === 0 || trimmed.indexOf("//") === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function applySplashLinesToWasm(lines) {
  if (!lines || !lines.length) return;
  if (!Module || typeof Module._malloc !== "function" || !Module.HEAPU8) return;
  try {
    var encoder = new TextEncoder();
    var ptrs = [];
    for (var i = 0; i < lines.length; i++) {
      var utf8 = encoder.encode(lines[i]);
      var ptr = Module._malloc(utf8.length + 1);
      if (!ptr) continue;
      var heap = Module.HEAPU8;
      heap.set(utf8, ptr);
      heap[ptr + utf8.length] = 0;
      ptrs.push(ptr);
    }
    if (!ptrs.length) return;
    var view = new DataView(Module.HEAPU8.buffer);
    for (var slot = 0; slot < SPLASH_SLOT_COUNT; slot++) {
      var chosenPtr = ptrs[slot % ptrs.length];
      view.setUint32(SPLASH_TABLE_VA + slot * 4, chosenPtr, true);
    }
  } catch (err) {
    console.warn("[Client] Failed to apply splashes.txt:", err);
  }
}

function makeSilentWavBytes() {
  // Minimal valid 44-byte 8kHz mono 8-bit PCM silent WAV for /audio/blank.wav
  var b = new Uint8Array(46);
  var s = "RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x40\x1f\x00\x00\x01\x00\x08\x00data\x02\x00\x00\x00\x80\x80";
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function installVfsPatches() {
  try {
    var fsApi = typeof FS !== "undefined" ? FS : Module && Module.FS;
    if (!fsApi || typeof fsApi.readFile !== "function" || typeof fsApi.writeFile !== "function") {
      return;
    }
    var prevIgnore = fsApi.ignorePermissions;
    fsApi.ignorePermissions = true;
    try {
      if (globalThis.ServerBranding) globalThis.ServerBranding.install(fsApi);

      // 1. Use a logo-free server background so login fields remain readable
      var sunnyBg = fsApi.readFile("/interface/large/main_menu.rttex");
      if (sunnyBg && sunnyBg.length > 0) {
        try { fsApi.unlink("/interface/large/generic_menu2.rttex"); } catch (_e) {}
        fsApi.writeFile("/interface/large/generic_menu2.rttex", sunnyBg);
      }

      // 2. Populate the 7 WASM-referenced /audio/*.wav aliases missing in ReGrowtopia-1.50.data
      //    (notably /audio/sound_on.wav & /audio/sound_off.wav used inside OptionsMenu!)
      try {
        fsApi.stat("/audio/blank.wav");
      } catch (_e) {
        fsApi.writeFile("/audio/blank.wav", makeSilentWavBytes());
      }

      var audioAliases = [
        ["/audio/door_close.wav", "/audio/door_shut.wav"],
        ["/audio/Flamego.wav",    "/audio/flame_go.wav"],
        ["/audio/blast.wav",      "/audio/explode.wav"],
        ["/audio/lb2_sfx.wav",    "/audio/lb_sfx2.wav"],
        ["/audio/sound_on.wav",   "/audio/switch.wav"],
        ["/audio/sound_off.wav",  "/audio/switch2.wav"]
      ];
      for (var i = 0; i < audioAliases.length; i++) {
        var dst = audioAliases[i][0];
        var src = audioAliases[i][1];
        var exists = false;
        try { fsApi.stat(dst); exists = true; } catch (_e) {}
        if (!exists) {
          try {
            var srcBytes = fsApi.readFile(src);
            if (srcBytes && srcBytes.length > 0) {
              fsApi.writeFile(dst, srcBytes);
            }
          } catch (_e2) {}
        }
      }
    } finally {
      fsApi.ignorePermissions = prevIgnore;
    }
  } catch (err) {
    console.warn("[Client] VFS patch error:", err);
  }
}

var uiSfxBufferCache = {};
function playNativeVfsSfx(vfsPath) {
  try {
    var sdl = Module && Module.SDL;
    var ctx = sdl && sdl.audioContext;
    var fsApi = typeof FS !== "undefined" ? FS : Module && Module.FS;
    if (!ctx || !fsApi) return;
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    var playBuf = function (buf) {
      if (!buf) return;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    };
    if (uiSfxBufferCache[vfsPath]) {
      playBuf(uiSfxBufferCache[vfsPath]);
      return;
    }
    var raw = fsApi.readFile(vfsPath);
    var slice = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    ctx.decodeAudioData(slice, function (decoded) {
      uiSfxBufferCache[vfsPath] = decoded;
      playBuf(decoded);
    });
  } catch (_e) {}
}
window.playNativeVfsSfx = playNativeVfsSfx;

// ============================================================================
// 5. Authentic Official PC Growtopia.exe "Hotkey Settings" & Fullscreen
//    Extracted verbatim from archived Windows Growtopia.exe (HotkeySettingsMenu):
//      Jump, Punch, Move Left, Move Right, Move Down, Pause Menu, Open Chat, Toggle Wrench
//      with Primary & Secondary slots + Save, Clear, Reset, Back.
// ============================================================================
var HOTKEYS_STORAGE_KEY = "gt_pc_hotkeys_v1";

var PC_HOTKEY_ACTIONS = [
  { id: "jump",         label: "Jump",          targetKeyCode: 87, targetKey: "w",      targetCode: "KeyW"   },
  { id: "punch",        label: "Punch",         targetKeyCode: 32, targetKey: " ",      targetCode: "Space"  },
  { id: "move_left",    label: "Move Left",     targetKeyCode: 65, targetKey: "a",      targetCode: "KeyA"   },
  { id: "move_right",   label: "Move Right",    targetKeyCode: 68, targetKey: "d",      targetCode: "KeyD"   },
  { id: "move_down",    label: "Move Down",     targetKeyCode: 83, targetKey: "s",      targetCode: "KeyS"   },
  { id: "pause_menu",   label: "Pause Menu",    targetKeyCode: 27, targetKey: "Escape", targetCode: "Escape" },
  { id: "open_chat",    label: "Open Chat",     targetKeyCode: 13, targetKey: "Enter",  targetCode: "Enter"  },
  { id: "toggle_wrench",label: "Toggle Wrench", targetKeyCode: -1, targetKey: "Tab",    targetCode: "Tab"    }
];

var DEFAULT_PC_HOTKEYS = {
  jump:          { primary: "KeyW",       secondary: "ArrowUp"      },
  punch:         { primary: "Space",      secondary: "ControlLeft"  },
  move_left:     { primary: "KeyA",       secondary: "ArrowLeft"    },
  move_right:    { primary: "KeyD",       secondary: "ArrowRight"   },
  move_down:     { primary: "KeyS",       secondary: "ArrowDown"    },
  pause_menu:    { primary: "Escape",     secondary: ""             },
  open_chat:     { primary: "Enter",      secondary: ""             },
  toggle_wrench: { primary: "Tab",        secondary: ""             }
};

// Keys natively bound inside ReGrowtopia-1.50.wasm that must be suppressed if unbound by user
var NATIVE_ENGINE_ACTION_CODES = {
  KeyW: 1, ArrowUp: 1,
  Space: 1, ControlLeft: 1, ControlRight: 1,
  KeyA: 1, ArrowLeft: 1,
  KeyD: 1, ArrowRight: 1,
  KeyS: 1, ArrowDown: 1,
  Escape: 1, Enter: 1, NumpadEnter: 1, Tab: 1
};

function cloneHotkeys(src) {
  return JSON.parse(JSON.stringify(src));
}

function formatKeyCodeName(code) {
  if (!code) return "None";
  if (code === "Space") return "Space";
  if (code === "Escape") return "Escape";
  if (code === "Enter" || code === "NumpadEnter") return "Enter";
  if (code === "Tab") return "Tab";
  if (code === "Backspace") return "Backspace";
  if (code === "ShiftLeft") return "Left Shift";
  if (code === "ShiftRight") return "Right Shift";
  if (code === "ControlLeft") return "Left Ctrl";
  if (code === "ControlRight") return "Right Ctrl";
  if (code === "AltLeft") return "Left Alt";
  if (code === "AltRight") return "Right Alt";
  if (code.indexOf("Key") === 0) return code.slice(3);
  if (code.indexOf("Digit") === 0) return code.slice(5);
  if (code.indexOf("Arrow") === 0) return code.slice(5);
  if (code.indexOf("Numpad") === 0) return "Num " + code.slice(6);
  return code;
}

function loadSavedHotkeys() {
  try {
    var raw = localStorage.getItem(HOTKEYS_STORAGE_KEY);
    if (!raw) return cloneHotkeys(DEFAULT_PC_HOTKEYS);
    var parsed = JSON.parse(raw);
    var out = cloneHotkeys(DEFAULT_PC_HOTKEYS);
    for (var i = 0; i < PC_HOTKEY_ACTIONS.length; i++) {
      var id = PC_HOTKEY_ACTIONS[i].id;
      if (parsed && parsed[id] && typeof parsed[id] === "object") {
        if (typeof parsed[id].primary === "string") out[id].primary = parsed[id].primary;
        if (typeof parsed[id].secondary === "string") out[id].secondary = parsed[id].secondary;
      }
    }
    return out;
  } catch (_e) {
    return cloneHotkeys(DEFAULT_PC_HOTKEYS);
  }
}

function persistHotkeys(cfg) {
  try {
    localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(cfg));
  } catch (_e) {}
}

var activeHotkeys = loadSavedHotkeys();
var draftHotkeys = cloneHotkeys(activeHotkeys);
var selectedSlot = null;  // { actionId: string, slot: "primary" | "secondary" }
var listeningSlot = null; // { actionId: string, slot: "primary" | "secondary" }
var draftDirty = false;
var nativeHotkeyMenuOpen = false;

// Track active remapped physical keys so keyup always releases the exact keyCode sent on keydown
var activePhysicalToVirtual = {};
var wrenchToggleIsWrench = false;

function showNativeOverlayText(msg) {
  if (window.GameSDK && typeof window.GameSDK.showTextOverlay === "function") {
    window.GameSDK.showTextOverlay(msg);
  }
}
window.showGtToast = showNativeOverlayText;

function isBrowserFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

var syncNativeFullscreenCheckbox = function () {};
var lastDomFullscreenToggleMs = 0;

function toggleBrowserFullscreen(wantFs) {
  var cur = isBrowserFullscreen();
  var target = typeof wantFs === "boolean" ? wantFs : !cur;
  playNativeVfsSfx(target ? "/audio/switch.wav" : "/audio/switch2.wav");
  if (target && !cur) {
    var root = document.documentElement;
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(root))
        .then(function () {
          syncNativeFullscreenCheckbox();
        })
        .catch(function () {
          syncNativeFullscreenCheckbox();
          showNativeOverlayText("`wOpen game in a new tab to enable Fullscreen``");
        });
    } else {
      showNativeOverlayText("`wOpen game in a new tab to enable Fullscreen``");
    }
  } else if (!target && cur) {
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      Promise.resolve(exit.call(document))
        .then(function () { syncNativeFullscreenCheckbox(); })
        .catch(function () { syncNativeFullscreenCheckbox(); });
    }
  }
}
window.toggleBrowserFullscreen = toggleBrowserFullscreen;

document.addEventListener("fullscreenchange", function () { syncNativeFullscreenCheckbox(); });
document.addEventListener("webkitfullscreenchange", function () { syncNativeFullscreenCheckbox(); });

// Synchronous DOM pointerup hit-test for FullscreenBar & check_fullscreen inside OptionsMenu:
// Proton's TouchHandlerComponent dispatches OnButtonSelected inside requestAnimationFrame,
// where strict browsers reject element.requestFullscreen() due to expired user activation.
// Firing inside the synchronous DOM pointerup gesture guarantees browser Fullscreen activation!
(function installSynchronousFullscreenCanvasHandler() {
  function getCanvasLogicalPoint(ev) {
    var canvas = document.getElementById("canvas");
    if (!canvas || !window.GameSDK || !window.GameSDK.ready) return null;
    var rect = canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    var sz = window.GameSDK.screenSize;
    return {
      x: ((ev.clientX - rect.left) / rect.width) * (sz.width || 1024),
      y: ((ev.clientY - rect.top) / rect.height) * (sz.height || 768),
      screenH: sz.height || 768
    };
  }

  function hitTestEntityBox(ent, gx, gy, padX, padY, offsetX, offsetY) {
    if (!ent || !ent.exists) return false;
    var pos = ent.position;
    var sz = ent.size;
    var w = Math.max(sz.width || 0, 90);
    var h = Math.max(sz.height || 0, 28);
    var x0 = (pos.x + (offsetX || 0)) - (padX || 0);
    var y0 = (pos.y + (offsetY || 0)) - (padY || 0);
    var x1 = (pos.x + (offsetX || 0)) + w + (padX || 0);
    var y1 = (pos.y + (offsetY || 0)) + h + (padY || 0);
    return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1;
  }

  window.addEventListener(
    "pointerup",
    function (ev) {
      try {
        if (!window.GameSDK || !window.GameSDK.ready) return;
        var root = window.GameSDK.root;
        if (!root.exists || root.find("HotkeySettingsMenu").exists) return;
        var optMenu = root.find("OptionsMenu");
        if (!optMenu.exists) return;
        var pt = getCanvasLogicalPoint(ev);
        if (!pt) return;

        var barPad = (pt.screenH * 22.0) / 768.0;
        var fsBar = optMenu.find("FullscreenBar");
        if (hitTestEntityBox(fsBar, pt.x, pt.y, barPad, barPad, 0, 0)) {
          lastDomFullscreenToggleMs = Date.now();
          toggleBrowserFullscreen();
          return;
        }

        var scroll = optMenu.find("scroll");
        var scrollChild = scroll.exists ? scroll.find("scroll_child") : null;
        var fsChk = scrollChild && scrollChild.exists ? scrollChild.find("check_fullscreen") : null;
        if (fsChk && fsChk.exists) {
          var ox = scroll.position.x + scrollChild.position.x;
          var oy = scroll.position.y + scrollChild.position.y;
          // Only match if click is within the visible scroll viewport
          var sTop = scroll.position.y;
          var sBot = sTop + (scroll.size.height || pt.screenH);
          if (pt.y >= sTop && pt.y <= sBot && hitTestEntityBox(fsChk, pt.x, pt.y, 12, 8, ox, oy)) {
            lastDomFullscreenToggleMs = Date.now();
            toggleBrowserFullscreen();
          }
        }
      } catch (_e) {}
    },
    true
  );
})();

// ============================================================================
// Pure Native Proton/WASM "HotkeySettingsMenu" (Zero HTML Overlays / Modals!)
// ============================================================================
var activeHotkeyRowEntities = [];
var savedOptionsMenuOrigin = null;

function destroyActiveHotkeyRowEntities() {
  for (var i = 0; i < activeHotkeyRowEntities.length; i++) {
    var ent = activeHotkeyRowEntities[i];
    if (ent && ent.exists) {
      ent.destroy();
    }
  }
  activeHotkeyRowEntities = [];
}

function rebuildNativeHotkeyRows() {
  if (!window.GameSDK || !window.GameSDK.ready) return;
  var root = window.GameSDK.root;
  var menu = root.find("HotkeySettingsMenu");
  if (!menu.exists) {
    nativeHotkeyMenuOpen = false;
    activeHotkeyRowEntities = [];
    return;
  }

  destroyActiveHotkeyRowEntities();

  var sz = window.GameSDK.screenSize;
  var W = sz.width || 1024;
  var H = sz.height || 768;

  var xAction = Math.round(W * 0.12);
  var xPrimary = Math.round(W * 0.44);
  var xSecondary = Math.round(W * 0.70);
  var yStart = Math.round(H * 0.22);
  var yEnd = Math.round(H * 0.78);
  var stepY = Math.max(26, Math.floor((yEnd - yStart) / PC_HOTKEY_ACTIONS.length));
  var slotPad = Math.max(4, (H * 7.5) / 768.0);

  for (var i = 0; i < PC_HOTKEY_ACTIONS.length; i++) {
    (function (act, rowIndex) {
      var rowY = yStart + rowIndex * stepY;
      var rowCfg = draftHotkeys[act.id] || { primary: "", secondary: "" };

      // Attach row labels & buttons directly to `menu` (`HotkeySettingsMenu` OverlayEntity)
      // so ClanLib/Proton TouchHandlerComponent hit-testing resolves cleanly on the full-screen menu!
      var lblEnt = menu.addLabel({
        name: act.id + "_label",
        text: "`w" + act.label + "``",
        x: xAction,
        y: rowY,
        linesPerScreenY: 23.0
      });
      activeHotkeyRowEntities.push(lblEnt);

      ["primary", "secondary"].forEach(function (slotName) {
        var slotX = slotName === "primary" ? xPrimary : xSecondary;
        var codeVal = rowCfg[slotName] || "";
        var isListening =
          listeningSlot && listeningSlot.actionId === act.id && listeningSlot.slot === slotName;
        var isSelected =
          selectedSlot && selectedSlot.actionId === act.id && selectedSlot.slot === slotName;

        var labelText;
        var frameCol = -860321793; // Official Growtopia 0xCCB887FF button frame
        if (isListening) {
          labelText = "`$Press key...``";
          frameCol = 0x3399ffee | 0;
        } else if (isSelected) {
          labelText = "`2[ " + formatKeyCodeName(codeVal) + " ]``";
          frameCol = 0x44bb66ee | 0;
        } else if (!codeVal) {
          labelText = "`oNone``";
          frameCol = 0x4a607acc | 0;
        } else {
          labelText = "`w" + formatKeyCodeName(codeVal) + "``";
        }

        var btnEnt = menu.addButton({
          name: act.id + "_" + slotName,
          text: labelText,
          x: slotX,
          y: rowY,
          linesPerScreenY: 24.5,
          maxWidth: W * 0.22 - slotPad * 2,
          framed: true,
          padding: slotPad,
          frameColor: frameCol,
          borderColor: frameCol,
          onClick: function () {
            playNativeVfsSfx("/audio/switch.wav");
            selectedSlot = { actionId: act.id, slot: slotName };
            if (isListening) {
              listeningSlot = null;
            } else {
              listeningSlot = { actionId: act.id, slot: slotName };
            }
            rebuildNativeHotkeyRows();
          }
        });
        activeHotkeyRowEntities.push(btnEnt);
      });
    })(PC_HOTKEY_ACTIONS[i], i);
  }
}

function openNativeHotkeySettingsMenu() {
  if (isMobileClient() || !window.GameSDK || !window.GameSDK.ready) return;
  var root = window.GameSDK.root;
  destroyActiveHotkeyRowEntities();
  var existing = root.find("HotkeySettingsMenu");
  if (existing.exists) existing.destroy();

  // Temporarily park OptionsMenu off-screen AND hidden so its scroll/buttons never intercept clicks!
  var optsMenu = root.find("OptionsMenu");
  if (optsMenu.exists) {
    var curPos = optsMenu.position;
    if (curPos.x > -5000 && curPos.y > -5000) {
      savedOptionsMenuOrigin = { x: curPos.x, y: curPos.y };
    } else if (!savedOptionsMenuOrigin) {
      savedOptionsMenuOrigin = { x: 0, y: 0 };
    }
    optsMenu._applyPosNow(-10000, -10000);
    optsMenu._applyVisibleNow(false);
  }

  playNativeVfsSfx("/audio/switch.wav");
  draftHotkeys = cloneHotkeys(activeHotkeys);
  selectedSlot = null;
  listeningSlot = null;
  draftDirty = false;
  nativeHotkeyMenuOpen = true;

  var sz = window.GameSDK.screenSize;
  var W = sz.width || 1024;
  var H = sz.height || 768;

  var menu = root.addOverlayBg({
    name: "HotkeySettingsMenu",
    file: "interface/large/generic_menu2.rttex",
    x: 0,
    y: 0,
    width: W,
    height: H
  });

  menu.addLabel({
    name: "hotkey_title",
    text: "`wHotkey Settings``",
    x: Math.round(W * 0.12),
    y: Math.round(H * 0.045),
    bigFont: true,
    linesPerScreenY: 13.5
  });

  menu.addLabel({
    name: "hotkey_subtitle",
    text: "`oSet which keys you want to be used.``",
    x: Math.round(W * 0.12),
    y: Math.round(H * 0.12),
    linesPerScreenY: 25.0
  });

  menu.addLabel({
    name: "primary_label",
    text: "`6Primary: ``",
    x: Math.round(W * 0.44),
    y: Math.round(H * 0.165),
    linesPerScreenY: 22.0
  });

  menu.addLabel({
    name: "secondary_label",
    text: "`6Secondary: ``",
    x: Math.round(W * 0.70),
    y: Math.round(H * 0.165),
    linesPerScreenY: 22.0
  });

  rebuildNativeHotkeyRows();

  var yBottom = H - Math.trunc((H * 40) / 320);

  menu.addButton({
    name: "HotkeyContinue",
    text: "Back",
    x: Math.round(W * 0.08),
    y: yBottom,
    linesPerScreenY: 14.0,
    framed: true,
    bob: true,
    onClick: function () {
      closeNativeHotkeySettingsMenu(false);
    }
  });

  menu.addButton({
    name: "HotkeyClear",
    text: "Clear",
    x: Math.round(W * 0.36),
    y: yBottom,
    linesPerScreenY: 14.0,
    framed: true,
    bob: true,
    onClick: function () {
      if (!selectedSlot) {
        playNativeVfsSfx("/audio/switch2.wav");
        showNativeOverlayText("`wSelect a Primary or Secondary slot first``");
        return;
      }
      draftHotkeys[selectedSlot.actionId][selectedSlot.slot] = "";
      listeningSlot = null;
      draftDirty = true;
      playNativeVfsSfx("/audio/switch2.wav");
      rebuildNativeHotkeyRows();
    }
  });

  menu.addButton({
    name: "HotkeyReset",
    text: "Reset",
    x: Math.round(W * 0.55),
    y: yBottom,
    linesPerScreenY: 14.0,
    framed: true,
    bob: true,
    onClick: function () {
      draftHotkeys = cloneHotkeys(DEFAULT_PC_HOTKEYS);
      listeningSlot = null;
      draftDirty = true;
      playNativeVfsSfx("/audio/switch.wav");
      rebuildNativeHotkeyRows();
      showNativeOverlayText("`wDefault hotkeys restored``");
    }
  });

  menu.addButton({
    name: "HotkeySave",
    text: "Save",
    x: Math.round(W * 0.76),
    y: yBottom,
    linesPerScreenY: 14.0,
    framed: true,
    bob: true,
    onClick: function () {
      activeHotkeys = cloneHotkeys(draftHotkeys);
      persistHotkeys(activeHotkeys);
      draftDirty = false;
      listeningSlot = null;
      playNativeVfsSfx("/audio/switch.wav");
      rebuildNativeHotkeyRows();
      showNativeOverlayText("Changes saved");
    }
  });

  menu.slide(true, 380, 0);
}
window.openHotkeySettingsModal = openNativeHotkeySettingsMenu;

function closeNativeHotkeySettingsMenu(fromSave) {
  nativeHotkeyMenuOpen = false;
  listeningSlot = null;
  selectedSlot = null;
  playNativeVfsSfx("/audio/switch2.wav");

  destroyActiveHotkeyRowEntities();
  if (window.GameSDK && window.GameSDK.ready) {
    var root = window.GameSDK.root;
    var menu = root.find("HotkeySettingsMenu");
    if (menu.exists) {
      menu.destroy();
    }
    var optsMenu = root.find("OptionsMenu");
    if (optsMenu.exists) {
      var restorePos = savedOptionsMenuOrigin || { x: 0, y: 0 };
      optsMenu._applyPosNow(restorePos.x, restorePos.y);
      optsMenu._applyVisibleNow(true);
    }
  }
  savedOptionsMenuOrigin = null;

  if (!fromSave && draftDirty) {
    showNativeOverlayText("Changes `4not saved``");
  }
  draftDirty = false;

  var canvas = document.getElementById("canvas");
  if (canvas) canvas.focus();
}
window.closeHotkeySettingsModal = closeNativeHotkeySettingsMenu;

function findActionForPhysicalCode(code) {
  for (var i = 0; i < PC_HOTKEY_ACTIONS.length; i++) {
    var act = PC_HOTKEY_ACTIONS[i];
    var cfg = activeHotkeys[act.id];
    if (!cfg) continue;
    if (cfg.primary === code || cfg.secondary === code) {
      return act;
    }
    if (code === "NumpadEnter" && (cfg.primary === "Enter" || cfg.secondary === "Enter")) {
      return act;
    }
    if (code === "ControlRight" && (cfg.primary === "ControlLeft" || cfg.secondary === "ControlLeft")) {
      return act;
    }
  }
  return null;
}

// Verify that gameplay is actively focused in a world AND no chat/dialog/menu input is open!
function isNativeGameplayInputActive() {
  if (isMobileClient()) return false;
  var active = document.activeElement;
  if (active && (active.id === "textInput" || active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
    return false;
  }
  // SDL.textInput is an enabled subsystem, not proof that a text field has focus.
  if (typeof window._JLIB_IsTextInputFocused === "function" && window._JLIB_IsTextInputFocused()) {
    return false;
  }
  if (!window.GameSDK || !window.GameSDK.ready) {
    return false;
  }
  var root = window.GameSDK.root;
  if (!root.exists) return false;
  // Verified against ReGrowtopia-1.50.wasm @ VA 72753: active world HUD entity is "WorldSpecificGUI"!
  if (!root.find("WorldSpecificGUI").exists) return false;
  // Never remap while chat bar, any popup dialog, PauseMenu, OptionsMenu, StoreMenu, or HotkeySettingsMenu is open!
  var blockingEntities = [
    "MainMenu",
    "ConsoleInputBox",
    // InputMenu is a persistent root input router, not an open text field.
    "FilterInput",
    "DialogParent",
    "GenericDialog",
    "PauseMenu",
    "OptionsMenu",
    "OnlineMenu",
    "WorldSelectMenu",
    "HotkeySettingsMenu",
    "StoreMenu",
    "ConfirmMenu"
  ];
  for (var i = 0; i < blockingEntities.length; i++) {
    var blocker = root.find(blockingEntities[i]);
    if (blocker.exists && blocker.visible) {
      return false;
    }
  }
  return true;
}

// Pinned client Lua SetItemSelected -> func731/table1724. Select by item ID,
// never Digit1/Digit2: those choose visible inventory slots, which can be reordered.
var consumedToolToggleKeys = Object.create(null);
function toggleNativeFistWrench() {
  if (!Module || !Module.wasmTable || !Module.HEAPU32) return false;
  var app = Module.HEAPU32[393364 >> 2];
  var logic = app && Module.HEAPU32[(app + 1800) >> 2];
  if (!logic || !Module.HEAPU32[(logic + 108) >> 2] || !Module.HEAPU32[(logic + 140) >> 2]) return false;
  var current = Module.HEAPU32[(logic + 288) >> 2];
  Module.wasmTable.get(1724)(logic, current === 32 ? 18 : 32);
  return true;
}

function handlePcKeyboardIntercept(e) {
  // Release using the mapping recorded at keydown, even if a menu opened meanwhile.
  if (e.type === "keyup" && activePhysicalToVirtual[e.code]) {
    var held = activePhysicalToVirtual[e.code];
    delete activePhysicalToVirtual[e.code];
    applyVirtualKeyOverride(e, held.keyCode, held.key, held.code);
    return;
  }
  var hkMenuVisible =
    nativeHotkeyMenuOpen &&
    window.GameSDK &&
    window.GameSDK.ready &&
    window.GameSDK.root.find("HotkeySettingsMenu").exists;

  if (hkMenuVisible) {
    e.stopImmediatePropagation();
    if (e.type === "keydown") {
      e.preventDefault();
      if (listeningSlot) {
        var newCode = e.code;
        if (!newCode) return;
        if (newCode === "Escape") {
          listeningSlot = null;
          playNativeVfsSfx("/audio/switch2.wav");
          rebuildNativeHotkeyRows();
          return;
        }
        // Remove duplicate key from any other slot in draftHotkeys
        for (var i = 0; i < PC_HOTKEY_ACTIONS.length; i++) {
          var id = PC_HOTKEY_ACTIONS[i].id;
          if (draftHotkeys[id].primary === newCode) draftHotkeys[id].primary = "";
          if (draftHotkeys[id].secondary === newCode) draftHotkeys[id].secondary = "";
        }
        draftHotkeys[listeningSlot.actionId][listeningSlot.slot] = newCode;
        selectedSlot = { actionId: listeningSlot.actionId, slot: listeningSlot.slot };
        listeningSlot = null;
        draftDirty = true;
        playNativeVfsSfx("/audio/switch.wav");
        rebuildNativeHotkeyRows();
      } else if (e.code === "Escape") {
        closeNativeHotkeySettingsMenu(false);
      }
    }
    return;
  } else if (nativeHotkeyMenuOpen) {
    nativeHotkeyMenuOpen = false;
    listeningSlot = null;
  }

  var code = e.code;
  if (!code) return;
  if (e.type === "keyup" && consumedToolToggleKeys[code]) {
    delete consumedToolToggleKeys[code];
    e.preventDefault(); e.stopImmediatePropagation(); return;
  }


  // F11 convenience fullscreen shortcut on PC (works anywhere!)
  if (code === "F11" && !isMobileClient()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "keydown" && !e.repeat) toggleBrowserFullscreen();
    return;
  }

  // CRITICAL FIX: Never remap keys in chat, GrowID, /find, signs, doors, or menus!
  // (Eliminates Space -> "w" or any custom keybind leaking into text input!)
  if (!isNativeGameplayInputActive()) {
    if (e.type === "keyup" && activePhysicalToVirtual[code]) {
      var rel = activePhysicalToVirtual[code];
      delete activePhysicalToVirtual[code];
      applyVirtualKeyOverride(e, rel.keyCode, rel.key, rel.code);
    }
    return;
  }

  // On keyup, if this physical key had a remapped virtual key active, release that exact virtual key!
  if (e.type === "keyup" && activePhysicalToVirtual[code]) {
    var released = activePhysicalToVirtual[code];
    delete activePhysicalToVirtual[code];
    applyVirtualKeyOverride(e, released.keyCode, released.key, released.code);
    return;
  }

  var matched = findActionForPhysicalCode(code);
  if (matched) {
    if (code === "Tab" || code === "Space" || code.indexOf("Arrow") === 0) {
      e.preventDefault();
    }
    if (matched.id === "toggle_wrench") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === "keydown") {
        consumedToolToggleKeys[code] = true;
        if (!e.repeat) toggleNativeFistWrench();
      }
      return;
    }

    var vTarget = {
      keyCode: matched.targetKeyCode,
      key: matched.targetKey,
      code: matched.targetCode
    };
    if (e.type === "keydown") {
      activePhysicalToVirtual[code] = vTarget;
    }
    if (code !== vTarget.code || e.keyCode !== vTarget.keyCode) {
      applyVirtualKeyOverride(e, vTarget.keyCode, vTarget.key, vTarget.code);
    }
    return;
  }

  // If this physical key is one of WASM's hardcoded action keys (WASD/Arrows/Space/Ctrl/Esc/Enter/Tab)
  // AND the user unbound/rebound it away in Hotkey Settings, block it ONLY during active gameplay!
  if (NATIVE_ENGINE_ACTION_CODES[code]) {
    if (code === "Tab" || code === "Space") e.preventDefault();
    e.stopImmediatePropagation();
  }
}

function applyVirtualKeyOverride(e, keyCode, keyStr, codeStr) {
  try {
    Object.defineProperties(e, {
      keyCode:  { get: function () { return keyCode; }, configurable: true },
      which:    { get: function () { return keyCode; }, configurable: true },
      charCode: { get: function () { return keyStr === " " ? 32 : 0; }, configurable: true },
      key:      { get: function () { return keyStr; }, configurable: true },
      code:     { get: function () { return codeStr; }, configurable: true }
    });
  } catch (_err) {}
}

window.addEventListener("keydown", handlePcKeyboardIntercept, true);
window.addEventListener("keyup", handlePcKeyboardIntercept, true);
window.addEventListener("blur", function () {
  activePhysicalToVirtual = {};
});
document.addEventListener("visibilitychange", function () {
  if (document.hidden) activePhysicalToVirtual = {};
});

// ============================================================================
// 6. Native WASM OptionsMenu Integration (Fullscreen mode + PC Edit Hotkeys)
//    Verified instruction-by-instruction against ReGrowtopia-1.50.wasm:
//      TABLE[117]  = operator new(size)
//      TABLE[1028] = operator delete(ptr)
//      TABLE[565]  = Entity::GetEntityByName(pEnt, pStdStr) -> Entity*
//      TABLE[625]  = VariantDB::GetVar(pVarDb, pStdStr) -> Variant*
//      TABLE[637]  = Entity::GetComponentByName(pEnt, pStdStr, bAlsoParents) -> Component*
//      TABLE[655]  = SetupTextEntity(pEnt, fontID, fontScale)
//      TABLE[656]  = CreateCheckbox(pParent, pName, pText, x, y, bChecked, fontID, scale, unclickable)
//      TABLE[1582] = CreateTextButtonEntity(pParent, pName, x, y, pText, bUnderline)
//      TABLE[539]  = VariantDB::GetFunctionByName(pVarDb, pStdStr) -> FunctionObject*
//      TABLE[626..628] = boost::signals::connect(&OptionsMenuOnSelect)
//      TABLE[2023] = GetFontAndScaleToFitThisLinesPerScreenY(&fontID, &fontScale, lines)
//      TABLE[1375] = ResizeScrollBounds(VariantList*)
//      TABLE[1501] = OptionsMenuCreate(pParentEnt, bFromMainMenu) -> pOptionsMenuEnt
//      TABLE[2222] = OptionsMenuOnSelect(VariantList*)
// ============================================================================
function installNativeOptionsMenuHooks() {
  if (!Module || typeof Module.hookWasmTable !== "function" || !Module.wasmTable) return;
  var tbl = Module.wasmTable;
  var utf8Enc = new TextEncoder();
  var utf8Dec = new TextDecoder("utf-8");

  var scratchPtr = 0;
  var currentFullscreenCheckboxEnt = 0;

  function getScratch() {
    if (!scratchPtr) {
      scratchPtr = tbl.get(117)(256); // Allocated lazily after mainf starts!
    }
    return scratchPtr;
  }

  function readStdString(sPtr) {
    if (!sPtr) return "";
    var u8 = Module.HEAPU8;
    var u32 = Module.HEAPU32;
    var tag = u8[sPtr + 11];
    if ((tag & 0x80) === 0) {
      var len = tag & 0x7f;
      if (len > 11) return "";
      return utf8Dec.decode(u8.slice(sPtr, sPtr + len));
    }
    var dataPtr = u32[sPtr >> 2];
    var longLen = u32[(sPtr + 4) >> 2];
    if (!dataPtr || longLen > 512) return "";
    return utf8Dec.decode(u8.slice(dataPtr, dataPtr + longLen));
  }

  function writeStdString(sPtr, str) {
    var bytes = utf8Enc.encode(str);
    var u8 = Module.HEAPU8;
    var u32 = Module.HEAPU32;
    u32[sPtr >> 2] = 0;
    u32[(sPtr + 4) >> 2] = 0;
    u32[(sPtr + 8) >> 2] = 0;
    if (bytes.length <= 10) {
      u8.set(bytes, sPtr);
      u8[sPtr + 11] = bytes.length;
    } else {
      var cap = (bytes.length + 16) & ~15;
      var buf = tbl.get(117)(cap);
      u8 = Module.HEAPU8;
      u32 = Module.HEAPU32;
      u8.set(bytes, buf);
      u8[buf + bytes.length] = 0;
      u32[sPtr >> 2] = buf;
      u32[(sPtr + 4) >> 2] = bytes.length;
      u32[(sPtr + 8) >> 2] = (cap | 0x80000000) >>> 0;
    }
  }

  function freeStdString(sPtr) {
    var u8 = Module.HEAPU8;
    var u32 = Module.HEAPU32;
    if ((u8[sPtr + 11] & 0x80) !== 0) {
      var buf = u32[sPtr >> 2];
      if (buf) tbl.get(1028)(buf);
      u32 = Module.HEAPU32;
    }
    u32[sPtr >> 2] = 0;
    u32[(sPtr + 4) >> 2] = 0;
    u32[(sPtr + 8) >> 2] = 0;
  }

  function getEntityByName(pParent, name) {
    if (!pParent) return 0;
    var s = getScratch();
    writeStdString(s, name);
    var res = tbl.get(565)(pParent, s);
    freeStdString(s);
    return res;
  }

  function getVar(pVarDb, varName) {
    if (!pVarDb) return 0;
    var s = getScratch();
    writeStdString(s, varName);
    var res = tbl.get(625)(pVarDb, s);
    freeStdString(s);
    return res;
  }

  function connectButtonToTargetSlot(pBtnEnt, targetTableSlot) {
    if (!pBtnEnt || !targetTableSlot) return;
    var s = getScratch();
    writeStdString(s, "OnButtonSelected");
    var pFuncObj = tbl.get(539)(pBtnEnt + 76, s);
    freeStdString(s);
    if (!pFuncObj) return;

    // Verified against ReGrowtopia-1.50.wasm Func #2569 @ 31979..31988:
    // sizeof(boost::signals::slot) == 36 bytes (0..35); connResult MUST be at +40, NOT +24!
    var slotHolder = tbl.get(117)(64);
    var rawNode = tbl.get(117)(24);
    var u32 = Module.HEAPU32;
    for (var i = 0; i < 16; i++) u32[(slotHolder >> 2) + i] = 0;
    for (var j = 0; j < 6; j++) u32[(rawNode >> 2) + j] = 0;

    u32[(slotHolder + 8) >> 2] = 277397;
    u32[(slotHolder + 12) >> 2] = targetTableSlot;
    tbl.get(626)(slotHolder, rawNode);
    tbl.get(627)(slotHolder);
    tbl.get(628)(slotHolder + 40, pFuncObj, slotHolder, 0);
  }

  function connectButtonToOptionsMenu(pBtnEnt) {
    connectButtonToTargetSlot(pBtnEnt, 2222);
  }

  function setCheckboxCheckedVar(pCheckboxEnt, checked) {
    if (!pCheckboxEnt) return;
    var v = getVar(pCheckboxEnt + 76, "checked");
    if (!v) return;
    var u32 = Module.HEAPU32;
    u32[v >> 2] = 5; // TYPE_UINT32
    u32[(v + 8) >> 2] = checked ? 1 : 0;
    var sig = u32[(v + 36) >> 2];
    if (sig) {
      // Trigger Variant::m_sig_onChanged (TABLE[536]) so checkbox frame updates immediately!
      tbl.get(536)(sig, v);
    }
  }

  syncNativeFullscreenCheckbox = function () {
    try {
      if (currentFullscreenCheckboxEnt) {
        setCheckboxCheckedVar(currentFullscreenCheckboxEnt, isBrowserFullscreen());
      }
    } catch (_e) {}
  };

  // Hook 1: ResizeScrollBounds (TABLE[1375], sig "vi") — inject native Fullscreen mode checkbox
  // (+ PC Edit Hotkeys button) at the bottom of OptionsMenu's scroll_child
  var inResizeHook = false;
  var origResizeScrollBounds = Module.hookWasmTable(
    1375,
    function (pVList) {
      origResizeScrollBounds(pVList);
      if (inResizeHook || !pVList) return;
      try {
        var pEnt = Module.HEAPU32[(pVList + 4) >> 2];
        if (!pEnt || readStdString(pEnt + 40) !== "OptionsMenu") return;
        var pScroll = getEntityByName(pEnt, "scroll");
        var pScrollChild = getEntityByName(pScroll, "scroll_child");
        if (!pScroll || !pScrollChild) return;
        if (getEntityByName(pScrollChild, "check_fullscreen")) return;

        inResizeHook = true;
        try {
          var baseScratch = getScratch();
          var vScrollSize = getVar(pScroll + 76, "size2d");
          var scrollH = vScrollSize ? Module.HEAPF32[(vScrollSize + 12) >> 2] : 300;

          var sComp = baseScratch + 64;
          writeStdString(sComp, "Scroll");
          var pScrollComp = tbl.get(637)(pScroll, sComp, 0);
          freeStdString(sComp);

          var boundsTop = 0;
          if (pScrollComp) {
            var vBounds = getVar(pScrollComp + 36, "boundsRect");
            if (vBounds) boundsTop = Module.HEAPF32[(vBounds + 12) >> 2];
          }
          var currentBottomY = scrollH - boundsTop;

          var pChkSwear = getEntityByName(pScrollChild, "check_swear");
          var xChk = 24;
          if (pChkSwear) {
            var vPos = getVar(pChkSwear + 76, "pos2d");
            if (vPos) xChk = Module.HEAPF32[(vPos + 8) >> 2];
          }

          // Compute exact OptionsMenu checkbox fontID & fontScale via TABLE[2023]
          var fontOut = baseScratch + 96;
          Module.HEAP32[fontOut >> 2] = 0;
          Module.HEAPF32[(fontOut + 4) >> 2] = 1.0;
          tbl.get(2023)(fontOut, fontOut + 4, 20.0);
          var chkFontId = Module.HEAP32[fontOut >> 2];
          var chkFontScale = Module.HEAPF32[(fontOut + 4) >> 2];

          var screenH = Module.HEAP32[392496 >> 2] || 600;
          var rowStep = Math.max(28, Math.trunc((screenH * 22) / 320));
          var yFs = currentBottomY + Math.max(16, Math.trunc(rowStep * 0.55));

          // 1. Native WASM Checkbox: "Fullscreen mode"
          var sName = baseScratch + 112;
          var sText = baseScratch + 128;
          writeStdString(sName, "check_fullscreen");
          writeStdString(sText, "Fullscreen mode");
          var pFsChk = tbl.get(656)(
            pScrollChild,
            sName,
            sText,
            xChk,
            yFs,
            isBrowserFullscreen() ? 1 : 0,
            chkFontId,
            chkFontScale,
            0
          );
          freeStdString(sName);
          freeStdString(sText);
          if (pFsChk) {
            currentFullscreenCheckboxEnt = pFsChk;
            connectButtonToOptionsMenu(pFsChk);
          }

          // 2. Native WASM Button inside scroll_child (PC/Desktop ONLY): "Edit Hotkeys"
          if (!isMobileClient()) {
            var yHk = yFs + rowStep + 8;
            writeStdString(sName, "HotkeySettings");
            writeStdString(sText, "Edit Hotkeys");
            var pHkBtn = tbl.get(1582)(pScrollChild, sName, xChk, yHk, sText, 1);
            freeStdString(sName);
            freeStdString(sText);
            if (pHkBtn) {
              tbl.get(655)(pHkBtn, chkFontId, chkFontScale);
              connectButtonToOptionsMenu(pHkBtn);
            }
          }

          // Recompute scroll bounds so OptionsMenu scrolls smoothly to our new controls!
          origResizeScrollBounds(pVList);
        } finally {
          inResizeHook = false;
        }
      } catch (err) {
        console.warn("[Client] OptionsMenu scroll hook error:", err);
      }
    },
    "vi"
  );

  // Hook 2: OptionsMenuCreate (TABLE[1501], sig "iii") — add quick-access bottom-bar button(s)
  // right alongside "Back" so PC users see "Edit Hotkeys" & "Fullscreen" immediately!
  var origOptionsMenuCreate = Module.hookWasmTable(
    1501,
    function (pParentEnt, bFromMainMenu) {
      var pOptionsEnt = origOptionsMenuCreate(pParentEnt, bFromMainMenu);
      if (!pOptionsEnt) return pOptionsEnt;
      try {
        var baseScratch = getScratch();
        var screenW = Module.HEAP32[392500 >> 2] || 1024;
        var screenH = Module.HEAP32[392496 >> 2] || 768;
        var yBottom = screenH - Math.trunc((screenH * 40) / 320);

        // Exact bottom-bar button font & scale from Func #2569 @ 13501..13872
        var fontOut = baseScratch + 96;
        Module.HEAP32[fontOut >> 2] = 1;
        var initScale = tbl.get(2299)(1, 1.0, 6.6);
        Module.HEAPF32[(fontOut + 4) >> 2] = initScale;
        tbl.get(2023)(fontOut, fontOut + 4, 13.0);
        var barFontId = Module.HEAP32[fontOut >> 2];
        var barFontScale = Module.HEAPF32[(fontOut + 4) >> 2];

        var sName = baseScratch + 112;
        var sText = baseScratch + 128;
        var barPad = (screenH * 20.0) / 768.0;

        var styleNativeBottomBarBtn = function (pBtn) {
          if (!pBtn) return;
          tbl.get(655)(pBtn, barFontId, barFontScale);
          tbl.get(2039)(pBtn, -860321793, -860321793, barPad, 1, barFontScale, barFontId);
          tbl.get(2037)(pBtn, 150);
          tbl.get(2029)(pBtn, 1);
          connectButtonToOptionsMenu(pBtn);
        };

        if (!isMobileClient()) {
          // PC/Desktop: framed "Edit Hotkeys" + "Fullscreen" on the bottom bar opposite "Back"
          var xHotkeys = Math.trunc((screenW * 165) / 480);
          writeStdString(sName, "HotkeySettingsBar");
          writeStdString(sText, "Edit Hotkeys");
          var pBarHk = tbl.get(1582)(pOptionsEnt, sName, xHotkeys, yBottom, sText, 0);
          freeStdString(sName);
          freeStdString(sText);
          styleNativeBottomBarBtn(pBarHk);

          var xFsPc = Math.trunc((screenW * 335) / 480);
          writeStdString(sName, "FullscreenBar");
          writeStdString(sText, "Fullscreen");
          var pBarFs = tbl.get(1582)(pOptionsEnt, sName, xFsPc, yBottom, sText, 0);
          freeStdString(sName);
          freeStdString(sText);
          styleNativeBottomBarBtn(pBarFs);
        } else {
          // Mobile: ONLY framed "Fullscreen" (Edit Hotkeys is strictly PC-only!)
          var xFsMob = Math.trunc((screenW * 315) / 480);
          writeStdString(sName, "FullscreenBar");
          writeStdString(sText, "Fullscreen");
          var pBarFsMob = tbl.get(1582)(pOptionsEnt, sName, xFsMob, yBottom, sText, 0);
          freeStdString(sName);
          freeStdString(sText);
          styleNativeBottomBarBtn(pBarFsMob);
        }
      } catch (err) {
        console.warn("[Client] OptionsMenuCreate hook error:", err);
      }
      return pOptionsEnt;
    },
    "iii"
  );

  // Hook 3: OptionsMenuOnSelect (TABLE[2222], sig "vi") — handle clicks on our native OptionsMenu controls
  var origOptionsMenuOnSelect = Module.hookWasmTable(
    2222,
    function (pVList) {
      try {
        if (pVList) {
          var pClickedEnt = Module.HEAPU32[(pVList + 44) >> 2];
          if (pClickedEnt) {
            var name = readStdString(pClickedEnt + 40);
            if (name === "check_fullscreen") {
              currentFullscreenCheckboxEnt = pClickedEnt;
              if (Date.now() - lastDomFullscreenToggleMs < 450) {
                syncNativeFullscreenCheckbox();
                return;
              }
              var vChk = getVar(pClickedEnt + 76, "checked");
              var want = vChk ? Module.HEAPU32[(vChk + 8) >> 2] !== 0 : !isBrowserFullscreen();
              toggleBrowserFullscreen(want);
              return;
            }
            if (name === "FullscreenBar") {
              if (Date.now() - lastDomFullscreenToggleMs < 450) {
                syncNativeFullscreenCheckbox();
                return;
              }
              toggleBrowserFullscreen();
              return;
            }
            if (name === "HotkeySettings" || name === "HotkeySettingsBar") {
              openNativeHotkeySettingsMenu();
              return;
            }
            if (name === "Back") {
              currentFullscreenCheckboxEnt = 0;
            }
          }
        }
      } catch (err) {
        console.warn("[Client] OptionsMenuOnSelect hook error:", err);
      }
      origOptionsMenuOnSelect(pVList);
    },
    "vi"
  );

  // Hook 4: OnlineMenuCreate (TABLE[1499], sig "ii") & OnlineMenuOnSelect (TABLE[2103], sig "vi")
  // Keeps pure native OnlineMenu ("Back" + "Connect" + "I have a GrowID") and syncs Save.dat to IDBFS!
  var origOnlineMenuCreate = Module.hookWasmTable(
    1499,
    function (pParentEnt) {
      var pOnlineEnt = origOnlineMenuCreate(pParentEnt);
      if (!pOnlineEnt) return pOnlineEnt;
      try {
        // Pre-fill saved Guest base name if online_name_input_box is empty
        var pNameBox = getEntityByName(pOnlineEnt, "online_name_input_box");
        var savedGuest = getSavedGuestDisplayName();
        if (pNameBox && savedGuest) {
          var vTxt = getVar(pNameBox + 76, "text");
          if (vTxt && Module.HEAPU32[vTxt >> 2] === 2) {
            var curName = readStdString(vTxt + 24);
            if (!curName) {
              writeStdString(vTxt + 24, savedGuest);
              var sigTxt = Module.HEAPU32[(vTxt + 36) >> 2];
              if (sigTxt) tbl.get(536)(sigTxt, vTxt);
            }
          }
        }
      } catch (errOnline) {
        console.warn("[Client] OnlineMenuCreate hook error:", errOnline);
      }
      return pOnlineEnt;
    },
    "ii"
  );

  var origOnlineMenuOnSelect = Module.hookWasmTable(
    2103,
    function (pVList) {
      try {
        if (pVList) {
          var pClickedEnt = Module.HEAPU32[(pVList + 44) >> 2];
          if (pClickedEnt) {
            var name = readStdString(pClickedEnt + 40);
            var pApp = tbl.get(600)();
            var pRoot = pApp ? (pApp + 1620) >>> 0 : 0;
            var pOnline = pRoot ? getEntityByName(pRoot, "OnlineMenu") : 0;

            if (name === "Start" && pOnline) {
              var pNameBox2 = getEntityByName(pOnline, "online_name_input_box");
              if (pNameBox2) {
                var vTxt2 = getVar(pNameBox2 + 76, "text");
                if (vTxt2 && Module.HEAPU32[vTxt2 >> 2] === 2) {
                  var typed = readStdString(vTxt2 + 24).trim().replace(/_\d{3,4}$/, "");
                  if (typed) saveGuestDisplayName(typed);
                }
              }
              origOnlineMenuOnSelect(pVList);
              flushNativeSaveDat();
              return;
            }
          }
        }
      } catch (errOnSel) {
        console.warn("[Client] OnlineMenuOnSelect hook error:", errOnSel);
      }
      origOnlineMenuOnSelect(pVList);
    },
    "vi"
  );

  if (window.GameSDK && typeof window.GameSDK.onPacket === "function") {
    window.GameSDK.onPacket("SetHasGrowID", function () {
      setTimeout(flushNativeSaveDat, 120);
    });
  }
}

// ============================================================================
// 7. Proton File Uploader & Downloader Bridges
// ============================================================================
(function () {
  var up = document.createElement("input");
  up.type = "file";
  up.style.display = "none";
  up.id = "uploader";
  up.onchange = previewFile;
  document.body.appendChild(up);
})();

function previewFile() {
  var input = document.querySelector("input[type=file]");
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onloadend = function () {
    var fileName = file.name;
    var data = new Uint8Array(reader.result);
    var outFileName = "proton_temp.tmp";
    try {
      Module["FS_unlink"]("/" + outFileName);
    } catch (_err) {}
    Module["FS_createDataFile"]("/", outFileName, data, true, true, true);
    input.value = "";
    var void_guiMessage = Module.cwrap("PROTON_GUIMessage", null, ["number", "number", "string"]);
    void_guiMessage(53, 0, fileName);
  };
  reader.readAsArrayBuffer(file);
}

function saveFileFromMemoryFSToDisk(memoryFSname, localFSname) {
  var data = FS.readFile(memoryFSname);
  var blob = new Blob([data.buffer], { type: "application/octet-stream" });
  var a = document.createElement("a");
  var url = URL.createObjectURL(blob);
  a.href = url;
  a.download = localFSname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
    a.remove();
  }, 5000);
}

// ============================================================================
// 8. Persistent Guest Account Identity & Emscripten Module Configuration
// ============================================================================
var CLIENT_DEVICE_STORAGE_KEY = "gt_client_device_id_v1";
var GUEST_NAME_STORAGE_KEY = "gt_guest_name_v1";

function getOrCreateClientDeviceId() {
  try {
    var existing = localStorage.getItem(CLIENT_DEVICE_STORAGE_KEY);
    if (existing && /^[a-f0-9]{16,64}$/i.test(existing)) {
      return existing.toLowerCase();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (var j = 0; j < bytes.length; j++) {
      hex += ("0" + bytes[j].toString(16)).slice(-2);
    }
    localStorage.setItem(CLIENT_DEVICE_STORAGE_KEY, hex);
    return hex;
  } catch (_e) {
    return "guest_fallback_device";
  }
}

function getSavedGuestDisplayName() {
  try {
    var saved = localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "";
    return saved.replace(/[^A-Za-z0-9_]/g, "").slice(0, 10);
  } catch (_e) {
    return "";
  }
}

function saveGuestDisplayName(name) {
  try {
    var clean = String(name || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 10);
    if (clean) localStorage.setItem(GUEST_NAME_STORAGE_KEY, clean);
  } catch (_e) {}
}

function getOrCreateGuestDisplayName() {
  var saved = getSavedGuestDisplayName();
  if (saved) return saved;
  var generated = "Guest" + String(1000 + Math.floor(Math.random() * 9000));
  saveGuestDisplayName(generated);
  return generated;
}

function flushNativeSaveDat() {
  try {
    var fsApi = typeof FS !== "undefined" ? FS : Module && Module.FS;
    if (fsApi && typeof fsApi.syncfs === "function") {
      fsApi.syncfs(false, function () {});
    }
  } catch (_e) {}
}

window.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") flushNativeSaveDat();
});
window.addEventListener("pagehide", flushNativeSaveDat);

var CLIENT_DEVICE_ID = getOrCreateClientDeviceId();
var loaderEl = document.getElementById("loader");
var wsProto = window.location.protocol === "https:" ? "wss://" : "ws://";

var Module = {
  instantiateWasm: function(imports, done) { return NativeChatHeads.instantiate(imports, done); },
  spoofHostname: "play.creativeps.eu",
  // Force SDL_mixer onto true WebAudio API (32-channel overlapping SFX + 3D spatial panner)
  // instead of preloading 570 broken HTMLAudioElement objects!
  noAudioDecoding: true,
  locateFile: function (path, prefix) {
    if (path.endsWith(".wasm")) return "/client/" + path;
    if (path.endsWith(".data")) {
      return "/client/" + path;
    }
    return (prefix || "") + path;
  },
  websocket: {
    url: wsProto + window.location.host + "/enet?cid=" + encodeURIComponent(CLIENT_DEVICE_ID),
    subprotocol: "binary"
  },
  preRun: [
    function () {
      if (typeof addRunDependency === "function") {
        addRunDependency("custom_splashes_txt");
      }
      fetch("/splashes.txt?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) {
          return r.ok ? r.text() : "";
        })
        .then(function (txt) {
          customSplashLines = parseSplashLines(txt);
        })
        .catch(function () {
          customSplashLines = [];
        })
        .finally(function () {
          if (typeof removeRunDependency === "function") {
            removeRunDependency("custom_splashes_txt");
          }
        });
    }
  ],
  setStatus: function (text) {
    if (!loaderEl) loaderEl = document.getElementById("loader");
    if (!loaderEl) return;
    var progress = loaderEl.querySelector(".progress");
    var loadingText = loaderEl.querySelector(".loadingtext");
    var spinner = loaderEl.querySelector(".spinner");

    if (!Module.progress && progress) {
      progress.style.display = "block";
      Module.progress = progress.querySelector(".full");
      if (spinner) spinner.style.display = "none";
      if (Module.progress) Module.progress.style.transform = "scaleX(0)";
    }

    var m = text && text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
    if (m) {
      var cur = parseFloat(m[2]);
      var max = parseFloat(m[4]);
      if (loadingText) {
        var mbCur = (cur / 1048576).toFixed(1);
        var mbMax = (max / 1048576).toFixed(1);
        loadingText.textContent = "Downloading " + SERVER_CONFIG.serverName + " client assets... (" + mbCur + " MB / " + mbMax + " MB)";
      }
      if (Module.progress && max > 0) {
        Module.progress.style.transform = "scaleX(" + Math.min(1, cur / max) + ")";
      }
    } else if (!text) {
      loaderEl.style.display = "none";
    } else if (loadingText) {
      loadingText.textContent = text;
    }
  },
  print: function (text) {
    console.log(">> " + text);
  },
  printErr: function (text) {
    console.warn(appName + ": " + text);
  },
  onAbort: function (reason) { showClientStartupError("Client gagal dimulai: " + String(reason)); },
  onRuntimeInitialized: function () {
    window.__clientRuntimeReady = true;
    if (!loaderEl) loaderEl = document.getElementById("loader");
    if (loaderEl) {
      var spinner = loaderEl.querySelector(".spinner");
      if (spinner) spinner.style.display = "none";
      loaderEl.style.display = "none";
    }

    // 1. Install server branding/background + missing VFS /audio/*.wav aliases
    try {
      installVfsPatches();
      if (globalThis.ServerBranding) globalThis.ServerBranding.attachUi(window.GameSDK);
    } catch (errVfs) {
      console.warn("[Client] installVfsPatches error:", errVfs);
    }

    // 2. Replace hardcoded splash table with lines from public/splashes.txt
    try {
      applySplashLinesToWasm(customSplashLines);
    } catch (errSplash) {
      console.warn("[Client] applySplashLinesToWasm error:", errSplash);
    }

    // 3. Install native WASM OptionsMenu Fullscreen & PC Edit Hotkeys hooks
    try {
      NativeChatHeads.install(Module);
          if (window.NativeSession) NativeSession.install(Module);
      installNativeOptionsMenuHooks();
      globalThis.ServerBranding.installNativeHooks(Module);
    } catch (errHooks) {
      console.warn("[Client] installNativeOptionsMenuHooks error:", errHooks);
    }

    try {
      Module.ccall("mainf", null, null);
    } catch (e) {
      if (e !== "unwind") console.error(e);
    }
  },
  canvas: (function () {
    return document.getElementById("canvas");
  })()
};
window.Module = Module;

// ============================================================================
// 9. Custom Server Packet Handler & High-Level GameSDK / GameEntity Playground
// ============================================================================
function handleCustomServerPackets(functionName, args) {
  if (functionName === "OnSendPlayerToYoutube") {
    var youtubeUrl = args[1] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    console.log("[CustomPacket] Opening YouTube URL:", youtubeUrl);
    playNativeVfsSfx("/audio/switch.wav");
    if (window.GameSDK && typeof window.GameSDK.openUrl === "function") {
      window.GameSDK.openUrl(youtubeUrl);
    } else {
      window.open(youtubeUrl, "_blank", "noopener,noreferrer");
    }
    return true;
  }
  return false;
}
window.handleCustomServerPackets = handleCustomServerPackets;

// ============================================================================
// CONTOH PAKAI GameSDK & GameEntity (Tinggal uncomment atau ketik di Console F12!):
// ============================================================================
// // 1) Sembunyikan tombol di MainMenu cukup 2 baris (otomatis berlaku tiap menu muncul!):
// const AboutButton = new GameEntity("About");
// AboutButton.visible = false;
//
// // 2) Geser tombol atau ubah ukurannya:
// const PlayButton = new GameEntity("Online");
// PlayButton.position = { x: 400, y: 300 };
//
// // 3) Tambah tombol native Growtopia sendiri di MainMenu (klik langsung buka YouTube!):
// GameSDK.onMenu("MainMenu", (menu) => {
//   if (!menu.find("YoutubeBtn").exists) {
//     menu.addButton({
//       name: "YoutubeBtn",
//       text: "YouTube",
//       x: 28,
//       y: 28,
//       linesPerScreenY: 16,
//       onClick: () => GameSDK.openUrl("https://www.youtube.com", "YouTube")
//     });
//   }
// });
//
// // 4) Lihat semua nama tombol/Entity aktif kapan saja dari DevTools Console (F12):
// // GameSDK.listEntities();

// Do not start Emscripten until the required local files are present.
// Without this, a failed data request leaves the user at an endless spinner.
function showClientStartupError(message) {
  var loader = document.getElementById("loader");
  if (!loader) return;
  loader.style.display = "flex";
  loader.style.pointerEvents = "auto";
  var spinner = loader.querySelector(".spinner");
  var progress = loader.querySelector(".progress");
  var text = loader.querySelector(".loadingtext");
  if (spinner) spinner.style.display = "none";
  if (progress) progress.style.display = "none";
  if (text) {
    text.style.cssText = "white-space:pre-line;max-width:800px;padding:20px;font-size:17px;line-height:1.5;color:#fff";
    text.textContent = "Client belum siap:\n" + message + "\n\nLihat PATCH_README.md, lalu refresh halaman.";
  }
}
window.addEventListener("unhandledrejection", function (event) {
  if (!window.__clientRuntimeReady) showClientStartupError("Gagal memuat client: " + String(event.reason && event.reason.message || event.reason));
});
(async function bootLocalClient() {
  try {
    var response = await fetch("/api/client-readiness", {cache:"no-store", signal:AbortSignal.timeout(60000)});
    var status = await response.json();
    if (!response.ok || !status.ready) { showClientStartupError((status.issues || ["Pemeriksaan client gagal."]).join("\n")); return; }
    var script = document.createElement("script");
    script.src = appName + "-" + gameVersion + ".js?v=2200";
    script.onerror = function () { showClientStartupError("Loader client gagal dimuat. Pastikan file patch lengkap dan refresh."); };
    document.body.appendChild(script);
  } catch (err) {
    showClientStartupError("Tidak dapat memeriksa server: " + String(err && err.message || err));
  }
})();
