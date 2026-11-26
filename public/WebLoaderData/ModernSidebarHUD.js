/**
 * ModernSidebarHUD.js — Official Growtopia RmlUi WorldUI + EventPanel Runtime
 *
 * Mounts the genuine `/GameData/UI/WorldUI/WorldUI.rml` + `EventPanel.rml` +
 * `EventButtons/BaseEventButton.rml` templates and `.rcss` stylesheets via
 * `RmlUiEngine.js`, backed by native C++ WASM exports (`rmlIsInWorld`,
 * `rmlGetDisplayedGems`, `rmlSetHudEnabled`, `rmlSyncConsoleLayout`,
 * `rmlOpenStore`, `rmlSendPacket`).
 *
 * Zero JS HEAPF32 gem scanning, zero synthetic CSS borders, zero drop-shadows.
 */
(function (global) {
  "use strict";

  const PREF_KEY = "magnolia_modern_sidebar_hud";

  const BLOCKING_MENUS = [
    "GenericDialog",
    "StoreMenu",
    "PauseMenu",
    "OptionsMenu",
    "WorldSelectMenu",
    "MainMenu",
    "LoginMenu",
    "OnlineMenu",
    "AboutMenu",
    "InitConnection",
    "HotkeySettingsMenu",
    "CommunityHubMenu",
    "CustomLogFilterMenu",
    "TradeMenu",
    "FlagMenu",
    "PetBattleGUI",
    "mcp_root",
  ];

  let moduleRef = null;
  let installed = false;
  let hostEl = null;
  let docInstance = null;
  let tickTimer = null;
  let mounting = null;
  let lastHudVisible = null;
  let hudHideTimer = null;
  let hudSlideSeq = 0;
  let lastRenderedGems = -1;
  let lastSyncSentAt = 0;
  let portraitRev = 0;
  let lastPortraitKey = "";
  let lastPortraitPngLen = 0;
  let nextPortraitCheckAt = 0;
  let portraitSettleAt = 0;
  let portraitCapturing = false;

  let enabled = true;
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === "0" || saved === "false") enabled = false;
  } catch (_) {}

  const state = {
    netId: 0,
    rawName: "Growtopian",
    displayName: "`wGrowtopian``",
    gems: 0,
    inWorld: false,
    worldName: "",
    questDone: 0,
    questMax: 1,
    questReady: false,
    questTitle: "Crazy Jim's Daily Quest",
    questDesc: "",
    scrolls: 20,
    scrollsMax: 20,
    nextScrollSec: 0,
    unreadMail: 0,
    totalMail: 0,
    achievementsEarned: 0,
    achievementsTotal: 15,
    ftueOpen: false,
  };

  // Official RmlUi Data Models consumed directly by WorldUI.rml, EventPanel.rml, and BaseEventButton.rml
  const models = {
    PlayerInfoModel: {
      PlayerInfo: {
        netId: 0,
        name: "`wGrowtopian``",
        gemsCount: "0",
        canShowPearls: false,
        pearlCount: "0",
      },
    },
    EventButtons: {
      eventButtons: [],
    },
    FTUEPanelModel: {
      visible: false,
      title: "`$Crazy Jim's Daily Quest``",
      notification: false,
    },
    ActiveAuctionPanelModel: {
      ActiveAuctionPanel: {
        itemId: 0,
        highestBidWlCount: 0,
        highestBidUserName: "",
        bidEndTime: 0,
        availableLocks: 0,
        alreadyBidLocks: 0,
        isOwner: false,
        canBid: false,
        PossibleBids: [1, 5, 10],
      },
    },
    ConsoleModel: {
      IsShown: false,
      IsDocked: true,
    },
  };

  function getWasmContext() {
    const m = moduleRef || global.Module;
    const ex = global.__RML_WASM_EXPORTS || (global.RmlUiEngine && global.RmlUiEngine.wasm && global.RmlUiEngine.wasm.exports);
    if (!m || !ex || !m.ctx || !m.HEAPU8 || !m.HEAPU32 || !m.HEAPF32 || !m.wasmTable) return null;
    if (!ex.portraitDraw || !ex.portraitResources || !ex.portraitApply || !ex.portraitDestroy) return null;
    return { m, ex };
  }

  function readLocalAvatarState(m) {
    const app = m.HEAPU32[393364 >> 2];
    if (!app) return null;
    const glc = m.HEAPU32[(app + 1800) >> 2];
    if (!glc) return null;
    const av = m.HEAPU32[(glc + 184) >> 2];
    if (!av) return null;
    const dv = new DataView(m.HEAPU8.buffer);
    const rawSkin = dv.getUint32(av + 1572, true) >>> 0;
    const skin = (rawSkin & 0xff) !== 0 ? rawSkin : 0xB4D2FAFF;
    const hairColor = dv.getUint32(av + 564, true) >>> 0;
    const clothes = new Array(10);
    for (let i = 0; i < 10; i++) clothes[i] = dv.getUint16(av + 1576 + i * 2, true);
    const key = clothes.join(",") + ":" + skin + ":" + hairColor;
    return { av, skin, hairColor, clothes, key };
  }

  function cropPortraitPixels(pixels, w, h) {
    let left = w, right = -1, top = h, bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[((h - 1 - y) * w + x) * 4 + 3] > 16) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < left) return null;
    const side = Math.max(right - left + 1, bottom - top + 1);
    const out = new Uint8Array(side * side * 4);
    const ox = Math.floor((side - (right - left + 1)) / 2);
    const oy = Math.floor((side - (bottom - top + 1)) / 2);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const from = ((h - 1 - y) * w + x) * 4;
        const to = ((y - top + oy) * side + (x - left + ox)) * 4;
        out.set(pixels.subarray(from, from + 4), to);
      }
    }
    return { data: out, size: side };
  }

  function captureDirectPortraitRgba(m, ex, avState) {
    const gl = m.ctx;
    if (!gl || portraitCapturing) return null;
    const resource = ex.portraitResources();
    if (!resource) return null;
    const source = avState.av + 516; // Live NetAvatar RenderState inside client.wasm
    const stateBuf = m._malloc(1056);
    const fake = m._malloc(1712);
    const scale = m._malloc(8);
    let copied = false, texture = null, fbo = null, depth = null;
    const savedResource = m.HEAPU8.slice(resource, resource + 212);
    const saved = {
      frame: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: gl.getParameter(gl.VIEWPORT),
      texture: gl.getParameter(gl.TEXTURE_BINDING_2D),
      renderbuffer: gl.getParameter(gl.RENDERBUFFER_BINDING),
      clear: gl.getParameter(gl.COLOR_CLEAR_VALUE),
      depthClear: gl.getParameter(gl.DEPTH_CLEAR_VALUE),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK),
      depthEnabled: gl.isEnabled(gl.DEPTH_TEST),
      depthFunc: gl.getParameter(gl.DEPTH_FUNC),
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
    };
    portraitCapturing = true;
    try {
      m.wasmTable.get(1970)(stateBuf, source);
      copied = true;
      m.HEAPU8.fill(0, fake, fake + 1712);
      const dv = new DataView(m.HEAPU8.buffer);
      dv.setUint32(fake + 1572, avState.skin, true);
      for (let i = 0; i < 10; i++) {
        dv.setUint16(fake + 1576 + i * 2, (i === 0 || i === 4 || i === 7 || i === 8) ? avState.clothes[i] : 0, true);
      }
      dv.setUint32(stateBuf + 860, fake, true);
      m.HEAPU8[stateBuf + 101] = 0;
      ex.portraitApply(stateBuf, fake);
      dv.setUint32(stateBuf + 40, avState.skin, true);
      dv.setUint32(stateBuf + 44, avState.skin, true);
      dv.setUint32(stateBuf + 52, 0, true);
      dv.setUint32(stateBuf + 48, (avState.hairColor || 0) >>> 0, true);
      m.HEAPU8[stateBuf + 108] = 0;
      m.HEAPU8[stateBuf + 309] = 1;
      m.HEAPU8[stateBuf + 124] = 0;
      m.HEAPU8[stateBuf + 184] = 0;
      m.HEAPU8[stateBuf + 102] = 0;
      m.HEAPU8[stateBuf + 109] = 0;
      m.HEAPU8[stateBuf + 249] = 0;
      dv.setFloat32(stateBuf + 88, 0, true);
      dv.setFloat32(stateBuf + 92, 0, true);
      dv.setUint32(stateBuf + 860, fake, true);
      const cam = m.wasmTable.get(2611)();
      const sx = m.HEAPF32[(cam + 20) >> 2];
      const sy = m.HEAPF32[(cam + 24) >> 2];
      if (!(sx > 0 && sy > 0)) return null;
      m.HEAPF32[(stateBuf + 56) >> 2] = m.HEAPF32[(cam + 4) >> 2] + 128 / sx;
      m.HEAPF32[(stateBuf + 60) >> 2] = m.HEAPF32[(cam + 8) >> 2] + 240 / sy;
      m.HEAPF32[(stateBuf + 276) >> 2] = 2 / sx;
      m.HEAPF32[(stateBuf + 280) >> 2] = 2 / sy;
      m.HEAPF32[scale >> 2] = m.HEAPF32[(scale + 4) >> 2] = 1;
      m.wasmTable.get(1336)(392580, 0);

      texture = gl.createTexture();
      fbo = gl.createFramebuffer();
      depth = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 256, 256);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

      gl.bindTexture(gl.TEXTURE_2D, saved.texture);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 256 - gl.drawingBufferHeight, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.clearDepth(1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      ex.portraitDraw(resource, stateBuf, 0, 0, 0, scale);
      m.wasmTable.get(1336)(392580, 0);
      const pixels = new Uint8Array(256 * 256 * 4);
      try { gl.pixelStorei(gl.PACK_ALIGNMENT, 1); } catch (_e) {}
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // Mask costume bodies below chin while keeping face/neck accessories
      dv.setUint16(fake + 1576, 0, true);
      dv.setUint16(fake + 1576 + 14, 0, true);
      dv.setUint32(stateBuf + 860, fake, true);
      m.HEAPU8[stateBuf + 101] = 0;
      ex.portraitApply(stateBuf, fake);
      dv.setUint32(stateBuf + 40, avState.skin & 0xffffff00, true);
      dv.setUint32(stateBuf + 44, avState.skin & 0xffffff00, true);
      dv.setUint32(stateBuf + 48, (avState.hairColor || 0) >>> 0, true);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      ex.portraitDraw(resource, stateBuf, 0, 0, 0, scale);
      m.wasmTable.get(1336)(392580, 0);
      const acc = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, acc);
      for (let y = 208; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = ((255 - y) * 256 + x) * 4;
          if (acc[i + 3] <= 16 || Math.abs(pixels[i] - acc[i]) > 4 || Math.abs(pixels[i + 1] - acc[i + 1]) > 4 || Math.abs(pixels[i + 2] - acc[i + 2]) > 4) {
            pixels.fill(0, i, i + 4);
          }
        }
      }

      const cropped = cropPortraitPixels(pixels, 256, 256);
      if (!cropped || !cropped.data || cropped.size <= 0) return null;
      return cropped;
    } catch (_) {
      return null;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.frame);
      gl.viewport(...saved.viewport);
      gl.bindRenderbuffer(gl.RENDERBUFFER, saved.renderbuffer);
      gl.clearColor(...saved.clear);
      gl.clearDepth(saved.depthClear);
      gl.depthMask(saved.depthMask);
      gl.depthFunc(saved.depthFunc);
      if (saved.depthEnabled) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      if (saved.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      if (depth) gl.deleteRenderbuffer(depth);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (texture) gl.deleteTexture(texture);
      m.HEAPU8.set(savedResource, resource);
      if (copied) ex.portraitDestroy(stateBuf);
      m._free(stateBuf);
      m._free(fake);
      m._free(scale);
      portraitCapturing = false;
    }
  }

  function syncLocalPortrait(force) {
    if (!docInstance || typeof docInstance.setPortraitRgba !== "function") return;
    const now = Date.now();
    if (!force && now < nextPortraitCheckAt) return;
    nextPortraitCheckAt = now + 400;

    const wctx = getWasmContext();
    if (!wctx) return;
    const avState = readLocalAvatarState(wctx.m);
    if (!avState) return;

    const keyChanged = avState.key !== lastPortraitKey;
    const settleDue = portraitSettleAt > 0 && now >= portraitSettleAt;
    if (!force && !keyChanged && !settleDue && portraitRev > 0) return;

    let portrait = null;
    if (global.NativeChatHeads && typeof global.NativeChatHeads.localPortrait === "function") {
      try {
        const cached = global.NativeChatHeads.localPortrait();
        if (cached && cached.key === avState.key && cached.canvas) {
          const cv = cached.canvas, ctx = cv.getContext("2d");
          const image = ctx && ctx.getImageData(0, 0, cv.width, cv.height);
          if (image && image.data.length >= 16) portrait = { data: new Uint8Array(image.data), size: cv.width };
        }
      } catch (_) {}
    }
    if (!portrait) portrait = captureDirectPortraitRgba(wctx.m, wctx.ex, avState);
    if ((!portrait || !portrait.data || portrait.data.length < 16) && global.NativeChatHeads && typeof global.NativeChatHeads.localPortraitFresh === "function") {
      // Mobile GL readback can fail on the live NetAvatar pass. Reuse the
      // owned portrait template path used by native chat heads as a fallback.
      try {
        const fresh = global.NativeChatHeads.localPortraitFresh();
        const cv = fresh && fresh.canvas;
        if (cv && cv.width > 0 && cv.height > 0) {
          const ctx2 = cv.getContext("2d");
          const img = ctx2 && ctx2.getImageData(0, 0, cv.width, cv.height);
          if (img && img.data && img.data.length >= 16) {
            portrait = { data: new Uint8Array(img.data), size: cv.width };
          }
        }
      } catch (_e) {}
    }
    if (!portrait || !portrait.data || portrait.data.length < 16) {
      nextPortraitCheckAt = now + 700;
      return;
    }
    let sig = portrait.size;
    for (let i = 3; i < portrait.data.length; i += 64) {
      sig = ((sig * 33) ^ portrait.data[i]) >>> 0;
    }
    if (keyChanged) {
      lastPortraitKey = avState.key;
      portraitSettleAt = now + 900;
    } else if (settleDue) {
      portraitSettleAt = 0;
      if (sig === lastPortraitPngLen && portraitRev > 0) return;
    }

    lastPortraitPngLen = sig;
    portraitRev += 1;
    const netId = state.netId || 1;
    const vpath = "api/player-portrait/" + netId + "_" + portraitRev + ".tga";
    docInstance.setPortraitRgba("player_avatar", vpath, portrait.data, portrait.size, portrait.size);
    if (portraitRev > 2 && typeof docInstance.deleteVirtualFile === "function") {
      docInstance.deleteVirtualFile("api/player-portrait/" + netId + "_" + (portraitRev - 2) + ".tga");
    }
  }

  function rebuildEventButtonsModel() {
    const ftueBtnState = state.ftueOpen ? 1 : state.questReady ? 2 : 0;
    models.PlayerInfoModel.PlayerInfo.netId = state.netId || 1;
    models.PlayerInfoModel.PlayerInfo.name = state.displayName || "`w" + (state.rawName || "Growtopian") + "``";

    models.FTUEPanelModel.visible = !!state.ftueOpen;
    models.FTUEPanelModel.title = state.questDesc
      ? "`$" + state.questTitle + "``\n`o" + state.questDesc + "``"
      : "`$" + state.questTitle + "``";
    models.FTUEPanelModel.notification = !state.questDone;

    models.EventButtons.eventButtons = [
      {
        name: "FTUEButton",
        featureEnableFlag: "EnableFTUE",
        visible: true,
        buttonTemplate: "FTUEButton",
        buttonClass: "ftuebutton",
        buttonState: ftueBtnState,
        buttonText: `${state.questDone}/${state.questMax || 1}`,
        buttonAction: "ftue_toggle",
        notification: !state.questDone ? 1 : 0,
      },
      {
        name: "ScrollBankButton",
        featureEnableFlag: "EnableDungeons",
        visible: true,
        buttonTemplate: "DungeonEventButton",
        buttonClass: "scrollbank",
        buttonState: 0,
        buttonText: `${state.scrolls}/${state.scrollsMax}`,
        counter: state.scrolls,
        counterMax: state.scrollsMax,
        buttonAction: "scrollbank",
        notification: state.scrolls >= state.scrollsMax ? 1 : 0,
      },
      {
        name: "MailBoxButton",
        featureEnableFlag: "EnableMailbox",
        visible: true,
        buttonTemplate: "BaseEventButton",
        buttonClass: "mailbox",
        buttonState: state.unreadMail > 0 ? 1 : 0,
        buttonText: "Mail",
        itemIdIcon: "none",
        buttonAction: "mailbox",
        notification: state.unreadMail > 0 ? state.unreadMail : 0,
      },
      {
        name: "AuctionButton",
        featureEnableFlag: "EnableAuction",
        visible: true,
        buttonTemplate: "BaseEventButton",
        buttonClass: "auction",
        buttonState: 0,
        buttonText: "Auction",
        itemIdIcon: "none",
        buttonAction: "auction",
        notification: 0,
      },
      {
        name: "SalesmanButton",
        featureEnableFlag: "EnableDailyChallenge",
        visible: true,
        buttonTemplate: "BaseEventButton",
        buttonClass: "daily_challenge",
        buttonState: 0,
        buttonText: "Shop",
        itemIdIcon: "itemidimage(1486)",
        buttonAction: "salesman",
        notification: 0,
      },
      {
        name: "AchievementsButton",
        featureEnableFlag: "EnableGoals",
        visible: true,
        buttonTemplate: "BaseEventButton",
        buttonClass: "paw-bingo",
        buttonState: state.achievementsEarned > 0 ? 1 : 0,
        buttonText: `${state.achievementsEarned}/${state.achievementsTotal}`,
        itemIdIcon: "none",
        buttonAction: "achievements",
        notification: 0,
      },
    ];
  }

  function hasBlockingMenuOpen() {
    const sdk = global.GameSDK;
    if (!sdk || !sdk.ready || !sdk._abi) return false;
    const root = sdk._abi.getRootEntityPtr();
    if (!root) return false;
    for (let i = 0; i < BLOCKING_MENUS.length; i++) {
      if (sdk._abi.findEntityPtrByName(root, BLOCKING_MENUS[i])) return true;
    }
    if (global.ModernDialogUI && typeof global.ModernDialogUI.isOpen === "function" && global.ModernDialogUI.isOpen()) {
      return false; // WorldUI stays docked behind RmlUi popups just like official Growtopia
    }
    return false;
  }

  function sendSidebarPacket(btnName) {
    if (!global.RmlUiEngine) return;
    global.RmlUiEngine.wasm.sendPacket(2, "action|sidebar_hud\nbutton|" + btnName + "\n");
  }

  function handleWorldUiEvent(action, ctx) {
    if (!global.RmlUiEngine) return;

    if (action === "world_ui.avatar_click") {
      if (state.netId > 0) {
        global.RmlUiEngine.wasm.sendPacket(2, "action|wrench\n|netid|" + state.netId + "\n");
      }
      return;
    }

    if (action === "world_ui.gems_panel_click") {
      global.RmlUiEngine.wasm.openStore();
      return;
    }

    if (action === "onscrollclick") {
      state.ftueOpen = false;
      rebuildEventButtonsModel();
      if (docInstance) docInstance.refresh();
      sendSidebarPacket("daily_quest");
      return;
    }

    if (action === "oneventclick") {
      const btnAction = ctx && ctx.arg;
      if (btnAction === "ftue_toggle") {
        state.ftueOpen = !state.ftueOpen;
        rebuildEventButtonsModel();
        if (docInstance) docInstance.refresh();
        return;
      }
      if (btnAction) {
        sendSidebarPacket(btnAction);
      }
    }
  }

  let nextMountAttemptMs = 0;

  function ensureMounted() {
    if (docInstance) return Promise.resolve(docInstance);
    if (mounting) return mounting;
    if (!global.RmlUiEngine || !document.body || Date.now() < nextMountAttemptMs) return Promise.resolve(null);
    mounting = mountSidebar();
    return mounting;
  }

  async function mountSidebar() {
    try {
      if (!hostEl) {
        hostEl = document.createElement("div");
        hostEl.id = "rml-world-ui-host";
        Object.assign(hostEl.style, {
          position: "fixed",
          inset: "0",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: "9998",
          display: "none",
        });
        document.body.appendChild(hostEl);
      }

      rebuildEventButtonsModel();

      docInstance = await global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/WorldUI/WorldUI.rml", {
        modal: false,
        initiallyHidden: true,
        hideElementIds: ["right_panel"],
        skipTemplates: ["RightMenuPanel.rml", "Console.rml"],
        models,
        onEvent: handleWorldUiEvent,
        extraCss: `
          .rml-body { pointer-events: none; }
          #right_panel { display: none !important; }
          #top_panel, #left_panel { pointer-events: auto; }
          #gems_panel {
            position: relative;
            display: flex !important;
            align-items: center;
            box-sizing: border-box;
            padding: calc(6 * var(--rml-dp)) calc(8 * var(--rml-dp));
          }
          #gems_panel .left_panel {
            flex: 0 0 calc(66 * var(--rml-dp));
            width: calc(66 * var(--rml-dp)) !important;
            height: calc(66 * var(--rml-dp)) !important;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          #gems_panel .box_border {
            margin: 0 !important;
            width: calc(64 * var(--rml-dp)) !important;
            height: calc(64 * var(--rml-dp)) !important;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }
          #gems_panel .avatar { margin: 0 !important; width: 84%; height: 84%; }
          #gems_panel .right_panel {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            margin-left: calc(6 * var(--rml-dp)) !important;
            width: auto !important;
            height: calc(64 * var(--rml-dp)) !important;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          #gems_panel .panel_name {
            margin: 0 0 0 calc(2 * var(--rml-dp)) !important;
            width: 100% !important;
            height: calc(26 * var(--rml-dp)) !important;
            display: flex;
            align-items: center;
            font-size: calc(18 * var(--rml-dp));
            line-height: 1.1;
          }
          #gems_panel .panel {
            position: relative;
            margin: 0 !important;
            width: calc(122 * var(--rml-dp)) !important;
            height: calc(34 * var(--rml-dp)) !important;
            display: flex !important;
            flex-direction: row;
            align-items: center;
            box-sizing: border-box;
            padding: 0 calc(6 * var(--rml-dp));
            cursor: pointer;
          }
          #gems_panel #gem_left_panel {
            flex: 0 0 calc(24 * var(--rml-dp));
            width: calc(24 * var(--rml-dp)) !important;
            height: calc(24 * var(--rml-dp)) !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center;
            justify-content: center;
          }
          #gems_panel #gem_icon {
            width: calc(22 * var(--rml-dp)) !important;
            height: calc(22 * var(--rml-dp)) !important;
            margin: 0 !important;
          }
          #gems_panel #gem_right_panel {
            flex: 1 1 auto;
            min-width: 0;
            width: auto !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 calc(2 * var(--rml-dp)) 0 calc(5 * var(--rml-dp)) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: flex-end !important;
            font-size: calc(18 * var(--rml-dp)) !important;
            line-height: 1 !important;
          }
          #gem_plus_button_right {
            position: absolute !important;
            right: 0 !important;
            bottom: 0 !important;
            margin: 0 !important;
            width: calc(34 * var(--rml-dp)) !important;
            height: calc(34 * var(--rml-dp)) !important;
            display: flex !important;
            align-items: center;
            justify-content: center;
          }
          #plus_button {
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            cursor: pointer;
          }
          #events_panel {
            max-height: calc(282 * var(--rml-dp)) !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
          }
          #ftueButtonPanel #panelContent {
            position: relative !important;
            width: calc(390 * var(--rml-dp)) !important;
            height: auto !important;
            min-height: calc(74 * var(--rml-dp)) !important;
          }
          #ftueButtonPanel .frame {
            position: absolute !important;
            inset: calc(2 * var(--rml-dp)) !important;
            width: auto !important;
            height: auto !important;
            margin: 0 !important;
            pointer-events: none;
          }
          #ftueButtonPanel .content {
            position: relative !important;
            z-index: 2;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: calc(10 * var(--rml-dp)) !important;
            padding: calc(12 * var(--rml-dp)) calc(14 * var(--rml-dp)) !important;
            box-sizing: border-box !important;
          }
          #ftueButtonPanel #description {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            margin: 0 !important;
            line-height: 1.25 !important;
          }
          #ftueButtonPanel #buttons {
            flex: 0 0 calc(52 * var(--rml-dp)) !important;
            width: calc(52 * var(--rml-dp)) !important;
            height: calc(52 * var(--rml-dp)) !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center;
            justify-content: center;
          }
          #ftueButtonPanel #scroll {
            flex: 0 0 calc(52 * var(--rml-dp)) !important;
            width: calc(52 * var(--rml-dp)) !important;
            height: calc(52 * var(--rml-dp)) !important;
            margin: 0 !important;
            background-size: contain !important;
            cursor: pointer;
          }
          .event_item .label { pointer-events: none; }
        `,
      });

      // Remove initial 'full-hide' class just like WorldUI.rml Lua `onShowUI`
      if (docInstance.bodyEl) {
        docInstance.bodyEl.classList.remove("full-hide");

        // Stop canvas click/touch/wheel passthrough on interactive HUD panels
        for (const sel of ["#top_panel", "#left_panel"]) {
          const panel = docInstance.bodyEl.querySelector(sel);
          if (panel) {
            for (const evName of ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "wheel"]) {
              panel.addEventListener(evName, (e) => e.stopPropagation(), { passive: true });
            }
          }
        }
      }

      if (typeof docInstance.setVisible === "function") {
        const initShow = !!(enabled && global.RmlUiEngine.wasm.isInWorld() && !hasBlockingMenuOpen());
        lastHudVisible = initShow;
        global.RmlUiEngine.wasm.setHudEnabled(initShow);
        setHudVisible(initShow, initShow);
        if (global.RmlUiEngine.wasm.isInWorld()) syncConsoleSubwidgets(initShow);
      }

      docInstance.refresh();
    } catch (err) {
      nextMountAttemptMs = Date.now() + 2500;
      console.error("[ModernSidebarHUD] Failed to mount WorldUI.rml:", err);
    } finally {
      mounting = null;
    }
    return docInstance;
  }

  let consoleTickCounter = 0;

  function syncConsoleSubwidgets(docked) {
    const sdk = global.GameSDK;
    if (!sdk || !sdk.ready || !sdk._abi) return;
    const abi = sdk._abi;
    const root = abi.getRootEntityPtr();
    if (!root) return;
    const cpPtr = abi.findEntityPtrByName(root, "ConsoleLogParent");
    if (!cpPtr) return;

    const cpEnt = new sdk.Entity(cpPtr);
    const screenSz = sdk.screenSize;
    const vw = (screenSz && (screenSz.width || screenSz.x)) || global.innerWidth || 1024;
    const winW = global.innerWidth || vw;

    // 1. Right boundary: stop cleanly before MENU / CHAT / FRIENDS buttons
    let rightLimitGui = vw - 141;
    const wsgPtr = abi.findEntityPtrByName(root, "WorldSpecificGUI");
    if (wsgPtr) {
      const gmPtr = abi.findEntityPtrByName(wsgPtr, "GameMenu");
      if (gmPtr) {
        for (const btnName of ["CHAT", "MENU", "FRIENDS"]) {
          const bPtr = abi.findEntityPtrByName(gmPtr, btnName);
          if (bPtr) {
            const bPos = new sdk.Entity(bPtr).position;
            if (bPos && bPos.x > vw * 0.5) {
              rightLimitGui = Math.min(rightLimitGui, bPos.x - 10);
            }
          }
        }
      }
    }

    // 2. Left boundary: start cleanly 10px to the right of #gems_panel when docked
    let targetX = 0;
    if (docked) {
      let gemsRightPx = 0;
      if (docInstance && typeof docInstance.getElementRect === "function") {
        const r = docInstance.getElementRect("gems_panel");
        if (r && r.width > 20) gemsRightPx = r.right;
      } else if (docInstance && docInstance.bodyEl) {
        const gp = docInstance.bodyEl.querySelector("#gems_panel");
        if (gp) {
          const r = gp.getBoundingClientRect();
          if (r && r.width > 20) gemsRightPx = r.right;
        }
      }
      if (gemsRightPx > 20) {
        targetX = Math.round(((gemsRightPx + 10) / winW) * vw);
      } else if (global.RmlUiEngine) {
        targetX = Math.round(((266 * global.RmlUiEngine.computeDpScale()) / winW) * vw);
      }
    }

    targetX = Math.max(0, Math.min(targetX, Math.max(0, vw - 80)));
    const curCpPos = cpEnt.position;
    const vh = (screenSz && (screenSz.height || screenSz.y)) || global.innerHeight || 720;
    // A newly recreated ConsoleLogParent can contain an uninitialized pos2d.y
    // after exit/re-entry (observed values around 1e25). Preserving that value
    // moves the entire chat permanently off-screen. Do not disturb normal
    // collapsed/animated positions, or an intentionally hidden console.
    const badY = cpEnt.visible &&
      (!Number.isFinite(curCpPos.y) || Math.abs(curCpPos.y) > Math.max(2000, vh * 4));
    if (!Number.isFinite(curCpPos.x) || Math.abs(curCpPos.x - targetX) > 1.5 || badY) {
      cpEnt.position = { x: targetX, y: badY ? 0 : curCpPos.y };
    }

    // Never push the log outside a narrow viewport. Keep it usable on mobile
    // instead of forcing a 220px column beyond the right edge.
    const boxW = Math.max(80, Math.min(vw - targetX, Math.round(rightLimitGui - targetX)));

    // 3. Resize LogRectBG + ConsoleLog + Scrollbar widths and recenter ConsoleGrab pull-tab
    const bgPtr = abi.findEntityPtrByName(cpPtr, "LogRectBG") || abi.findEntityPtrByName(cpPtr, "LogRect");
    if (bgPtr) {
      const bgEnt = new sdk.Entity(bgPtr);
      const bgSz = bgEnt.size;
      if (bgSz.width > 0 && Math.abs(bgSz.width - boxW) > 1.5) {
        bgEnt.size = { width: boxW, height: bgSz.height };
      }
      const logPtr = abi.findEntityPtrByName(bgPtr, "ConsoleLog") || abi.findEntityPtrByName(cpPtr, "ConsoleLog");
      if (logPtr) {
        const logEnt = new sdk.Entity(logPtr);
        const logSz = logEnt.size;
        const innerW = Math.max(60, boxW - 20);
        if (logSz.width > 0 && Math.abs(logSz.width - innerW) > 1.5) {
          logEnt.size = { width: innerW, height: logSz.height };
        }
        const sbPtr = abi.findEntityPtrByName(logPtr, "Scrollbar");
        if (sbPtr) {
          const sbEnt = new sdk.Entity(sbPtr);
          const sbSz = sbEnt.size;
          if (sbSz.width > 0 && Math.abs(sbSz.width - innerW) > 1.5) {
            sbEnt.size = { width: innerW, height: sbSz.height };
          }
        }
      }
    }

    const grabPtr = abi.findEntityPtrByName(cpPtr, "ConsoleGrab");
    if (grabPtr) {
      const grabEnt = new sdk.Entity(grabPtr);
      const grabSz = grabEnt.size;
      const grabPos = grabEnt.position;
      const desiredGrabX = Math.max(0, Math.round((boxW - (grabSz.width || 96)) * 0.5));
      if (Math.abs(grabPos.x - desiredGrabX) > 1.5) {
        grabEnt.position = { x: desiredGrabX, y: grabPos.y };
      }
    }
  }

  function setHudSlideClass(hidden) {
    if (!docInstance) return;
    if (docInstance.isNative && typeof docInstance.setElementClass === "function") {
      docInstance.setElementClass("@body", "full-hide", hidden);
    } else if (docInstance.bodyEl) {
      docInstance.bodyEl.classList.toggle("full-hide", hidden);
    }
  }

  function setHudVisible(visible, animate) {
    const seq = ++hudSlideSeq;
    if (hudHideTimer) clearTimeout(hudHideTimer);
    hudHideTimer = null;
    if (!docInstance) return;
    if (visible) {
      setHudSlideClass(!!animate);
      if (hostEl) hostEl.style.display = "block";
      if (docInstance.setVisible) docInstance.setVisible(true);
      if (animate) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (seq === hudSlideSeq) setHudSlideClass(false);
      }));
    } else if (animate) {
      setHudSlideClass(true);
      hudHideTimer = setTimeout(() => {
        if (seq !== hudSlideSeq) return;
        if (docInstance && docInstance.setVisible) docInstance.setVisible(false);
        if (hostEl) hostEl.style.display = "none";
        hudHideTimer = null;
      }, 220);
    } else {
      setHudSlideClass(true);
      if (docInstance.setVisible) docInstance.setVisible(false);
      if (hostEl) hostEl.style.display = "none";
    }
  }

  function tick() {
    if (global.RmlUiEngine && !document.hidden) {
      const inWorld = global.RmlUiEngine.wasm.isInWorld();
      const shouldShow = !!(enabled && docInstance && inWorld && !hasBlockingMenuOpen());
      // Don't mount the RmlUi HUD document on the login/menu screens; the
      // first mount parses the full WorldUI document and is expensive.
      if (enabled && inWorld && !docInstance) ensureMounted();

      if (shouldShow !== lastHudVisible) {
        const previousHudVisible = lastHudVisible;
        lastHudVisible = shouldShow;
        global.RmlUiEngine.wasm.setHudEnabled(shouldShow);
        global.RmlUiEngine.wasm.syncConsoleLayout();
        setHudVisible(shouldShow, !!docInstance && previousHudVisible !== null);
        syncConsoleSubwidgets(shouldShow);
        if (shouldShow && Date.now() - lastSyncSentAt > 1500) {
          lastSyncSentAt = Date.now();
          sendSidebarPacket("sync");
        }
      } else if (++consoleTickCounter >= 12) {
        consoleTickCounter = 0;
        if (inWorld) syncConsoleSubwidgets(shouldShow);
      }

      if (shouldShow) {
        const liveGems = global.RmlUiEngine.wasm.getDisplayedGems();
        if (liveGems !== lastRenderedGems) {
          lastRenderedGems = liveGems;
          state.gems = liveGems;
          models.PlayerInfoModel.PlayerInfo.gemsCount = Number(liveGems || 0).toLocaleString("en-US");
          if (docInstance) docInstance.refresh();
        }
        syncLocalPortrait(false);
      }
    }

    scheduleTick();
  }

  async function prewarm(options = {}) {
    // Fetch all RML/RCSS/font payloads in one request and build the hidden
    // WorldUI document while the startup loader is still visible. The first
    // world frame then only has to show it, not parse it.
    try {
      if (global.RmlUiEngine && typeof global.RmlUiEngine.preloadUiResources === "function") {
        await global.RmlUiEngine.preloadUiResources();
      }
    } catch (_e) {}
    if (options.signal && options.signal.aborted) return null;
    return ensureMounted();
  }

  function scheduleTick() {
    if (tickTimer !== null) return;
    // The world HUD is not animated at 60 fps. A 10 Hz poll is enough for
    // gems, visibility and console layout, and avoids burning mobile CPU.
    tickTimer = setTimeout(function () {
      tickTimer = null;
      try { tick(); } catch (err) {
        console.error("[ModernSidebarHUD] tick failed:", err);
        scheduleTick();
      }
    }, 100);
  }

  function onServerHudPacket(args) {
    const raw = args && args[1];
    if (typeof raw !== "string" || !raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;

    if (typeof parsed.netId === "number") state.netId = parsed.netId;
    if (typeof parsed.rawName === "string") state.rawName = parsed.rawName;
    if (typeof parsed.displayName === "string") state.displayName = parsed.displayName;
    if (typeof parsed.worldName === "string") state.worldName = parsed.worldName;
    if (typeof parsed.questDone === "number") state.questDone = parsed.questDone;
    if (typeof parsed.questMax === "number") state.questMax = parsed.questMax;
    if (typeof parsed.questReady === "boolean") state.questReady = parsed.questReady;
    if (typeof parsed.questTitle === "string") state.questTitle = parsed.questTitle;
    if (typeof parsed.questDesc === "string") state.questDesc = parsed.questDesc;
    if (typeof parsed.scrolls === "number") state.scrolls = parsed.scrolls;
    if (typeof parsed.scrollsMax === "number") state.scrollsMax = parsed.scrollsMax;
    if (typeof parsed.nextScrollSec === "number") state.nextScrollSec = parsed.nextScrollSec;
    if (typeof parsed.unreadMail === "number") state.unreadMail = parsed.unreadMail;
    if (typeof parsed.totalMail === "number") state.totalMail = parsed.totalMail;
    if (typeof parsed.achievementsEarned === "number") state.achievementsEarned = parsed.achievementsEarned;
    if (typeof parsed.achievementsTotal === "number") state.achievementsTotal = parsed.achievementsTotal;

    rebuildEventButtonsModel();
    if (docInstance) docInstance.refresh();
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(flag) {
    enabled = !!flag;
    try {
      localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
    } catch (_) {}
    lastHudVisible = null;
    if (global.RmlUiEngine) {
      global.RmlUiEngine.wasm.setHudEnabled(!!(enabled && docInstance && global.RmlUiEngine.wasm.isInWorld() && !hasBlockingMenuOpen()));
      global.RmlUiEngine.wasm.syncConsoleLayout();
    }
  }

  function install(mod) {
    if (installed) return;
    installed = true;
    moduleRef = mod || global.Module;

    if (global.GameSDK && typeof global.GameSDK.onPacket === "function") {
      global.GameSDK.onPacket("OnMagnoliaSidebarHud", onServerHudPacket);
      global.GameSDK.onPacket("OnSpawn", (args) => {
        const text = (args && args[1]) || "";
        if (text.includes("type|local")) {
          const nm = /(?:\n|^)name\|([^\n]*)/.exec(text);
          const nid = /(?:\n|^)netID\|(\d+)/.exec(text);
          if (nm && nm[1]) {
            state.displayName = nm[1];
            const plain = nm[1].replace(/``/g, "").replace(/`./g, "").replace(/^[@#]+/, "").trim();
            if (plain) state.rawName = plain;
          }
          if (nid) state.netId = parseInt(nid[1], 10) || 0;
          lastPortraitKey = "";
          portraitSettleAt = 0;
          nextPortraitCheckAt = Date.now() + 1200;
          lastHudVisible = null;
          consoleTickCounter = 11;
          rebuildEventButtonsModel();
          if (docInstance) docInstance.refresh();
        }
      });
      global.GameSDK.onPacket("OnNameChanged", (args, pktNetId) => {
        const nextName = args && typeof args[1] === "string" ? args[1].trim() : "";
        if (!nextName) return;
        const myNetId = Number(state.netId) || 0;
        if (typeof pktNetId === "number" && pktNetId > 0) {
          if (myNetId > 0 && pktNetId !== myNetId) return;
          state.displayName = nextName;
          const plain = nextName.replace(/``/g, "").replace(/`./g, "").replace(/^[@#]+/, "").trim();
          if (plain) state.rawName = plain;
          rebuildEventButtonsModel();
          if (docInstance) docInstance.refresh();
          return;
        }
        const plainNext = nextName.replace(/``/g, "").replace(/`./g, "").replace(/^[@#]+/, "").trim().toLowerCase();
        const curRaw = String(state.rawName || "").replace(/^[@#]+/, "").trim().toLowerCase();
        if (curRaw && plainNext === curRaw) {
          state.displayName = nextName;
          rebuildEventButtonsModel();
          if (docInstance) docInstance.refresh();
        }
      });
    }

    if (moduleRef && typeof moduleRef.hookWasmTable === "function") {
      try {
        let origSetClothes = null;
        origSetClothes = moduleRef.hookWasmTable(
          3191,
          function (p, v) {
            const res = origSetClothes ? origSetClothes(p, v) : 0;
            lastPortraitKey = "";
            nextPortraitCheckAt = 0;
            return res;
          },
          "vii"
        );
      } catch (_) {}
      try {
        let inConsoleResize = false;
        let origConsoleResize = null;
        origConsoleResize = moduleRef.hookWasmTable(
          2047,
          function (pVList) {
            if (origConsoleResize) origConsoleResize(pVList);
            if (inConsoleResize) return;
            inConsoleResize = true;
            try {
              if (global.RmlUiEngine) {
                global.RmlUiEngine.wasm.syncConsoleLayout();
                syncConsoleSubwidgets(!!lastHudVisible);
              }
            } finally {
              inConsoleResize = false;
            }
          },
          "vi"
        );
      } catch (_) {}
    }

    // Mount lazily when the player actually enters a world. Mounting here
    // initializes RmlUi and parses WorldUI on the main menu, which froze startup.
    scheduleTick();
  }

  global.ModernSidebarHUD = {
    install,
    prewarm,
    isEnabled,
    setEnabled,
    getState() {
      return Object.assign({}, state);
    },
  };
})(globalThis);
