import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { encodeRgbaPng } from "../items/iconRenderer";
import type { ModernDialogSpec } from "../tools/modern_dialog";
import { DISCORD_ICON_ITEM_ID } from "../database/items";

type Image = { width: number; height: number; rgba: Buffer };

/** Minimal PNG decoder for Chrome screenshots (RGBA/RGB, 8-bit, non-interlaced). */
function decodePng(input: Buffer): Image | null {
  try {
    let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat: Buffer[] = [];
    while (p + 8 <= input.length) {
      const len = input.readUInt32BE(p);
      const type = input.subarray(p + 4, p + 8).toString("ascii");
      const data = input.subarray(p + 8, p + 8 + len);
      p += 12 + len;
      if (type === "IHDR") {
        w = data.readUInt32BE(0); h = data.readUInt32BE(4);
        bitDepth = data[8]; colorType = data[9]; interlace = data[12];
      } else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      if (w > 4000 || h > 4000) return null;
    }
    if (!w || !h || bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) return null;
    const channels = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * channels;
    const pixels = Buffer.alloc(w * h * channels);
    let q = 0;
    for (let y = 0; y < h; y++) {
      const filter = raw[q++];
      const row = raw.subarray(q, q + stride); q += stride;
      const dst = y * stride, prev = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? pixels[dst + x - channels] : 0;
        const b = y ? pixels[prev + x] : 0;
        const c = x >= channels && y ? pixels[prev + x - channels] : 0;
        let v = row[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        pixels[dst + x] = v & 255;
      }
    }
    if (channels === 4) return { width: w, height: h, rgba: pixels };
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      rgba[j] = pixels[i]; rgba[j + 1] = pixels[i + 1]; rgba[j + 2] = pixels[i + 2]; rgba[j + 3] = 255;
    }
    return { width: w, height: h, rgba };
  } catch {
    return null;
  }
}

/** Crops the transparent screenshot down to the visible dialog (plus its small drop shadow). */
function trimTransparent(img: Image): Image | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const pad = 2;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(img.width - 1, maxX + pad); maxY = Math.min(img.height - 1, maxY + pad);
  const width = maxX - minX + 1, height = maxY - minY + 1;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = ((minY + y) * img.width + minX) * 4;
    img.rgba.copy(rgba, y * width * 4, src, src + width * 4);
  }
  return { width, height, rgba };
}

/**
 * The native RmlUi WASM renderer paints an opaque canvas (usually light gray),
 * unlike the ShadowDOM fallback which honours the transparent page background.
 * Flood-fill that uniform canvas colour from the corners before trimming so the
 * Discord attachment keeps a transparent background.
 */
function clearOpaqueCanvasBackground(img: Image): void {
  const { width: w, height: h, rgba } = img;
  if (w < 2 || h < 2) return;
  const cornerAlpha = rgba[3];
  if (cornerAlpha < 8) return; // already transparent
  const corner = [rgba[0], rgba[1], rgba[2]];
  const center = ((Math.floor(h / 2) * w) + Math.floor(w / 2)) * 4;
  if (rgba[center + 3] > 8) {
    const same = Math.abs(rgba[center] - corner[0]) <= 12
      && Math.abs(rgba[center + 1] - corner[1]) <= 12
      && Math.abs(rgba[center + 2] - corner[2]) <= 12;
    if (same) return; // dialog fills the frame; never erase it
  }
  const tol = 18;
  const alphaTol = 28;
  const matches = (i: number): boolean => {
    const p = i * 4;
    return rgba[p + 3] > 0
      && Math.abs(rgba[p + 3] - cornerAlpha) <= alphaTol
      && Math.abs(rgba[p] - corner[0]) <= tol
      && Math.abs(rgba[p + 1] - corner[1]) <= tol
      && Math.abs(rgba[p + 2] - corner[2]) <= tol;
  };
  const stack = new Int32Array(w * h);
  let top = 0;
  const start = 0;
  if (!matches(start)) return;
  rgba[3] = 0;
  stack[top++] = start;
  while (top > 0) {
    const idx = stack[--top];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0 && matches(idx - 1)) { rgba[(idx - 1) * 4 + 3] = 0; stack[top++] = idx - 1; }
    if (x + 1 < w && matches(idx + 1)) { rgba[(idx + 1) * 4 + 3] = 0; stack[top++] = idx + 1; }
    if (y > 0 && matches(idx - w)) { rgba[(idx - w) * 4 + 3] = 0; stack[top++] = idx - w; }
    if (y + 1 < h && matches(idx + w)) { rgba[(idx + w) * 4 + 3] = 0; stack[top++] = idx + w; }
  }
}

interface PendingBanner {
  spec: ModernDialogSpec;
  headPng?: Buffer;
  expiresAt: number;
}

const pendingBanners = new Map<string, PendingBanner>();
const BANNER_TOKEN_TTL_MS = 60_000;

export function takeBannerRenderPage(token: string): string | null {
  const entry = pendingBanners.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingBanners.delete(token);
    return null;
  }
  const specJson = JSON.stringify(entry.spec).replace(/</g, "\\u003c");
  const headB64 = entry.headPng && entry.headPng.length > 0 ? entry.headPng.toString("base64") : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Linked Banner</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #rml-popup-backdrop { background: transparent !important; }
</style>
</head>
<body>
<script src="/WebLoaderData/RmlUiEngine.js"></script>
<script src="/WebLoaderData/ModernDialogUI.js"></script>
<script>
  const spec = ${specJson};
  const headB64 = ${JSON.stringify(headB64)};
  function clearBackdrops() {
    const backdrop = document.getElementById("rml-popup-backdrop");
    if (backdrop) backdrop.style.setProperty("background-color", "transparent", "important");
    const host = document.getElementById("rml-popup-window-host");
    const shadow = host && host.shadowRoot;
    const black = shadow && shadow.querySelector(".black-bg");
    if (black) black.style.setProperty("background-color", "transparent", "important");
  }
  addEventListener("load", async () => {
    try {
      ModernDialogUI.install();
      if (headB64 && window.RmlUiEngine && RmlUiEngine.ensureNativeRmlUi) {
        const native = await RmlUiEngine.ensureNativeRmlUi().catch(() => null);
        if (native && typeof native.setVirtualFile === "function") {
          const raw = atob(headB64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          native.setVirtualFile("api/discord-head.png", bytes);
          if (spec.title) spec.title.iconUrl = "api/discord-head.png";
        } else if (spec.title) {
          spec.title.iconUrl = "data:image/png;base64," + headB64;
        }
      }
      await ModernDialogUI.open(spec);
      clearBackdrops();
      setInterval(clearBackdrops, 100);
      document.title = "READY";
    } catch (err) {
      console.error(err);
    }
  });
</script>
</body>
</html>`;
}

function chromeCandidates(): string[] {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "google-chrome",
    "chromium",
    "chrome",
  ];
  return candidates.filter((value): value is string => !!value);
}

function findChrome(): string | null {
  for (const candidate of chromeCandidates()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  return null;
}

function runChrome(chrome: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = spawn(chrome, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(false);
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

export interface LinkedBannerInput {
  growId: string;
  discordName: string;
  level: number;
  world: string;
  headPng?: Buffer;
  baseUrl: string;
}

/**
 * Renders the real `OnModernDialogRequest` popup (GenericPopup.rml through
 * RmlUiEngine) in headless Chrome and returns the cropped PNG. No hand-drawn
 * banner artwork: the image is the actual modern dialog design.
 */
export async function buildModernLinkedBanner(input: LinkedBannerInput): Promise<Buffer | null> {
  const chrome = findChrome();
  if (!chrome) {
    console.warn("[Discord] headless Chrome tidak ditemukan; banner modern dilewati.");
    return null;
  }

  const token = crypto.randomBytes(18).toString("hex");
  // The native RmlUi <img> loader cannot read data: URLs. The render page
  // registers the head bytes as a virtual file and points the title at it.
  const headUrl = input.headPng && input.headPng.length > 0
    ? "api/discord-head.png"
    : undefined;
  const spec: ModernDialogSpec = {
    version: 1,
    dialogName: "discord_linked_banner",
    widthDp: 700,
    title: headUrl
      ? { text: "Account Linked", iconUrl: headUrl }
      : { text: "Account Linked", itemId: DISCORD_ICON_ITEM_ID },
    embedData: {},
    hideCloseButton: true,
    blocks: [
      {
        type: "text",
        text: `\`w${input.growId}\`\` (Level ${input.level}) is linked to \`w@${input.discordName}\`\` from world \`w${input.world}\`\`.`,
        size: "md",
        align: "left",
      },
      { type: "spacer", size: "sm" },
      {
        type: "text",
        text: "Login attempts from a new `wDevice or Location`` are confirmed on Discord before they go through.",
        size: "sm",
        align: "left",
      },
      { type: "spacer", size: "sm" },
    ],
  };
  pendingBanners.set(token, { spec, headPng: input.headPng, expiresAt: Date.now() + BANNER_TOKEN_TTL_MS });
  while (pendingBanners.size > 20) {
    const oldest = pendingBanners.keys().next().value;
    if (!oldest) break;
    pendingBanners.delete(oldest);
  }

  const tmpRoot = path.join(os.tmpdir(), `gt-linked-banner-${token}`);
  const shotPath = path.join(tmpRoot, "shot.png");
  const profileDir = path.join(tmpRoot, "profile");
  fs.mkdirSync(profileDir, { recursive: true });

  try {
    const renderUrl = `${input.baseUrl.replace(/\/+$/, "")}/api/discord/linked-banner/${token}`;
    const ok = await runChrome(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-dev-shm-usage",
        "--default-background-color=00000000",
        "--window-size=1000,800",
        "--virtual-time-budget=8000",
        `--user-data-dir=${profileDir}`,
        `--screenshot=${shotPath}`,
        renderUrl,
      ],
      25_000
    );
    if (!ok || !fs.existsSync(shotPath)) {
      console.warn("[Discord] render banner modern gagal (Chrome tidak menghasilkan screenshot).");
      return null;
    }
    const decoded = decodePng(fs.readFileSync(shotPath));
    if (!decoded) {
      console.warn("[Discord] render banner modern gagal (PNG tidak bisa dibaca).");
      return null;
    }
    clearOpaqueCanvasBackground(decoded);
    const trimmed = trimTransparent(decoded);
    if (!trimmed) {
      console.warn("[Discord] render banner modern gagal (banner kosong).");
      return null;
    }
    return encodeRgbaPng(trimmed.width, trimmed.height, trimmed.rgba);
  } catch (err) {
    console.warn("[Discord] render banner modern gagal:", err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    pendingBanners.delete(token);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
