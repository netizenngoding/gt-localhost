/**
 * RmlUiEngine.js — Authentic Growtopia RmlUi (.rml + .rcss) Runtime Engine
 *
 * Compiles and mounts the official Growtopia /GameData/UI/*.rml templates and
 * *.rcss stylesheets directly inside isolated Shadow DOM documents, backed by:
 *   - Lossless decoded .rttex spritesheets (/GameData/sprites/ + rml-sprites.json)
 *   - Official Localization.xml dictionary (rml-localization.json)
 *   - Official items.dat names & ITEM_ID_* constants (rml-items.json)
 *   - Native C++ WASM exports (rmlIsInWorld, rmlGetDisplayedGems, rmlSetHudEnabled,
 *     rmlSetModalOpen, rmlSyncConsoleLayout, rmlOpenStore, rmlSendPacket)
 *
 * Zero box-shadows or synthetic CSS borders: all box-shadow declarations are
 * stripped and only authentic RmlUi decorators/borders from .rcss are emitted.
 */
(function (g) {
  "use strict";

  const UI_ROOT = "/GameData/UI/";
  const SPRITE_ROOT = "/GameData/sprites/";

  let metaPromise = null;
  let spritesMeta = { textures: {}, sheets: {}, sprites: {} };
  let localizationMap = {};
  let itemsMeta = { constants: {}, consts: {}, names: {} };

  const textCache = new Map();
  const compiledDocCache = new Map();
  const compiledRcssCache = new Map();
  const imageObjCache = new Map();
  const tintedDataUrlCache = new Map();
  const activeTimers = new Set();
  const activePortraits = new Set();

  // -------------------------------------------------------------------------
  // 1. Native WASM Bridge (Zero JS HEAPF32 heuristic scanning)
  // -------------------------------------------------------------------------
  function getWasmExports() {
    if (g.NativeChatHeads && typeof g.NativeChatHeads.wasmExports === "function") {
      const ex = g.NativeChatHeads.wasmExports();
      if (ex) return ex;
    }
    return g.__RML_WASM_EXPORTS || null;
  }

  function getEmscriptenModule() {
    return g.Module || null;
  }

  const wasmBridge = {
    ready() {
      const ex = getWasmExports();
      return !!(ex && typeof ex.rmlIsInWorld === "function");
    },
    isInWorld() {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlIsInWorld !== "function") return false;
      try {
        return ex.rmlIsInWorld() === 1;
      } catch (_) {
        return false;
      }
    },
    getPlayerGems() {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlGetPlayerGems !== "function") return 0;
      try {
        return ex.rmlGetPlayerGems() | 0;
      } catch (_) {
        return 0;
      }
    },
    getDisplayedGems() {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlGetDisplayedGems !== "function") return 0;
      try {
        return ex.rmlGetDisplayedGems() | 0;
      } catch (_) {
        return 0;
      }
    },
    setHudEnabled(enabled) {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlSetHudEnabled !== "function") return;
      try {
        ex.rmlSetHudEnabled(enabled ? 1 : 0);
      } catch (_) {}
    },
    setModalOpen(open) {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlSetModalOpen !== "function") return;
      try {
        ex.rmlSetModalOpen(open ? 1 : 0);
      } catch (_) {}
    },
    syncConsoleLayout() {
      const ex = getWasmExports();
      if (!ex || typeof ex.rmlSyncConsoleLayout !== "function") return;
      try {
        ex.rmlSyncConsoleLayout();
      } catch (_) {}
    },
    openStore() {
      const ex = getWasmExports();
      if (ex && typeof ex.rmlOpenStore === "function") {
        try {
          ex.rmlOpenStore();
          return true;
        } catch (_) {}
      }
      return wasmBridge.sendPacket(2, "action|store\n");
    },
    sendPacket(pktType, text) {
      const ex = getWasmExports();
      const m = getEmscriptenModule();
      if (
        ex &&
        typeof ex.rmlSendPacket === "function" &&
        m &&
        typeof m._malloc === "function" &&
        typeof m._free === "function" &&
        m.HEAPU8
      ) {
        const bytes = new TextEncoder().encode(String(text || ""));
        const ptr = m._malloc(bytes.length + 1);
        if (ptr) {
          try {
            m.HEAPU8.set(bytes, ptr);
            m.HEAPU8[ptr + bytes.length] = 0;
            return ex.rmlSendPacket(pktType | 0, ptr) === 1;
          } catch (_) {
          } finally {
            m._free(ptr);
          }
        }
      }
      if (g.GameSDK && typeof g.GameSDK.sendPacket === "function") {
        g.GameSDK.sendPacket(pktType | 0, String(text || ""));
        return true;
      }
      return false;
    },
  };

  // -------------------------------------------------------------------------
  // 2. Metadata & Texture Preloading (Sprites, Localization, Item Constants)
  // -------------------------------------------------------------------------
  function loadImageElement(url) {
    if (imageObjCache.has(url)) return imageObjCache.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imageObjCache.set(url, p);
    return p;
  }

  function ensureMetadata() {
    if (metaPromise) return metaPromise;
    metaPromise = Promise.all([
      fetch(UI_ROOT + "rml-sprites.json")
        .then((r) => (r.ok ? r.json() : { sheets: {}, sprites: {} }))
        .catch(() => ({ sheets: {}, sprites: {} })),
      fetch(UI_ROOT + "rml-localization.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      fetch(UI_ROOT + "rml-items.json")
        .then((r) => (r.ok ? r.json() : { constants: {}, names: {} }))
        .catch(() => ({ constants: {}, names: {} })),
    ]).then(async ([sp, loc, itm]) => {
      spritesMeta = sp || { textures: {}, sheets: {}, sprites: {} };
      localizationMap = loc || {};
      itemsMeta = itm || { constants: {}, consts: {}, names: {} };

      const preloadUrls = [
        SPRITE_ROOT + "_rects/button-bg.png",
        SPRITE_ROOT + "_rects/border-frame.png",
        SPRITE_ROOT + "_rects/progress-border.png",
        SPRITE_ROOT + "_rects/progress-fill-border.png",
        SPRITE_ROOT + "game/gui_box_upwhite.png",
        SPRITE_ROOT + "game/gui_box_white.png",
        SPRITE_ROOT + "interface/large/gui_event_health_bar_bg.png",
        SPRITE_ROOT + "interface/large/gui_event_health_bar_fg.png",
        SPRITE_ROOT + "interface/large/gui_event_progress_bar_bg.png",
        SPRITE_ROOT + "interface/large/gui_event_progress_bar_fg.png",
        SPRITE_ROOT + "_rects/accordion_arrow.png",
        SPRITE_ROOT + "_rects/dropdown_arrow.png",
      ];
      const loaded = await Promise.all(preloadUrls.map((u) => loadImageElement(u)));
      for (let i = 0; i < preloadUrls.length; i++) {
        if (loaded[i]) imageObjCache.set("sync:" + preloadUrls[i], loaded[i]);
      }
      return true;
    });
    return metaPromise;
  }

  async function fetchTextCached(url) {
    if (textCache.has(url)) return textCache.get(url);
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error("Failed to load RmlUi asset: " + url + " (" + r.status + ")");
      return r.text();
    });
    textCache.set(url, p);
    return p;
  }

  function resolveRelativeUrl(href, baseFileUrl) {
    const clean = String(href || "").trim().replace(/\\/g, "/");
    if (!clean) return "";
    if (clean.startsWith("/")) return clean;
    const base = new URL(baseFileUrl, g.location ? g.location.origin : "http://localhost");
    return new URL(clean, base).pathname;
  }

  function resolveSpriteOrTextureUrl(rawRef) {
    const ref = String(rawRef || "").trim().replace(/^['"]|['"]$/g, "");
    if (!ref) return "";
    if (spritesMeta.sprites && spritesMeta.sprites[ref]) {
      return SPRITE_ROOT + "_rects/" + ref + ".png";
    }
    if (ref.startsWith("/") || ref.startsWith("data:") || ref.startsWith("http:") || ref.startsWith("https:")) {
      return ref;
    }
    let norm = ref.replace(/\\/g, "/").replace(/^(?:\.\.\/|\.\/)+/, "");
    if (norm.toLowerCase().endsWith(".rttex")) {
      norm = norm.slice(0, -6) + ".png";
    }
    const lower = norm.toLowerCase();
    for (const tier of ["bronze", "silver", "gold", "ruby", "emerald", "sapphire"]) {
      if (lower.includes("rank_" + tier) || lower.includes(tier + "_banner") || lower.endsWith("/" + tier + ".png")) {
        return "/branding/modern-ui/rank_" + tier + ".png";
      }
    }
    if (lower.includes("auction_sold")) return "/branding/modern-ui/auction_sold.png";
    return SPRITE_ROOT + norm;
  }

  function parseRcssColorRGBA(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = /^#([0-9a-fA-F]{3})$/.exec(s);
    if (m) {
      const h = m[1];
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
    }
    m = /^#([0-9a-fA-F]{4})$/.exec(s);
    if (m) {
      const h = m[1];
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        parseInt(h[3] + h[3], 16),
      ];
    }
    m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s);
    if (m) {
      const rgb = parseInt(m[1], 16);
      const a = m[2] ? parseInt(m[2], 16) : 255;
      return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, a];
    }
    m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(s);
    if (m) {
      const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
      const gCol = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
      const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
      let a = 255;
      if (m[4] !== undefined) {
        a = m[4].includes(".") ? Math.round(Number(m[4]) * 255) : Math.round(Number(m[4]));
      }
      return [r, gCol, b, Math.max(0, Math.min(255, a))];
    }
    return null;
  }

  function tintLoadedImage(url, rgba) {
    if (!rgba || (rgba[0] === 255 && rgba[1] === 255 && rgba[2] === 255 && rgba[3] === 255)) {
      return url;
    }
    const key = url + "@" + rgba.join(",");
    if (tintedDataUrlCache.has(key)) return tintedDataUrlCache.get(key);
    const img = imageObjCache.get("sync:" + url);
    if (!img || !img.naturalWidth) return url;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const [mr, mg, mb, ma] = rgba;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round((d[i] * mr) / 255);
      d[i + 1] = Math.round((d[i + 1] * mg) / 255);
      d[i + 2] = Math.round((d[i + 2] * mb) / 255);
      d[i + 3] = Math.round((d[i + 3] * ma) / 255);
    }
    ctx.putImageData(im, 0, 0);
    const out = c.toDataURL("image/png");
    tintedDataUrlCache.set(key, out);
    return out;
  }

  function resolveItemId(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === "number") return raw | 0;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const consts = itemsMeta.constants || itemsMeta.consts || {};
    if (consts[s] !== undefined) {
      return consts[s] | 0;
    }
    return 0;
  }

  function resolveSpriteSheetUrl(sp) {
    if (!sp) return "";
    const texKey = sp.tex || sp.sheet || "";
    const texMap = spritesMeta.textures || spritesMeta.sheets || {};
    const info = texKey ? texMap[texKey] : null;
    if (info) {
      if (info.url) return info.url;
      if (info.png) return SPRITE_ROOT + info.png;
    }
    if (texKey) {
      return SPRITE_ROOT + texKey.replace(/\.rttex$/i, ".png");
    }
    return sp.url || "";
  }

  // -------------------------------------------------------------------------
  // 3. RCSS -> Scoped CSS Compiler (Exact RmlUi Geometry, Zero Box-Shadows)
  // -------------------------------------------------------------------------
  function dpExpr(valNum) {
    const n = Number(valNum);
    if (!n) return "0px";
    return `calc(${n} * var(--rml-dp))`;
  }

  function convertRcssValue(rawValue) {
    let v = String(rawValue || "").trim();
    if (!v) return v;
    v = v.replace(/rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)/gi, (_, r, gCol, b, a) => {
      const alpha = String(a).includes(".") ? Number(a) : +(Number(a) / 255).toFixed(4);
      return `rgba(${r}, ${gCol}, ${b}, ${alpha})`;
    });
    v = v.replace(/(-?[0-9]*\.?[0-9]+)dp\b/gi, (_, n) => dpExpr(n));
    v = v.replace(/\binset-left\b/gi, "0px");
    return v;
  }

  function compileDecoratorDeclarations(decoratorVal, imageColorVal, selectorHint) {
    const dec = String(decoratorVal || "").trim();
    const rgba = parseRcssColorRGBA(imageColorVal);
    if (!dec || dec === "none") {
      if (rgba && imageColorVal) {
        if (selectorHint && /\.img-button\b/.test(selectorHint)) {
          const tintedBtn = tintLoadedImage(SPRITE_ROOT + "_rects/button-bg.png", rgba);
          return `border-image-source: url("${tintedBtn}");`;
        }
        if (/:active\b/.test(selectorHint || "")) {
          return "filter: brightness(0.78);";
        }
        return "";
      }
      return dec === "none" ? "background-image: none; border-image: none;" : "";
    }

    const m = /^([a-zA-Z-]+)\(\s*([\s\S]*?)\s*\)$/.exec(dec);
    if (!m) return "";
    const kind = m[1].toLowerCase();
    const inner = m[2].trim();

    if (kind === "ninepatch") {
      const parts = inner.split(",").map((p) => p.trim());
      const outerSp = spritesMeta.sprites[parts[0]];
      const innerSp = spritesMeta.sprites[parts[1]];
      if (!outerSp || !innerSp) return "";
      const [ox, oy, ow, oh] = outerSp.rect;
      const [ix, iy, iw, ih] = innerSp.rect;
      const top = Math.max(0, iy - oy);
      const left = Math.max(0, ix - ox);
      const right = Math.max(0, ox + ow - (ix + iw));
      const bottom = Math.max(0, oy + oh - (iy + ih));
      const baseUrl = SPRITE_ROOT + "_rects/" + parts[0] + ".png";
      const finalUrl = tintLoadedImage(baseUrl, rgba);
      return [
        "border-style: solid;",
        "border-width: 0px;",
        `border-image-source: url("${finalUrl}");`,
        `border-image-slice: ${top} ${right} ${bottom} ${left} fill;`,
        `border-image-width: ${dpExpr(top)} ${dpExpr(right)} ${dpExpr(bottom)} ${dpExpr(left)};`,
        "border-image-repeat: stretch;",
      ].join(" ");
    }

    if (kind === "tiled-box") {
      const parts = inner.split(",").map((p) => p.trim());
      const tl = spritesMeta.sprites && spritesMeta.sprites[parts[0]];
      const br = spritesMeta.sprites && spritesMeta.sprites[parts[8]];
      if (!tl || !br) return "";
      const baseUrl = resolveSpriteSheetUrl(tl);
      if (!baseUrl) return "";
      const top = tl.rect[3];
      const left = tl.rect[2];
      const right = br.rect[2];
      const bottom = br.rect[3];
      const finalUrl = tintLoadedImage(baseUrl, rgba);
      return [
        "border-style: solid;",
        "border-width: 0px;",
        `border-image-source: url("${finalUrl}");`,
        `border-image-slice: ${top} ${right} ${bottom} ${left} fill;`,
        `border-image-width: ${dpExpr(top)} ${dpExpr(right)} ${dpExpr(bottom)} ${dpExpr(left)};`,
        "border-image-repeat: stretch;",
      ].join(" ");
    }

    if (kind === "tiled-horizontal") {
      const parts = inner.split(",").map((p) => p.trim());
      const lSp = spritesMeta.sprites && spritesMeta.sprites[parts[0]];
      const rSp = spritesMeta.sprites && spritesMeta.sprites[parts[2]];
      if (!lSp || !rSp) return "";
      const baseUrl = resolveSpriteSheetUrl(lSp);
      if (!baseUrl) return "";
      const left = lSp.rect[2];
      const right = rSp.rect[2];
      const finalUrl = tintLoadedImage(baseUrl, rgba);
      return [
        "border-style: solid;",
        "border-width: 0px;",
        `border-image-source: url("${finalUrl}");`,
        `border-image-slice: 0 ${right} 0 ${left} fill;`,
        `border-image-width: 0px ${dpExpr(right)} 0px ${dpExpr(left)};`,
        "border-image-repeat: stretch;",
      ].join(" ");
    }

    if (kind === "image") {
      const tokens = inner.split(/\s+/);
      const mode = tokens.length > 1 ? tokens[tokens.length - 1].toLowerCase() : "";
      const hasMode = mode === "cover" || mode === "contain" || mode === "scale-none";
      const rawPath = hasMode ? tokens.slice(0, -1).join(" ") : inner;
      const baseUrl = resolveSpriteOrTextureUrl(rawPath);
      const finalUrl = tintLoadedImage(baseUrl, rgba);
      const bgSize =
        mode === "cover" ? "cover" : mode === "contain" ? "contain" : mode === "scale-none" ? "auto" : "100% 100%";
      return `background-image: url("${finalUrl}"); background-repeat: no-repeat; background-position: center; background-size: ${bgSize};`;
    }

    if (kind === "itemidimage") {
      const id = resolveItemId(inner);
      if (id > 0) {
        return `background-image: url("/api/item-icon/${id}.png"); background-repeat: no-repeat; background-position: center; background-size: contain; image-rendering: pixelated;`;
      }
      return "";
    }

    if (kind === "vertical-gradient") {
      const cols = inner.split(/\s+/).map((c) => convertRcssValue(c));
      if (cols.length >= 2) {
        return `background-image: linear-gradient(to bottom, ${cols[0]}, ${cols[1]});`;
      }
    }

    if (kind === "horizontal-gradient") {
      const cols = inner.split(/\s+/).map((c) => convertRcssValue(c));
      if (cols.length >= 2) {
        return `background-image: linear-gradient(to right, ${cols[0]}, ${cols[1]});`;
      }
    }

    if (kind === "gradient") {
      const tokens = inner.split(/\s+/);
      const dir = tokens[0] === "horizontal" ? "to right" : "to bottom";
      const c1 = convertRcssValue(tokens[1] || "#000000");
      const c2 = convertRcssValue(tokens[2] || "#000000");
      return `background-image: linear-gradient(${dir}, ${c1}, ${c2});`;
    }

    return "";
  }

  function transformRcssSelector(sel) {
    return sel
      .split(",")
      .map((part) => {
        let s = part.trim();
        if (!s) return "";
        if (/\bscrollbarvertical\b|\bsliderarrowdec\b|\bsliderarrowinc\b|\bslidertrack\b|\bsliderbar\b/i.test(s)) {
          return "";
        }
        s = s.replace(/\bbody\b/g, ".rml-body");
        s = s.replace(/\bSpan\b/g, "span");
        s = s.replace(/(^|[\s>+~])class(?=[\s>+~.#:\[]|$)/g, "$1rml-class");
        s = s.replace(/\bTimer\b/g, "rml-timer");
        s = s.replace(/\btimertext\b/g, "rml-timertext");
        s = s.replace(/(^|[\s>+~])active(?=[\s>+~.#:\[]|$)/g, "$1rml-active");
        s = s.replace(/(^|[\s>+~])expired(?=[\s>+~.#:\[]|$)/g, "$1rml-expired");
        s = s.replace(/\bPlayerPortret\b/g, "rml-player-portrait");
        s = s.replace(/\bItemIdImg\b/g, "rml-itemid-img");
        s = s.replace(/\bTruncatingString\b/g, "rml-truncating-string");
        s = s.replace(/(^|[\s>+~])progress(?=[\s>+~.#:\[]|$)/g, "$1rml-progress");
        s = s.replace(/(^|[\s>+~])fill(?=[\s>+~.#:\[]|$)/g, "$1rml-fill");
        s = s.replace(/\binput\.radio\b/g, 'input[type="radio"]');
        s = s.replace(/\binput\.text\b/g, 'input[type="text"]');
        return s;
      })
      .filter(Boolean)
      .join(", ");
  }

  function stripBalancedAtBlocks(cssText) {
    let out = "";
    let i = 0;
    while (i < cssText.length) {
      const atIdx = cssText.indexOf("@", i);
      if (atIdx < 0) {
        out += cssText.slice(i);
        break;
      }
      out += cssText.slice(i, atIdx);
      const braceIdx = cssText.indexOf("{", atIdx);
      const semiIdx = cssText.indexOf(";", atIdx);
      if (semiIdx >= 0 && (braceIdx < 0 || semiIdx < braceIdx)) {
        i = semiIdx + 1;
        continue;
      }
      if (braceIdx < 0) break;
      let depth = 1;
      let j = braceIdx + 1;
      while (j < cssText.length && depth > 0) {
        if (cssText[j] === "{") depth++;
        else if (cssText[j] === "}") depth--;
        j++;
      }
      i = j;
    }
    return out;
  }

  function compileRcss(rcssText, rcssUrl) {
    if (compiledRcssCache.has(rcssUrl)) return compiledRcssCache.get(rcssUrl);

    let src = String(rcssText || "").replace(/\/\*[\s\S]*?\*\//g, "");
    src = stripBalancedAtBlocks(src);

    const outRules = [];
    const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = ruleRegex.exec(src)) !== null) {
      const rawSel = match[1].trim();
      const rawBody = match[2];
      if (!rawSel || rawSel.startsWith("@")) continue;
      const selector = transformRcssSelector(rawSel);
      if (!selector) continue;

      let decoratorVal = null;
      let imageColorVal = null;
      let tableRowGap = null;
      let tableColGap = null;
      const isTableRule = /\btable\b/i.test(rawSel);
      const decls = [];

      const cleanedBody = rawBody
        .split(/\r?\n/)
        .filter((ln) => !/^\s*#/.test(ln))
        .join("\n");

      for (const rawStmt of cleanedBody.split(";")) {
        const idx = rawStmt.indexOf(":");
        if (idx <= 0) continue;
        const prop = rawStmt.slice(0, idx).trim().toLowerCase();
        const rawVal = rawStmt.slice(idx + 1).trim();
        if (!prop || !rawVal) continue;

        // Strip ALL box-shadow rules (zero shadows per Growtopia RmlUi requirement)
        if (prop === "box-shadow") {
          continue;
        }
        if (prop === "decorator") {
          decoratorVal = rawVal;
          continue;
        }
        if (prop === "image-color") {
          imageColorVal = rawVal;
          continue;
        }
        if (prop === "sound-on-click") {
          decls.push("cursor: pointer;");
          continue;
        }
        if (
          prop === "drag" ||
          prop === "nav" ||
          prop === "tab-index" ||
          prop === "focus" ||
          prop === "clip" ||
          prop === "transition" ||
          prop === "animation"
        ) {
          continue;
        }
        if (prop === "font-effect") {
          if (rawVal === "none") {
            decls.push("text-shadow: none;");
          } else {
            const sm = /shadow\(\s*([^\s]+)\s+([^\s]+)\s+(.+)\s*\)/i.exec(rawVal);
            if (sm) {
              decls.push(
                `text-shadow: ${convertRcssValue(sm[1])} ${convertRcssValue(sm[2])} 0px ${convertRcssValue(sm[3])};`
              );
            } else {
              const gm = /glow\(\s*([^\s]+)\s+(.+)\s*\)/i.exec(rawVal);
              if (gm) {
                decls.push(`text-shadow: 0px 0px ${convertRcssValue(gm[1])} ${convertRcssValue(gm[2])};`);
              }
            }
          }
          continue;
        }

        let val = convertRcssValue(rawVal);
        if (prop === "flex-direction" && val === "col") {
          val = "column";
        }
        if (prop === "font-family") {
          val = "'CenturyGothicBold', 'Century Gothic', sans-serif";
        }
        if (/^border(?:-(?:top|right|bottom|left))?$/.test(prop)) {
          if (val !== "none" && val !== "0" && val !== "0px" && !/\b(solid|dashed|dotted|double)\b/i.test(val)) {
            let splitPos = -1;
            if (val.startsWith("calc(")) {
              const closeParen = val.indexOf(")");
              if (closeParen > 0) splitPos = val.indexOf(" ", closeParen);
            } else {
              splitPos = val.indexOf(" ");
            }
            if (splitPos > 0) {
              val = val.slice(0, splitPos) + " solid " + val.slice(splitPos + 1).trim();
            }
          }
        }
        if (isTableRule && prop === "row-gap") tableRowGap = val;
        if (isTableRule && prop === "column-gap") tableColGap = val;

        decls.push(`${prop}: ${val};`);
      }

      if (decoratorVal !== null || imageColorVal !== null) {
        const decCss = compileDecoratorDeclarations(decoratorVal, imageColorVal, selector);
        if (decCss) decls.push(decCss);
      }
      if (isTableRule && (tableRowGap || tableColGap)) {
        decls.push("border-collapse: separate;");
        decls.push(`border-spacing: ${tableColGap || "0px"} ${tableRowGap || "0px"};`);
      }

      if (decls.length > 0) {
        outRules.push(`${selector} { ${decls.join(" ")} }`);
      }
    }

    const compiled = outRules.join("\n");
    compiledRcssCache.set(rcssUrl, compiled);
    return compiled;
  }

  // -------------------------------------------------------------------------
  // 4. RML Document & Template Loader (<template>, <link type="text/rcss">)
  // -------------------------------------------------------------------------
  const HTML_VOID_TAGS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  const RML_TAG_MAP = {
    Timer: "rml-timer",
    timertext: "rml-timertext",
    active: "rml-active",
    expired: "rml-expired",
    PlayerPortret: "rml-player-portrait",
    ItemIdImg: "rml-itemid-img",
    TruncatingString: "rml-truncating-string",
    FeatureEnableFlag: "rml-feature-flag",
    progress: "rml-progress",
    fill: "rml-fill",
    Span: "span",
    class: "rml-class",
  };

  function expandSelfClosingTags(xml) {
    let out = "";
    let i = 0;
    while (i < xml.length) {
      const lt = xml.indexOf("<", i);
      if (lt < 0) {
        out += xml.slice(i);
        break;
      }
      out += xml.slice(i, lt);
      const nextCh = xml[lt + 1] || "";
      if (nextCh === "/" || nextCh === "!" || nextCh === "?") {
        const gt = xml.indexOf(">", lt + 2);
        if (gt < 0) {
          out += xml.slice(lt);
          break;
        }
        out += xml.slice(lt, gt + 1);
        i = gt + 1;
        continue;
      }
      let j = lt + 1;
      let q = "";
      while (j < xml.length) {
        const ch = xml[j];
        if (q) {
          if (ch === q) q = "";
        } else if (ch === '"' || ch === "'") {
          q = ch;
        } else if (ch === ">") {
          break;
        }
        j++;
      }
      if (j >= xml.length) {
        out += xml.slice(lt);
        break;
      }
      const rawTagChunk = xml.slice(lt, j + 1);
      if (xml[j - 1] === "/") {
        const tm = /^<\s*([a-zA-Z][a-zA-Z0-9_-]*)/.exec(rawTagChunk);
        const tagName = tm ? tm[1] : "";
        if (tagName && !HTML_VOID_TAGS.has(tagName.toLowerCase())) {
          const innerWithoutSlash = xml.slice(lt + 1, j - 1);
          out += `<${innerWithoutSlash}></${tagName}>`;
          i = j + 1;
          continue;
        }
      }
      out += rawTagChunk;
      i = j + 1;
    }
    return out;
  }

  function normalizeRmlMarkup(rawXml) {
    let xml = String(rawXml || "").replace(/<!--[\s\S]*?-->/g, "");
    // Strip embedded <script lang="text/lua">...</script> blocks
    xml = xml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

    // Preserve exact camelCase of data-alias-FooBar="expr" before HTML parser lowercases attributes
    xml = xml.replace(/\sdata-alias-([a-zA-Z0-9_]+)\s*=\s*(["'])([\s\S]*?)\2/g, (_, aliasName, q, expr) => {
      return ` data-rml-alias-${aliasName.toLowerCase()}=${q}${aliasName}:::${expr}${q}`;
    });

    for (const [srcTag, dstTag] of Object.entries(RML_TAG_MAP)) {
      const openRe = new RegExp(`<(${srcTag})(?=[\\s/>])`, "g");
      const closeRe = new RegExp(`</(${srcTag})\\s*>`, "g");
      xml = xml.replace(openRe, `<${dstTag}`);
      xml = xml.replace(closeRe, `</${dstTag}>`);
    }

    xml = expandSelfClosingTags(xml);

    xml = xml.replace(
      /\s(onclick|onmousedown|onchange|oninput|onfinish|onscroll|onshow|onactiveauctionend)\s*=/gi,
      (_, ev) => ` data-rml-${ev.toLowerCase()}=`
    );
    return xml;
  }

  function injectIntoContentSlot(tplHtml, slotName, innerHtml) {
    if (!slotName) return tplHtml + innerHtml;
    const escaped = slotName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe = new RegExp(`<([a-zA-Z][a-zA-Z0-9_-]*)\\b[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>`, "i");
    const clsRe = new RegExp(
      `<([a-zA-Z][a-zA-Z0-9_-]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`,
      "i"
    );
    const m = idRe.exec(tplHtml) || clsRe.exec(tplHtml);
    if (!m) return tplHtml + innerHtml;

    const tag = m[1];
    const openEnd = m.index + m[0].length;
    const scanRe = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "gi");
    scanRe.lastIndex = openEnd;
    let depth = 1;
    let sm;
    while ((sm = scanRe.exec(tplHtml)) !== null) {
      const isClose = sm[1] === "/";
      const selfClosing = !isClose && /\/\s*>$/.test(sm[0]);
      if (isClose) {
        depth--;
        if (depth === 0) {
          return tplHtml.slice(0, openEnd) + innerHtml + tplHtml.slice(sm.index);
        }
      } else if (!selfClosing && !HTML_VOID_TAGS.has(tag.toLowerCase())) {
        depth++;
      }
    }
    return tplHtml + innerHtml;
  }

  async function parseTemplateFile(templateUrl, visited = new Set()) {
    if (visited.has(templateUrl)) return { name: "", contentId: "", rcssUrls: [], templates: {}, bodyHtml: "" };
    visited.add(templateUrl);

    const raw = await fetchTextCached(templateUrl);
    const norm = normalizeRmlMarkup(raw);
    const tMatch = /<template\b([^>]*)>([\s\S]*)<\/template>/i.exec(norm);
    const inner = tMatch ? tMatch[2] : norm;
    const tAttrs = tMatch ? tMatch[1] : "";
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(tAttrs);
    const contentMatch = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tAttrs);

    const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(inner);
    const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(inner);
    const headHtml = headMatch ? headMatch[1] : "";
    const bodyHtml = bodyMatch ? bodyMatch[1] : inner;

    const rcssUrls = [];
    const templates = {};

    const linkRe = /<link\b([^>]*?)\/?>/gi;
    let lm;
    while ((lm = linkRe.exec(headHtml)) !== null) {
      const attrs = lm[1];
      const typeM = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const hrefM = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!typeM || !hrefM) continue;
      const t = typeM[1].toLowerCase();
      const resolved = resolveRelativeUrl(hrefM[1], templateUrl);
      if (t === "text/template") {
        const sub = await parseTemplateFile(resolved, new Set(visited));
        for (const u of sub.rcssUrls) if (!rcssUrls.includes(u)) rcssUrls.push(u);
        Object.assign(templates, sub.templates);
        if (sub.name) templates[sub.name] = sub;
      } else if (t === "text/rcss") {
        if (!rcssUrls.includes(resolved)) rcssUrls.push(resolved);
      }
    }

    const selfObj = {
      name: nameMatch ? nameMatch[1] : "",
      contentId: contentMatch ? contentMatch[1] : "",
      rcssUrls,
      templates,
      bodyHtml,
    };
    if (selfObj.name) templates[selfObj.name] = selfObj;
    return selfObj;
  }

  function expandInlineTemplates(html, templatesMap) {
    let out = html;
    const leafTplRe = /<template\b([^>]*)>((?:(?!<template\b)[\s\S])*?)<\/template>/gi;
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      out = out.replace(leafTplRe, (full, attrs, inner) => {
        changed = true;
        const srcM = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (!srcM) return inner;
        const tpl = templatesMap[srcM[1]];
        if (!tpl) return inner;
        if (tpl.contentId && inner.trim()) {
          return injectIntoContentSlot(tpl.bodyHtml, tpl.contentId, inner);
        }
        return tpl.bodyHtml;
      });
      if (!changed) break;
    }
    return out;
  }

  async function loadCompiledDocument(rmlUrl, options = {}) {
    await ensureMetadata();
    const skipTemplates = options.skipTemplates || [];
    const cacheKey = rmlUrl + "|" + skipTemplates.join(",");
    if (compiledDocCache.has(cacheKey)) return compiledDocCache.get(cacheKey);

    const raw = await fetchTextCached(rmlUrl);
    const norm = normalizeRmlMarkup(raw);
    const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(norm);
    const bodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body>/i.exec(norm);
    const headHtml = headMatch ? headMatch[1] : "";
    const bodyAttrs = bodyMatch ? bodyMatch[1] : "";
    let bodyInner = bodyMatch ? bodyMatch[2] : norm;

    const rcssUrls = [];
    const templatesMap = {};

    const linkRe = /<link\b([^>]*?)\/?>/gi;
    let lm;
    while ((lm = linkRe.exec(headHtml)) !== null) {
      const attrs = lm[1];
      const typeM = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const hrefM = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!typeM || !hrefM) continue;
      const t = typeM[1].toLowerCase();
      const resolved = resolveRelativeUrl(hrefM[1], rmlUrl);
      if (skipTemplates.some((sk) => resolved.endsWith(sk))) continue;
      if (t === "text/template") {
        const sub = await parseTemplateFile(resolved);
        for (const u of sub.rcssUrls) if (!rcssUrls.includes(u)) rcssUrls.push(u);
        Object.assign(templatesMap, sub.templates);
      } else if (t === "text/rcss") {
        if (!rcssUrls.includes(resolved)) rcssUrls.push(resolved);
      }
    }

    const bodyTplMatch = /\btemplate\s*=\s*["']([^"']+)["']/i.exec(bodyAttrs);
    const bodyClassMatch = /\bclass\s*=\s*["']([^"']+)["']/i.exec(bodyAttrs);
    const bodyModelMatch = /\bdata-model\s*=\s*["']([^"']+)["']/i.exec(bodyAttrs);
    const baseTemplateName = bodyTplMatch ? bodyTplMatch[1] : "";
    const bodyClasses = bodyClassMatch ? bodyClassMatch[1].trim() : "";

    if (baseTemplateName && templatesMap[baseTemplateName]) {
      const baseTpl = templatesMap[baseTemplateName];
      bodyInner = injectIntoContentSlot(baseTpl.bodyHtml, baseTpl.contentId, bodyInner);
    }

    bodyInner = expandInlineTemplates(bodyInner, templatesMap);

    const rcssTexts = await Promise.all(rcssUrls.map((u) => fetchTextCached(u)));
    const compiledStyles = rcssUrls.map((u, i) => compileRcss(rcssTexts[i], u)).join("\n");

    const docSpec = {
      rmlUrl,
      baseTemplateName,
      bodyClasses,
      bodyModel: bodyModelMatch ? bodyModelMatch[1] : "",
      bodyInner,
      compiledStyles,
    };
    compiledDocCache.set(cacheKey, docSpec);
    return docSpec;
  }

  // -------------------------------------------------------------------------
  // 5. Official Growtopia RmlUi Formatting & Expression Evaluator
  // -------------------------------------------------------------------------
  const GT_COLOR_CLASS = {
    "0": "color_white",
    "1": "color_light_cyan",
    "2": "color_green",
    "3": "color_light_blue",
    "4": "color_crazy_red",
    "5": "color_pinky_purple",
    "6": "color_brown",
    "7": "color_light_gray",
    "8": "color_crazy_orange",
    "9": "color_yellow",
    "!": "color_bright_cyan",
    "@": "color_bright_red_pink",
    "#": "color_bright_purple",
    "$": "color_pale_yellow",
    "^": "color_light_green",
    "&": "color_very_pale_pink",
    w: "color_white",
    o: "color_dreamsicle",
    p: "color_pink",
    b: "color_black",
    q: "color_dark_blue",
    e: "color_medium_blue",
    r: "color_pale_green",
    t: "color_medium_green",
    a: "color_dark_grey",
    s: "color_med_grey",
    c: "color_vibrant_cyan",
  };

  function toRmlText(input) {
    let raw = String(input ?? "");
    if (!raw) return "";
    raw = raw.replace(/<br\s*\/?>/gi, "\n");
    let out = "";
    let openSpan = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "`") {
        if (i + 1 < raw.length) {
          const next = raw[i + 1];
          if (next === "`") {
            i++;
            if (openSpan) {
              out += "</span>";
              openSpan = false;
            }
            continue;
          }
          const cls = GT_COLOR_CLASS[next];
          if (cls) {
            i++;
            if (openSpan) out += "</span>";
            out += `<span class="${cls}">`;
            openSpan = true;
            continue;
          }
        }
        if (openSpan) {
          out += "</span>";
          openSpan = false;
          continue;
        }
      }
      if (ch === "\n") {
        out += "<br/>";
      } else if (ch === "&") {
        out += "&amp;";
      } else if (ch === "<") {
        out += "&lt;";
      } else if (ch === ">") {
        out += "&gt;";
      } else {
        out += ch;
      }
    }
    if (openSpan) out += "</span>";
    return out;
  }

  function localizeString(keyOrText, ...args) {
    let s = String(keyOrText ?? "");
    if (localizationMap) {
      if (Object.prototype.hasOwnProperty.call(localizationMap, s)) {
        s = localizationMap[s];
      } else if (Object.prototype.hasOwnProperty.call(localizationMap, "[" + s + "]")) {
        s = localizationMap["[" + s + "]"];
      }
    }
    s = s.replace(/&#10;/g, "\n").replace(/&#13;/g, "");
    let argIdx = 0;
    s = s.replace(/\{(\d*)\}/g, (_, explicitIdx) => {
      const idx = explicitIdx !== "" ? parseInt(explicitIdx, 10) : argIdx++;
      return args[idx] !== undefined ? String(args[idx]) : "";
    });
    return s;
  }

  function localizeWithTokenizedParams(keyOrText, paramsStr, delimiter) {
    const delim = delimiter || "|";
    const tokens = paramsStr ? String(paramsStr).split(delim) : [];
    let s = localizeString(keyOrText, ...tokens);
    for (let i = 0; i < tokens.length; i++) {
      s = s.split(`[${i}]`).join(tokens[i]);
    }
    return s;
  }

  function formatDurationSeconds(totalSec, secPost1m) {
    const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return secPost1m ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }

  function timeLeftFormat(seconds, fmtStr, expiredStr) {
    const sec = Math.floor(Number(seconds) || 0);
    if (sec <= 0) return String(expiredStr ?? "");
    const formatted = formatDurationSeconds(sec, true);
    const tpl = String(fmtStr ?? "{}");
    return tpl.includes("{}") ? tpl.replace("{}", formatted) : tpl + formatted;
  }

  const exprFnCache = new Map();
  const stmtFnCache = new Map();

  function buildEvalContext(models, localScope, extraHelpers) {
    return Object.assign(
      {
        len: (x) => (x && typeof x.length === "number" ? x.length : 0),
        Localize: localizeString,
        LocalizeWithTokenizedStringParameter: localizeWithTokenizedParams,
        ToRMLText: toRmlText,
        ItemName: (id) => {
          const num = resolveItemId(id);
          return (itemsMeta.names && itemsMeta.names[String(num)]) || (num > 0 ? "Item #" + num : "");
        },
        MoneyString: (n) => Number(n || 0).toLocaleString("en-US"),
        NumWithSeparator: (n) => Number(n || 0).toLocaleString("en-US"),
        TimeLeftFormat: timeLeftFormat,
        ...(itemsMeta.constants || itemsMeta.consts || {}),
      },
      models || {},
      localScope || {},
      extraHelpers || {}
    );
  }

  function evaluateRmlExpr(expr, models, localScope) {
    const raw = String(expr ?? "").trim();
    if (!raw) return "";

    let jsExpr = convertPipesToCalls(raw);
    jsExpr = jsExpr.replace(/\.size\b/g, ".length");

    let fn = exprFnCache.get(jsExpr);
    if (!fn) {
      try {
        fn = new Function(
          "__ctx",
          "with (__ctx) { try { return (" + jsExpr + "); } catch (_e) { return undefined; } }"
        );
      } catch (_err) {
        fn = () => undefined;
      }
      exprFnCache.set(jsExpr, fn);
    }

    return fn(buildEvalContext(models, localScope));
  }

  function executeRmlDataEventStmt(stmt, models, localScope, extraHelpers) {
    const raw = String(stmt ?? "").trim();
    if (!raw) return;
    let fn = stmtFnCache.get(raw);
    if (!fn) {
      try {
        fn = new Function("__ctx", "with (__ctx) { try { " + raw + " } catch (_e) {} }");
      } catch (_err) {
        fn = () => {};
      }
      stmtFnCache.set(raw, fn);
    }
    fn(buildEvalContext(models, localScope, extraHelpers));
  }

  function convertPipesToCalls(expr) {
    const stages = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === "\\" && i + 1 < expr.length) i++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === "(" || ch === "[") {
        depth++;
      } else if (ch === ")" || ch === "]") {
        depth = Math.max(0, depth - 1);
      } else if (ch === "|" && depth === 0 && expr[i + 1] !== "|" && expr[i - 1] !== "|") {
        stages.push(expr.slice(start, i).trim());
        start = i + 1;
      }
    }
    stages.push(expr.slice(start).trim());
    if (stages.length === 1) return stages[0];

    let acc = stages[0];
    for (let i = 1; i < stages.length; i++) {
      const st = stages[i];
      const fm = /^([a-zA-Z0-9_.$]+)\(\s*([\s\S]*)\)$/.exec(st);
      if (fm) {
        const args = fm[2].trim();
        acc = args ? `${fm[1]}(${acc}, ${args})` : `${fm[1]}(${acc})`;
      } else {
        acc = `${st}(${acc})`;
      }
    }
    return acc;
  }

  function assignModelPath(models, localScope, pathExpr, newVal) {
    const parts = String(pathExpr || "").trim().split(".");
    if (!parts.length) return;
    let target = localScope && parts[0] in localScope ? localScope : models;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target || typeof target !== "object") return;
      target = target[parts[i]];
    }
    if (target && typeof target === "object") {
      target[parts[parts.length - 1]] = newVal;
    }
  }

  // -------------------------------------------------------------------------
  // 6. Shadow-DOM Document Instance & Reactive Data-Binding Pass
  // -------------------------------------------------------------------------
  const SHADOW_BASE_RESET_CSS = `
    :host {
      all: initial;
      display: block;
      font-family: 'CenturyGothicBold', 'Century Gothic', 'Trebuchet MS', sans-serif;
      color: #ffffff;
      user-select: none;
      -webkit-user-select: none;
      --rml-dp: 1px;
    }
    *, *::before, *::after {
      box-sizing: content-box;
      margin: 0;
      padding: 0;
      border-width: 0;
      border-style: solid;
      border-color: transparent;
      box-shadow: none !important;
      -webkit-tap-highlight-color: transparent;
    }
    .rml-body {
      position: relative;
      width: 100%;
      height: 100%;
      font-family: 'CenturyGothicBold', 'Century Gothic', 'Trebuchet MS', sans-serif;
    }
    input, button, select, textarea {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
      background: transparent;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
    }
    rml-timer, rml-timertext, rml-active, rml-expired {
      display: inline;
    }
    rml-feature-flag {
      display: contents;
    }
    .window {
      display: flex !important;
      flex-direction: column;
      box-sizing: border-box;
      max-height: 92vh !important;
    }
    .window > .bg {
      flex: 1 1 auto;
      min-height: 0;
      height: auto !important;
      max-height: calc(92vh - 22 * var(--rml-dp)) !important;
      overflow-y: auto !important;
      overflow-x: hidden;
    }
    #window-title {
      margin-top: calc(-12 * var(--rml-dp)) !important;
    }
    rml-truncating-string {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    rml-progress {
      display: inline-block;
      position: relative;
      overflow: hidden;
    }
    rml-progress > rml-fill {
      display: block;
      height: 100%;
    }
    rml-itemid-img {
      display: inline-block;
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      image-rendering: pixelated;
    }
    rml-player-portrait {
      display: block;
      overflow: hidden;
    }
    rml-player-portrait canvas {
      width: 100%;
      height: 100%;
      display: block;
      image-rendering: pixelated;
    }
    .window .window-close-button {
      z-index: 60 !important;
      pointer-events: auto !important;
      cursor: pointer !important;
    }
    .color_dreamsicle { color: rgb(252, 230, 186); }
    .color_light_cyan { color: rgb(173, 244, 255); }
    .color_green { color: rgb(73, 252, 0); }
    .color_light_blue { color: rgb(191, 218, 255); }
    .color_crazy_red { color: rgb(255, 39, 29); }
    .color_pinky_purple { color: rgb(235, 183, 255); }
    .color_brown { color: rgb(255, 202, 111); }
    .color_light_gray { color: rgb(230, 230, 230); }
    .color_crazy_orange { color: rgb(255, 148, 69); }
    .color_yellow { color: rgb(255, 238, 125); }
    .color_bright_cyan { color: rgb(209, 255, 249); }
    .color_bright_red_pink { color: rgb(255, 205, 201); }
    .color_bright_purple { color: rgb(255, 143, 243); }
    .color_pale_yellow { color: rgb(255, 252, 197); }
    .color_light_green { color: rgb(181, 255, 151); }
    .color_very_pale_pink { color: rgb(254, 235, 255); }
    .color_white { color: rgb(255, 255, 255); }
    .color_black { color: rgb(0, 0, 0); }
    .color_pink { color: rgb(255, 223, 241); }
    .color_dark_blue { color: rgb(12, 96, 164); }
    .color_medium_blue { color: rgb(25, 185, 255); }
    .color_pale_green { color: rgb(111, 211, 87); }
    .color_medium_green { color: rgb(47, 131, 13); }
    .color_dark_grey { color: rgb(81, 81, 81); }
    .color_med_grey { color: rgb(158, 158, 158); }
    .color_vibrant_cyan { color: rgb(80, 255, 255); }
    #events_panel {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    #events_panel::-webkit-scrollbar {
      width: 0px !important;
      height: 0px !important;
      display: none !important;
    }
    .rml-events-scroll-arrow {
      position: absolute;
      left: 0;
      width: calc(90 * var(--rml-dp));
      height: calc(28 * var(--rml-dp));
      background-color: rgb(24, 107, 139);
      background-repeat: no-repeat;
      background-position: center;
      background-size: calc(64 * var(--rml-dp)) calc(26 * var(--rml-dp));
      z-index: 15;
      cursor: pointer;
      pointer-events: auto;
    }
    .rml-events-scroll-arrow:active {
      filter: brightness(0.82);
    }
    .rml-events-scroll-arrow.up {
      top: 0;
      border-top-left-radius: calc(7 * var(--rml-dp));
      border-top-right-radius: calc(7 * var(--rml-dp));
      background-image: url("/GameData/sprites/_rects/event_scroll_button_up.png");
    }
    .rml-events-scroll-arrow.down {
      bottom: 0;
      border-bottom-left-radius: calc(7 * var(--rml-dp));
      border-bottom-right-radius: calc(7 * var(--rml-dp));
      background-image: url("/GameData/sprites/_rects/event_scroll_button_down.png");
    }
    .wondow-content::-webkit-scrollbar,
    .show-scrollbar::-webkit-scrollbar {
      width: calc(6 * var(--rml-dp));
      height: calc(6 * var(--rml-dp));
    }
    .wondow-content::-webkit-scrollbar-track,
    .show-scrollbar::-webkit-scrollbar-track {
      background: rgba(12, 45, 58, 0.45);
    }
    .wondow-content::-webkit-scrollbar-thumb,
    .show-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(135, 184, 204, 0.85);
      border-radius: calc(3 * var(--rml-dp));
    }
  `;

  function computeDpScale() {
    const w = g.innerWidth || 1280;
    const h = g.innerHeight || 720;
    return Math.max(0.52, Math.min(1.18, Math.min(h / 680, w / 1180)));
  }

  let nativeInitPromise = null;
  async function ensureNativeRmlUi() {
    if (g.__rmluiNative && g.__rmluiNative.ready) return g.__rmluiNative;
    if (!nativeInitPromise) {
      nativeInitPromise = (async () => {
        try {
          let native = g.__rmluiNative;
          if (!native) {
            const mod = await import("/WebLoaderData/RmlUiWasm.js?v=14");
            native = mod && mod.rmluiNative;
          }
          if (!native) return null;
          await native.init(getWasmExports());
          g.__rmluiNative = native;
          return native;
        } catch (err) {
          console.warn("[RmlUiEngine] Native RmlUi WASM unavailable, falling back to ShadowDOM:", err);
          return null;
        }
      })();
    }
    return nativeInitPromise;
  }

  let uiPreloadPromise = null;
  async function preloadUiResources() {
    if (uiPreloadPromise) return uiPreloadPromise;
    uiPreloadPromise = (async () => {
      const native = await ensureNativeRmlUi();
      if (!native || !native.setVirtualFile) return;
      try {
        const res = await fetch("/ui-assets.json?v=3", { cache: "force-cache" });
        if (!res.ok) return;
        const assets = await res.json();
        let processed = 0;
        for (const key of Object.keys(assets)) {
          let b64 = assets[key];
          if (!b64) continue;
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
          native.setVirtualFile(key, bytes);
          // Yield regularly so decoding a large manifest does not monopolize
          // the main thread, even if preload runs after a startup timeout.
          if (++processed % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (err) {
        console.warn("[RmlUiEngine] UI asset preload failed:", err);
      }
    })();
    return uiPreloadPromise;
  }

  async function mountDocument(hostElement, rmlUrl, options = {}) {
    if (!options.forceShadowDom) {
      const native = await ensureNativeRmlUi();
      if (native && native.ready) {
        // Also needed when startup prewarm was skipped or timed out.
        await preloadUiResources();
        try {
          return await native.mountDocument(hostElement, rmlUrl, options);
        } catch (err) {
          console.warn("[RmlUiEngine] Native document failed, trying ShadowDOM:", rmlUrl, err);
        }
      }
    }

    const docSpec = await loadCompiledDocument(rmlUrl, options);
    const models = options.models || {};
    const onEvent = options.onEvent || null;
    const extraCss = options.extraCss || "";

    const shadow = hostElement.shadowRoot || hostElement.attachShadow({ mode: "open" });
    shadow.innerHTML = "";

    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_BASE_RESET_CSS + "\n" + docSpec.compiledStyles + "\n" + extraCss;
    shadow.appendChild(styleEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = ("rml-body " + docSpec.bodyClasses).trim();
    if (docSpec.baseTemplateName === "BasePopup") {
      bodyEl.classList.add("show-window");
      bodyEl.classList.remove("hide-window");
    }
    bodyEl.classList.remove("full-hide");
    if (docSpec.bodyModel) bodyEl.setAttribute("data-model", docSpec.bodyModel);
    bodyEl.innerHTML = docSpec.bodyInner;

    if (docSpec.bodyClasses) {
      const wc = bodyEl.querySelector("#window-content");
      if (wc) {
        for (const cls of docSpec.bodyClasses.split(/\s+/)) {
          if (cls) wc.classList.add(cls);
        }
      }
    }

    shadow.appendChild(bodyEl);

    const instanceTimers = new Set();
    const instancePortraits = new Set();
    let destroyed = false;

    function updateDpVariable() {
      const dp = options.dpScale ? options.dpScale() : computeDpScale();
      hostElement.style.setProperty("--rml-dp", dp.toFixed(4) + "px");
    }
    updateDpVariable();

    // Built-in Lua UI helpers used in WorldUI.rml & EventPanel.rml
    function positionSlideOutDrawer(panelId, buttonId) {
      const panel = bodyEl.querySelector("#" + panelId);
      const btn = bodyEl.querySelector("#" + buttonId);
      const evPanel = bodyEl.querySelector("#events_panel");
      if (!panel || !btn || !evPanel) return;
      panel.style.top = Math.max(0, btn.offsetTop - evPanel.scrollTop) + "px";
      panel.style.left = evPanel.offsetWidth + "px";
    }

    function dispatchRmlStatement(rawCode, domEvent, el, scope) {
      if (!rawCode) return;
      // Split by `;` OR whitespace-separated Lua calls like `onShowUI(document, element) onFtuePanelShown(document)`
      const normalized = String(rawCode).replace(/\)\s+(?=[a-zA-Z_])/g, "); ");
      const stmts = normalized.split(";");
      for (const rawStmt of stmts) {
        const s = rawStmt.trim();
        if (!s) continue;

        if (/^event:StopPropagation\(\s*\)$/i.test(s)) {
          if (domEvent && typeof domEvent.stopPropagation === "function") domEvent.stopPropagation();
          continue;
        }

        if (/^onFtuePanelShown\s*\(/i.test(s)) {
          positionSlideOutDrawer("ftueButtonPanel", "FTUEButton");
          continue;
        }

        if (/^onToggleAuctionPanel\s*\(/i.test(s)) {
          const panel = bodyEl.querySelector("#activeAuctionButtonPanel");
          const btn = bodyEl.querySelector("#ActiveAuctionButton");
          if (panel && btn) {
            const isOpen = btn.classList.contains("open");
            btn.classList.toggle("open", !isOpen);
            panel.classList.toggle("visible", !isOpen);
            panel.classList.toggle("hidden", isOpen);
            if (!isOpen) positionSlideOutDrawer("activeAuctionButtonPanel", "ActiveAuctionButton");
          }
          continue;
        }

        if (/^closeActiveAuctionPanel\s*\(/i.test(s)) {
          const panel = bodyEl.querySelector("#activeAuctionButtonPanel");
          const btn = bodyEl.querySelector("#ActiveAuctionButton");
          if (btn) btn.classList.remove("open");
          if (panel) {
            panel.classList.remove("visible");
            panel.classList.add("hidden");
          }
          continue;
        }

        let m = /^element(\.parent_node(?:\.parent_node)?)?:(SetClass|RemoveClass)\(\s*['"]([^'"]+)['"](?:\s*,\s*(true|false))?\s*\)$/i.exec(
          s
        );
        if (m) {
          let target = el;
          if (m[1]) {
            const hops = m[1].split(".").filter(Boolean).length;
            for (let i = 0; i < hops && target; i++) target = target.parentElement;
          }
          if (target) {
            const add = m[2].toLowerCase() === "setclass" && m[4] !== "false";
            target.classList.toggle(m[3], add);
          }
          continue;
        }

        m = /^OnEvent\(\s*event\s*,\s*['"]([^'"]+)['"](?:\s*,\s*([^)]+))?\s*\)$/i.exec(s);
        if (m) {
          const argVal = m[2] !== undefined ? evaluateRmlExpr(m[2], models, scope) : undefined;
          if (onEvent) onEvent(m[1], { domEvent, element: el, scope, arg: argVal, models, refresh });
          continue;
        }

        m = /^EventButtonClicked\(\s*event\s*,\s*([^)]+)\)$/i.exec(s);
        if (m) {
          const idx = evaluateRmlExpr(m[1], models, scope);
          if (onEvent) onEvent("EventButtonClicked", { domEvent, element: el, scope, arg: idx, models, refresh });
          continue;
        }

        m = /^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\(\s*([^)]*)\)$/i.exec(s);
        if (m) {
          const modelObj = (scope && scope[m[1]]) || models[m[1]];
          const argVal = m[3].trim() ? evaluateRmlExpr(m[3], models, scope) : undefined;
          if (modelObj && typeof modelObj[m[2]] === "function") {
            modelObj[m[2]](argVal, { domEvent, element: el, scope, models, refresh });
            refresh();
          } else if (onEvent) {
            onEvent(`${m[1]}.${m[2]}`, { domEvent, element: el, scope, arg: argVal, models, refresh });
          }
          continue;
        }

        if (onEvent) {
          onEvent(s, { domEvent, element: el, scope, models, refresh });
        }
      }
    }

    function dispatchDataEventClick(rawExpr, domEvent, el, scope) {
      const expr = String(rawExpr || "").trim();
      if (!expr) return;
      if (/^[a-zA-Z0-9_.]+$/.test(expr)) {
        if (onEvent) onEvent(expr, { domEvent, element: el, scope, models, refresh });
        return;
      }
      executeRmlDataEventStmt(expr, models, scope, {
        oneventclick: (idx, action) => {
          if (onEvent) onEvent("oneventclick", { domEvent, element: el, scope, index: idx, arg: action, models, refresh });
        },
        OnEvent: (_ev, name, arg) => {
          if (onEvent) onEvent(name, { domEvent, element: el, scope, arg, models, refresh });
        },
      });
      refresh();
      positionSlideOutDrawer("ftueButtonPanel", "FTUEButton");
    }

    function bindElementTree(node, scope) {
      if (!node || destroyed) return;

      if (node.nodeType === Node.TEXT_NODE) {
        if (node.__rmlTpl === undefined) {
          node.__rmlTpl = node.nodeValue && node.nodeValue.includes("{{") ? node.nodeValue : null;
        }
        if (node.__rmlTpl !== null) {
          node.nodeValue = node.__rmlTpl.replace(/\{\{([\s\S]*?)\}\}/g, (_, ex) => {
            const v = evaluateRmlExpr(ex, models, scope);
            return v === undefined || v === null ? "" : String(v);
          });
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;

      // Apply data-model="ModelName" BEFORE data-for so `data-model="EventButtons" data-for="eventButton : eventButtons"` resolves `eventButtons`!
      let localScope = scope;
      if (el.hasAttribute && el.hasAttribute("data-model")) {
        const mName = el.getAttribute("data-model");
        if (mName && models[mName] && typeof models[mName] === "object") {
          localScope = Object.assign({}, localScope, models[mName]);
        }
      }

      if (el.hasAttribute && el.hasAttribute("data-for")) {
        const forSpec = el.getAttribute("data-for");
        const forModel = el.getAttribute("data-model") || "";
        const proto = el.cloneNode(true);
        proto.removeAttribute("data-for");
        const anchor = document.createComment("rml-for:" + forSpec);
        anchor.__rmlForProto = proto;
        anchor.__rmlForSpec = forSpec;
        anchor.__rmlForModel = forModel;
        anchor.__rmlForItems = [];
        el.parentNode.replaceChild(anchor, el);
        syncForAnchor(anchor, localScope);
        return;
      }

      // Resolve preserved camelCase data-alias-* attributes
      if (el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.startsWith("data-rml-alias-")) {
            const sep = attr.value.indexOf(":::");
            if (sep > 0) {
              const exactAlias = attr.value.slice(0, sep);
              const aliasExpr = attr.value.slice(sep + 3);
              const resolvedVal = evaluateRmlExpr(aliasExpr, models, localScope);
              localScope = Object.assign({}, localScope, { [exactAlias]: resolvedVal });
            }
          }
        }
      }

      if (el.hasAttribute("data-if")) {
        const cond = !!evaluateRmlExpr(el.getAttribute("data-if"), models, localScope);
        if (!cond) {
          el.style.display = "none";
          return;
        } else if (el.style.display === "none") {
          el.style.removeProperty("display");
        }
      }

      if (el.hasAttribute("data-visible")) {
        const vis = !!evaluateRmlExpr(el.getAttribute("data-visible"), models, localScope);
        el.style.visibility = vis ? "visible" : "hidden";
      }

      let baseStaticClass = el.__rmlBaseClass;
      if (baseStaticClass === undefined) {
        baseStaticClass = el.getAttribute("class") || "";
        el.__rmlBaseClass = baseStaticClass;
      }

      // Evaluate data-attr-class FIRST so subsequent data-class-* toggles layer cleanly on top
      if (el.hasAttribute("data-attr-class")) {
        const dynCls = String(evaluateRmlExpr(el.getAttribute("data-attr-class"), models, localScope) || "").trim();
        el.className = (baseStaticClass + " " + dynCls).trim();
      }

      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        const name = attr.name;
        const val = attr.value;

        if (name === "data-attr-class") {
          continue;
        } else if (name.startsWith("data-class-")) {
          const clsName = name.slice("data-class-".length);
          const active = !!evaluateRmlExpr(val, models, localScope);
          el.classList.toggle(clsName, active);
        } else if (name.startsWith("data-attrif-")) {
          const targetAttr = name.slice("data-attrif-".length);
          const cond = !!evaluateRmlExpr(val, models, localScope);
          if (cond) el.setAttribute(targetAttr, "");
          else el.removeAttribute(targetAttr);
        } else if (name.startsWith("data-attr-")) {
          const targetAttr = name.slice("data-attr-".length);
          const evaluated = evaluateRmlExpr(val, models, localScope);
          if (evaluated !== undefined && evaluated !== null) {
            el.setAttribute(targetAttr, String(evaluated));
            if (targetAttr === "src" && el.tagName === "IMG" && String(evaluated)) {
              el.src = resolveSpriteOrTextureUrl(String(evaluated));
            } else if (targetAttr === "sprite" && el.tagName === "IMG" && String(evaluated) && !el.getAttribute("src")) {
              el.src = resolveSpriteOrTextureUrl(String(evaluated));
            }
          }
        } else if (name.startsWith("data-style-")) {
          const styleProp = name.slice("data-style-".length);
          const evaluated = evaluateRmlExpr(val, models, localScope);
          if (styleProp === "decorator") {
            const evalStr = String(evaluated || "");
            const cssText = compileDecoratorDeclarations(evalStr, null, "");
            for (const stmt of cssText.split(";")) {
              const idx = stmt.indexOf(":");
              if (idx > 0) {
                el.style.setProperty(stmt.slice(0, idx).trim(), stmt.slice(idx + 1).trim());
              }
            }
            const itemMatch = /^\s*itemidimage\s*\(\s*([^)]+?)\s*\)/i.exec(evalStr);
            if (itemMatch) {
              const dynItemId = resolveItemId(itemMatch[1]);
              if (dynItemId > 0) bindItemIconBg(el, dynItemId);
            }
          } else if (evaluated !== undefined && evaluated !== null) {
            el.style.setProperty(styleProp, convertRcssValue(String(evaluated)));
          }
        }
      }

      if (el.hasAttribute("data-rml")) {
        const htmlVal = evaluateRmlExpr(el.getAttribute("data-rml"), models, localScope);
        const strHtml = String(htmlVal ?? "");
        if (el.__rmlLastHtml !== strHtml) {
          el.__rmlLastHtml = strHtml;
          el.innerHTML = strHtml;
        }
      }

      // Custom Element: <rml-truncating-string source="...">
      if (el.tagName === "RML-TRUNCATING-STRING") {
        const srcHtml = el.getAttribute("source");
        if (srcHtml !== null && el.__rmlLastSource !== srcHtml) {
          el.__rmlLastSource = srcHtml;
          el.innerHTML = srcHtml;
        }
        const lines = parseInt(el.getAttribute("lines") || "1", 10);
        if (lines > 1) {
          el.style.display = "-webkit-box";
          el.style.webkitBoxOrient = "vertical";
          el.style.webkitLineClamp = String(lines);
          el.style.whiteSpace = "normal";
        }
      }

      // Custom Element: <rml-progress value="..." max="..."> -> auto-manages <rml-fill>
      if (el.tagName === "RML-PROGRESS") {
        let fillEl = el.querySelector("rml-fill");
        if (!fillEl) {
          fillEl = document.createElement("rml-fill");
          el.appendChild(fillEl);
        }
        const curV = Math.max(0, Number(el.getAttribute("value") || 0));
        const maxV = Math.max(1, Number(el.getAttribute("max") || 1));
        const pct = Math.max(0, Math.min(100, (curV / maxV) * 100));
        fillEl.style.width = pct.toFixed(2) + "%";
      }

      if (el.tagName === "INPUT") {
        if (el.type === "radio") el.classList.add("radio");
        if (el.type === "text") el.classList.add("text");
        if (el.type === "checkbox") el.classList.add("checkbox");

        if (el.type === "radio") {
          if (el.hasAttribute("data-value")) {
            const optVal = evaluateRmlExpr(el.getAttribute("data-value"), models, localScope);
            if (optVal !== undefined && optVal !== null) el.value = String(optVal);
          }
          if (el.hasAttribute("data-checked")) {
            const expr = el.getAttribute("data-checked");
            if (!el.name) el.name = expr;
            const cur = evaluateRmlExpr(expr, models, localScope);
            const isChecked = String(cur) === String(el.value);
            el.checked = isChecked;
            el.classList.toggle("checked", isChecked);
            if (!el.__rmlCheckBound) {
              el.__rmlCheckBound = true;
              const selectRadio = (ev) => {
                const parsed = /^-?\d+$/.test(el.value) ? parseInt(el.value, 10) : el.value;
                assignModelPath(models, localScope, expr, parsed);
                if (el.hasAttribute("data-rml-onchange")) {
                  dispatchRmlStatement(el.getAttribute("data-rml-onchange"), ev, el, localScope);
                }
                refresh();
              };
              el.addEventListener("change", selectRadio);
              if (el.parentElement && el.parentElement.classList.contains("radio-container")) {
                el.parentElement.style.cursor = "pointer";
                el.parentElement.addEventListener("click", (ev) => {
                  if (ev.target !== el) {
                    el.checked = true;
                    selectRadio(ev);
                  }
                });
              }
            }
          }
        } else {
          if (el.hasAttribute("data-value")) {
            const expr = el.getAttribute("data-value");
            const v = evaluateRmlExpr(expr, models, localScope);
            const strV = v === undefined || v === null ? "" : String(v);
            if (document.activeElement !== el && shadow.activeElement !== el && el.value !== strV) {
              el.value = strV;
            }
            if (!el.__rmlValueBound) {
              el.__rmlValueBound = true;
              el.addEventListener("input", (ev) => {
                let nextVal = el.value;
                if (el.getAttribute("data-numeric") === "1") {
                  nextVal = nextVal.replace(/[^0-9]/g, "");
                  if (el.value !== nextVal) el.value = nextVal;
                }
                assignModelPath(models, localScope, expr, nextVal);
                if (el.hasAttribute("data-rml-oninput")) {
                  dispatchRmlStatement(el.getAttribute("data-rml-oninput"), ev, el, localScope);
                }
                refresh();
              });
            }
          }
          if (el.hasAttribute("data-checked")) {
            const expr = el.getAttribute("data-checked").trim();
            const isLiteralBool = expr === "true" || expr === "false";
            if (isLiteralBool) {
              if (!el.__rmlLiteralCheckInit) {
                el.__rmlLiteralCheckInit = true;
                el.checked = expr === "true";
                el.classList.toggle("checked", el.checked);
              }
            } else {
              const cur = evaluateRmlExpr(expr, models, localScope);
              const isChecked = !!cur;
              el.checked = isChecked;
              el.classList.toggle("checked", isChecked);
            }
            if (!el.__rmlCheckBound) {
              el.__rmlCheckBound = true;
              el.addEventListener("change", (ev) => {
                el.classList.toggle("checked", el.checked);
                if (!isLiteralBool) {
                  assignModelPath(models, localScope, expr, el.checked);
                }
                if (el.hasAttribute("data-rml-onchange")) {
                  dispatchRmlStatement(el.getAttribute("data-rml-onchange"), ev, el, localScope);
                }
                if (!isLiteralBool) refresh();
              });
            }
          }
        }
      }

      if (el.tagName === "IMG") {
        if (!el.__rmlImgDimsChecked) {
          el.__rmlImgDimsChecked = true;
          const wAttr = el.getAttribute("width") || "";
          const hAttr = el.getAttribute("height") || "";
          if (/dp$/i.test(wAttr) && !el.style.width) el.style.width = convertRcssValue(wAttr);
          if (/dp$/i.test(hAttr) && !el.style.height) el.style.height = convertRcssValue(hAttr);
        }
        if (!el.__rmlImgResolved) {
          if (el.hasAttribute("src") && !el.hasAttribute("data-attr-src")) {
            el.__rmlImgResolved = true;
            el.src = resolveSpriteOrTextureUrl(el.getAttribute("src"));
          } else if (el.hasAttribute("sprite") && !el.hasAttribute("data-attr-sprite")) {
            el.__rmlImgResolved = true;
            el.src = resolveSpriteOrTextureUrl(el.getAttribute("sprite"));
          }
        }
      }

      if (el.tagName === "RML-ITEMID-IMG") {
        const rawId = el.getAttribute("itemid");
        const numId = resolveItemId(rawId);
        if (numId > 0) {
          bindItemIconBg(el, numId);
          el.style.visibility = "visible";
        } else {
          el.style.backgroundImage = "none";
          el.style.visibility = "hidden";
        }
      }

      if (el.tagName === "RML-PLAYER-PORTRAIT") {
        if (!el.__rmlPortraitCanvas) {
          const c = document.createElement("canvas");
          c.width = 96;
          c.height = 96;
          el.appendChild(c);
          el.__rmlPortraitCanvas = c;
          instancePortraits.add(el);
          activePortraits.add(el);
        }
        syncPortraitElement(el);
      }

      if (el.tagName === "RML-TIMER") {
        if (!el.__rmlTimerInit) {
          el.__rmlTimerInit = true;
          el.__rmlScope = localScope;
          instanceTimers.add(el);
          activeTimers.add(el);
        }
        el.__rmlScope = localScope;
        const rawSec = el.getAttribute("seconds");
        const rawEnd = el.getAttribute("end-epoch");
        if (rawEnd !== null && rawEnd !== "") {
          el.__rmlTargetMs = Number(rawEnd) * 1000;
        } else if (rawSec !== null && rawSec !== "") {
          const sNum = Number(rawSec);
          if (el.__rmlLastRawSec !== sNum) {
            el.__rmlLastRawSec = sNum;
            el.__rmlTargetMs = Date.now() + Math.max(0, sNum) * 1000;
            el.__rmlFinished = false;
          }
        }
        tickTimerElement(el, dispatchRmlStatement);
      }

      el.__rmlScope = localScope;
      for (const [attrName, domName] of [
        ["data-rml-onclick", "click"],
        ["data-rml-onmousedown", "mousedown"],
        ["data-rml-onscroll", "scroll"],
      ]) {
        if (el.hasAttribute(attrName) && !el["__bound_" + domName]) {
          el["__bound_" + domName] = true;
          el.addEventListener(domName, (ev) => {
            if (el.classList.contains("disabled") || el.classList.contains("img-button-disabled")) {
              ev.stopPropagation();
              return;
            }
            dispatchRmlStatement(el.getAttribute(attrName), ev, el, el.__rmlScope);
          });
        }
      }

      if (el.hasAttribute("data-event-click") && !el.__boundDataEventClick) {
        el.__boundDataEventClick = true;
        el.addEventListener("click", (ev) => {
          if (el.classList.contains("disabled") || el.classList.contains("img-button-disabled")) {
            ev.stopPropagation();
            return;
          }
          dispatchDataEventClick(el.getAttribute("data-event-click"), ev, el, el.__rmlScope);
        });
      }

      if (el.hasAttribute("data-rml") || el.tagName === "RML-TRUNCATING-STRING") return;

      const children = Array.from(el.childNodes);
      for (const ch of children) {
        if (ch.nodeType === Node.COMMENT_NODE && ch.__rmlForProto) {
          syncForAnchor(ch, localScope);
        } else if (ch.__rmlForManaged) {
          continue;
        } else {
          bindElementTree(ch, localScope);
        }
      }
    }

    function syncForAnchor(anchor, parentScope) {
      const m = /^\s*([a-zA-Z0-9_]+)\s*:\s*([\s\S]+)$/.exec(anchor.__rmlForSpec);
      if (!m) return;
      let effectiveScope = parentScope;
      if (anchor.__rmlForModel && models[anchor.__rmlForModel] && typeof models[anchor.__rmlForModel] === "object") {
        effectiveScope = Object.assign({}, parentScope, models[anchor.__rmlForModel]);
      }
      const itemVar = m[1];
      const listVal = evaluateRmlExpr(m[2], models, effectiveScope);
      const arr = Array.isArray(listVal) ? listVal : [];
      const curNodes = anchor.__rmlForItems;

      while (curNodes.length > arr.length) {
        const rem = curNodes.pop();
        if (rem && rem.parentNode) rem.parentNode.removeChild(rem);
      }
      while (curNodes.length < arr.length) {
        const clone = anchor.__rmlForProto.cloneNode(true);
        clone.__rmlForManaged = true;
        const refAfter = curNodes.length > 0 ? curNodes[curNodes.length - 1].nextSibling : anchor.nextSibling;
        anchor.parentNode.insertBefore(clone, refAfter);
        curNodes.push(clone);
      }
      for (let idx = 0; idx < arr.length; idx++) {
        const itemScope = Object.assign({}, effectiveScope, {
          [itemVar]: arr[idx],
          it_index: idx,
        });
        bindElementTree(curNodes[idx], itemScope);
      }
    }

    let eventsUpArrow = null;
    let eventsDownArrow = null;

    function syncEventsScrollArrows() {
      const ep = bodyEl.querySelector("#events_panel");
      const lp = bodyEl.querySelector("#left_panel");
      if (!ep || !lp) return;
      if (!eventsUpArrow) {
        eventsUpArrow = document.createElement("div");
        eventsUpArrow.id = "rml-events-scroll-up";
        eventsUpArrow.className = "rml-events-scroll-arrow up";
        eventsUpArrow.style.display = "none";
        eventsUpArrow.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ep.scrollBy({ top: -Math.round(92 * computeDpScale()), behavior: "smooth" });
          setTimeout(syncEventsScrollArrows, 180);
          setTimeout(syncEventsScrollArrows, 360);
        });
        lp.appendChild(eventsUpArrow);

        eventsDownArrow = document.createElement("div");
        eventsDownArrow.id = "rml-events-scroll-down";
        eventsDownArrow.className = "rml-events-scroll-arrow down";
        eventsDownArrow.style.display = "none";
        eventsDownArrow.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ep.scrollBy({ top: Math.round(92 * computeDpScale()), behavior: "smooth" });
          setTimeout(syncEventsScrollArrows, 180);
          setTimeout(syncEventsScrollArrows, 360);
        });
        lp.appendChild(eventsDownArrow);

        ep.addEventListener("scroll", syncEventsScrollArrows, { passive: true });
      }
      const ch = ep.clientHeight;
      const sh = ep.scrollHeight;
      const st = ep.scrollTop;
      if (ch <= 0 || sh <= ch + 4) {
        eventsUpArrow.style.display = "none";
        eventsDownArrow.style.display = "none";
        return;
      }
      const canUp = st > 3;
      const canDown = st + ch < sh - 3;
      const arrowH = Math.max(16, Math.round(28 * computeDpScale()));
      eventsUpArrow.style.left = ep.offsetLeft + "px";
      eventsUpArrow.style.top = ep.offsetTop + "px";
      eventsUpArrow.style.display = canUp ? "block" : "none";

      eventsDownArrow.style.left = ep.offsetLeft + "px";
      eventsDownArrow.style.bottom = "auto";
      eventsDownArrow.style.top = Math.max(0, ep.offsetTop + ch - arrowH) + "px";
      eventsDownArrow.style.display = canDown ? "block" : "none";
    }

    function refresh() {
      if (destroyed) return;
      updateDpVariable();
      bindElementTree(bodyEl, {});
      positionSlideOutDrawer("ftueButtonPanel", "FTUEButton");
      syncEventsScrollArrows();
      if (typeof g.requestAnimationFrame === "function") {
        g.requestAnimationFrame(() => {
          if (!destroyed) syncEventsScrollArrows();
        });
      }
    }

    refresh();

    const onResize = () => refresh();
    g.addEventListener("resize", onResize);

    return {
      shadowRoot: shadow,
      bodyEl,
      models,
      refresh,
      positionSlideOutDrawer,
      syncEventsScrollArrows,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        g.removeEventListener("resize", onResize);
        for (const t of instanceTimers) activeTimers.delete(t);
        for (const p of instancePortraits) activePortraits.delete(p);
        instanceTimers.clear();
        instancePortraits.clear();
        shadow.innerHTML = "";
      },
    };
  }

  // -------------------------------------------------------------------------
  // 7. Client-Side Growtopia items.dat + .rttex Item Icon Resolver Fallback
  // -------------------------------------------------------------------------
  const ITEM_XOR_KEY = "PBG892FXX982ABC*";
  const resolvedIconUrlCache = new Map();
  const pendingIconResolvers = new Map();
  let clientIconDbPromise = null;
  const decodedSheetCache = new Map();

  function loadClientIconDb() {
    if (clientIconDbPromise) return clientIconDbPromise;
    clientIconDbPromise = (async () => {
      const itemsMap = new Map();
      const vfsSlices = new Map();
      try {
        const [itemsRes, vfsRes] = await Promise.all([
          fetch("/cache/items.dat"),
          fetch("/MagnoliaClient-1.50.js"),
        ]);
        if (vfsRes.ok) {
          const js = await vfsRes.text();
          const re = /\{\s*"?filename"?\s*:\s*"([^"]+)"\s*,\s*"?start"?\s*:\s*(\d+)\s*,\s*"?end"?\s*:\s*(\d+)\s*\}/g;
          let m;
          while ((m = re.exec(js)) !== null) {
            const norm = m[1].replace(/^\/+/, "").toLowerCase();
            vfsSlices.set(norm, { start: parseInt(m[2], 10), end: parseInt(m[3], 10) });
          }
        }
        let itemsAb = null;
        if (itemsRes.ok) {
          itemsAb = await itemsRes.arrayBuffer();
        } else {
          const itemsSlice = vfsSlices.get("cache/items.dat") || vfsSlices.get("items.dat");
          if (itemsSlice && itemsSlice.end > itemsSlice.start) {
            const sr = await fetch("/client/client.data", {
              headers: { Range: `bytes=${itemsSlice.start}-${itemsSlice.end - 1}` },
            });
            if (sr.status === 206 || sr.ok) itemsAb = await sr.arrayBuffer();
          }
        }
        if (itemsAb && itemsAb.byteLength > 16) {
          const u8 = new Uint8Array(itemsAb);
          const dv = new DataView(itemsAb);
          const td = new TextDecoder("utf-8");
          let off = 0;
          const rU16 = () => { const v = dv.getUint16(off, true); off += 2; return v; };
          const rI32 = () => { const v = dv.getInt32(off, true); off += 4; return v; };
          const rStr = () => {
            const len = rU16();
            const s = td.decode(u8.subarray(off, off + len));
            off += len;
            return s;
          };
          const rXorStr = (id) => {
            const len = rU16();
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              out[i] = u8[off + i] ^ ITEM_XOR_KEY.charCodeAt((i + id) % ITEM_XOR_KEY.length);
            }
            off += len;
            return td.decode(out);
          };
          const version = rU16();
          const count = rI32();
          for (let i = 0; i < count && off < u8.length; i++) {
            const id = rI32();
            off += 2; // editableType + itemCategory
            const actionType = u8[off++];
            off += 1; // hitSoundType
            const name = rXorStr(id);
            const texture = rStr();
            const tx = u8[off + 9];
            const ty = u8[off + 10];
            const spreadType = u8[off + 11];
            off += 23;
            rStr(); // extraFile
            off += 8; // extraFileHash + audioVolume
            rStr(); // petName
            rStr(); // petPrefix
            rStr(); // petSuffix
            rStr(); // petAbility
            off += 24;
            rStr(); // extraOptions
            rStr(); // texture2
            rStr(); // extraOptions2
            off += 80;
            if (version >= 11) rStr();
            if (version >= 12) off += 13;
            if (version >= 13) off += 4;
            if (version >= 14) off += 4;
            if (version >= 15) { off += 25; rStr(); }
            if (version >= 16) rStr();
            if (version >= 17) off += 4;
            if (version >= 18) off += 4;
            const isSeed = (id % 2 === 1 && actionType === 19) || name.endsWith(" Seed");
            itemsMap.set(id, { id, texture, tx, ty, spreadType, isSeed });
          }
        }
      } catch (_e) {}
      return { itemsMap, vfsSlices };
    })();
    return clientIconDbPromise;
  }

  async function inflateZlibBytes(compressedU8) {
    if (typeof DecompressionStream !== "function") return null;
    for (const fmt of ["deflate", "deflate-raw"]) {
      try {
        const ds = new DecompressionStream(fmt);
        const writer = ds.writable.getWriter();
        writer.write(compressedU8);
        writer.close();
        const ab = await new Response(ds.readable).arrayBuffer();
        return new Uint8Array(ab);
      } catch (_e) {}
    }
    return null;
  }

  async function loadRttexSheet(vfsSlices, rawTex) {
    const clean = String(rawTex || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    if (!clean) return null;
    if (decodedSheetCache.has(clean)) return decodedSheetCache.get(clean);
    const candidates = clean.startsWith("game/") ? [clean] : ["game/" + clean, clean];
    let rawBytes = null;
    for (const cand of candidates) {
      const slice = vfsSlices.get(cand);
      if (slice && slice.end > slice.start) {
        try {
          const r = await fetch("/client/client.data", {
            headers: { Range: `bytes=${slice.start}-${slice.end - 1}` },
          });
          if (r.status === 206 || r.ok) {
            rawBytes = new Uint8Array(await r.arrayBuffer());
            if (r.status === 200 && rawBytes.length > slice.end) {
              rawBytes = rawBytes.subarray(slice.start, slice.end);
            }
            break;
          }
        } catch (_e) {}
      }
    }
    if (!rawBytes || rawBytes.length < 32) {
      decodedSheetCache.set(clean, null);
      return null;
    }
    let rttx = rawBytes;
    const magic6 = String.fromCharCode(rttx[0], rttx[1], rttx[2], rttx[3], rttx[4], rttx[5]);
    if (magic6 === "RTPACK") {
      rttx = await inflateZlibBytes(rttx.subarray(32));
      if (!rttx || rttx.length < 124) {
        decodedSheetCache.set(clean, null);
        return null;
      }
    }
    const sig = String.fromCharCode(rttx[0], rttx[1], rttx[2], rttx[3], rttx[4], rttx[5]);
    if (sig !== "RTTXTR") {
      decodedSheetCache.set(clean, null);
      return null;
    }
    const dv = new DataView(rttx.buffer, rttx.byteOffset, rttx.byteLength);
    const height = dv.getInt32(8, true);
    const width = dv.getInt32(12, true);
    const format = dv.getInt32(16, true);
    const usesAlpha = rttx[28] !== 0;
    const bpp = format === 0x1401 ? (usesAlpha ? 4 : 3) : 4;
    const pixelStart = 124;
    if (width <= 0 || height <= 0 || rttx.length < pixelStart + width * height * bpp) {
      decodedSheetCache.set(clean, null);
      return null;
    }
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const sIdx = pixelStart + (srcRow * width + x) * bpp;
        const dIdx = (y * width + x) * 4;
        rgba[dIdx] = rttx[sIdx];
        rgba[dIdx + 1] = rttx[sIdx + 1];
        rgba[dIdx + 2] = rttx[sIdx + 2];
        rgba[dIdx + 3] = bpp === 4 ? rttx[sIdx + 3] : 255;
      }
    }
    const decoded = { width, height, rgba };
    decodedSheetCache.set(clean, decoded);
    return decoded;
  }

  async function decodeClientItemIconDataUrl(itemId) {
    const db = await loadClientIconDb();
    let meta = db.itemsMap.get(itemId);
    if (!meta) return null;
    if (meta.isSeed && db.itemsMap.has(itemId - 1)) {
      meta = db.itemsMap.get(itemId - 1);
    }
    const sheet = await loadRttexSheet(db.vfsSlices, meta.texture);
    if (!sheet) return null;
    let ix = meta.tx;
    let iy = meta.ty;
    if (meta.spreadType === 2 || meta.spreadType === 5) {
      ix += 4;
      iy += 1;
    } else if (meta.spreadType === 3 || meta.spreadType === 4) {
      ix += 3;
    }
    const cols = Math.max(1, Math.floor(sheet.width / 32));
    if (ix >= cols) {
      iy += Math.floor(ix / cols);
      ix = ix % cols;
    }
    const px = ix * 32;
    const py = iy * 32;
    if (px + 32 > sheet.width || py + 32 > sheet.height) return null;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d");
    const imgData = ctx.createImageData(32, 32);
    for (let y = 0; y < 32; y++) {
      const sOff = ((py + y) * sheet.width + px) * 4;
      imgData.data.set(sheet.rgba.subarray(sOff, sOff + 128), y * 128);
    }
    ctx.putImageData(imgData, 0, 0);
    return c.toDataURL("image/png");
  }

  function resolveVerifiedItemIconUrl(itemId) {
    const numId = Number(itemId) | 0;
    if (numId <= 0) return Promise.resolve("");
    if (resolvedIconUrlCache.has(numId)) return Promise.resolve(resolvedIconUrlCache.get(numId));
    if (pendingIconResolvers.has(numId)) return pendingIconResolvers.get(numId);

    const apiUrl = `/api/item-icon/${numId}.png`;
    const p = new Promise((resolve) => {
      const probe = new Image();
      probe.onload = async () => {
        if (probe.naturalWidth > 1 && probe.naturalHeight > 1) {
          resolvedIconUrlCache.set(numId, apiUrl);
          pendingIconResolvers.delete(numId);
          resolve(apiUrl);
        } else {
          const dataUrl = await decodeClientItemIconDataUrl(numId);
          const finalUrl = dataUrl || "/GameData/sprites/_rects/shop_icon.png";
          resolvedIconUrlCache.set(numId, finalUrl);
          pendingIconResolvers.delete(numId);
          resolve(finalUrl);
        }
      };
      probe.onerror = async () => {
        const dataUrl = await decodeClientItemIconDataUrl(numId);
        const finalUrl = dataUrl || "/GameData/sprites/_rects/shop_icon.png";
        resolvedIconUrlCache.set(numId, finalUrl);
        pendingIconResolvers.delete(numId);
        resolve(finalUrl);
      };
      probe.src = apiUrl;
    });
    pendingIconResolvers.set(numId, p);
    return p;
  }

  function bindItemIconImg(imgEl, itemId) {
    if (!imgEl) return;
    const numId = Number(itemId) | 0;
    if (numId <= 0) return;
    imgEl.__rmlWantedItemId = numId;
    if (resolvedIconUrlCache.has(numId)) {
      imgEl.src = resolvedIconUrlCache.get(numId);
      return;
    }
    imgEl.src = `/api/item-icon/${numId}.png`;
    resolveVerifiedItemIconUrl(numId).then((url) => {
      if (url && imgEl.__rmlWantedItemId === numId && imgEl.src !== url) {
        imgEl.src = url;
      }
    });
  }

  function bindItemIconBg(el, itemId) {
    if (!el) return;
    const numId = Number(itemId) | 0;
    if (numId <= 0) return;
    el.__rmlWantedItemId = numId;
    if (resolvedIconUrlCache.has(numId)) {
      el.style.backgroundImage = `url("${resolvedIconUrlCache.get(numId)}")`;
      return;
    }
    el.style.backgroundImage = `url("/api/item-icon/${numId}.png")`;
    resolveVerifiedItemIconUrl(numId).then((url) => {
      if (url && el.__rmlWantedItemId === numId) {
        el.style.backgroundImage = `url("${url}")`;
      }
    });
  }

  // -------------------------------------------------------------------------
  // 8. Shared Tickers for <Timer> and <PlayerPortret>
  // -------------------------------------------------------------------------
  function tickTimerElement(el, dispatchFn) {
    const targetMs = el.__rmlTargetMs || 0;
    const remSec = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    const secPost1m = el.getAttribute("sec-post-1m") === "true";
    const textStr = formatDurationSeconds(remSec, secPost1m);

    const activeChild = el.querySelector("rml-active");
    const expiredChild = el.querySelector("rml-expired");
    const timerTextNodes = el.querySelectorAll("rml-timertext");

    if (timerTextNodes.length > 0) {
      timerTextNodes.forEach((tn) => {
        if (tn.textContent !== textStr) tn.textContent = textStr;
      });
    } else if (!activeChild && !expiredChild) {
      if (el.textContent !== textStr) el.textContent = textStr;
    }

    if (activeChild) activeChild.style.display = remSec > 0 ? "inline" : "none";
    if (expiredChild) expiredChild.style.display = remSec <= 0 ? "inline" : "none";

    if (remSec <= 0 && !el.__rmlFinished) {
      el.__rmlFinished = true;
      if (dispatchFn && el.hasAttribute("data-rml-onfinish")) {
        dispatchFn(el.getAttribute("data-rml-onfinish"), null, el, el.__rmlScope || {});
      }
    }
  }

  function syncPortraitElement(el) {
    if (!g.NativeChatHeads || typeof g.NativeChatHeads.localPortrait !== "function") return;
    const lp = g.NativeChatHeads.localPortrait();
    if (!lp || !lp.canvas) return;
    if (el.__rmlPortraitKey === lp.key) return;
    el.__rmlPortraitKey = lp.key;
    const dst = el.__rmlPortraitCanvas;
    if (!dst) return;
    dst.width = lp.canvas.width;
    dst.height = lp.canvas.height;
    const ctx = dst.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(lp.canvas, 0, 0);
  }

  setInterval(() => {
    for (const el of activeTimers) {
      tickTimerElement(el, null);
    }
    for (const el of activePortraits) {
      syncPortraitElement(el);
    }
  }, 500);

  ensureMetadata();

  g.RmlUiEngine = {
    wasm: wasmBridge,
    ensureMetadata,
    ensureNativeRmlUi,
    preloadUiResources,
    getNative: () => (g.__rmluiNative && g.__rmluiNative.ready ? g.__rmluiNative : null),
    setSoundMuted: (m) => {
      const n = g.__rmluiNative;
      if (n && typeof n.setSoundMuted === "function") n.setSoundMuted(m);
    },
    loadCompiledDocument,
    mountDocument,
    toRmlText,
    localize: localizeString,
    resolveItemId,
    resolveSpriteOrTextureUrl,
    resolveVerifiedItemIconUrl,
    bindItemIconImg,
    bindItemIconBg,
    computeDpScale,
  };
})(globalThis);
