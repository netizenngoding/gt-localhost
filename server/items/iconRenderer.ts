import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { ItemDatabase } from "../database/items";
import { PART_SIZE } from "../client/data-package";

interface RawItemSpriteMeta {
  id: number;
  name: string;
  texture: string;
  tx: number;
  ty: number;
  spreadType: number;
  actionType: number;
  isSeed: boolean;
  seedColor: number;
  seedColor2: number;
}

interface DecodedSheet {
  width: number;
  height: number;
  rgba: Buffer; // top-to-bottom RGBA8888
}

interface VfsSlice {
  start: number;
  end: number;
}

const SECRET_KEY = "PBG892FXX982ABC*";

// Precomputed IEEE 802.3 CRC32 table for fast zero-dependency PNG encoding
const CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  if (data.length > 0) data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

export function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstOff = y * (stride + 1);
    rawScanlines[dstOff] = 0; // Filter type 0 (None)
    rgba.copy(rawScanlines, dstOff + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(rawScanlines, { level: 6 });

  return Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", compressed),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const TRANSPARENT_1X1_PNG = encodeRgbaPng(1, 1, Buffer.from([0, 0, 0, 0]));

export class ItemIconRenderer {
  private readonly rootDir: string;
  private readonly itemsDb: ItemDatabase;
  private initialized = false;
  private readonly itemMeta = new Map<number, RawItemSpriteMeta>();
  private readonly vfsIndex = new Map<string, VfsSlice>();
  private readonly sheetCache = new Map<string, DecodedSheet | null>();
  private readonly pngCache = new Map<number, Buffer>();

  constructor(itemsDb: ItemDatabase, rootDir: string) {
    this.itemsDb = itemsDb;
    this.rootDir = rootDir;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      this.parseItemsDat(this.itemsDb.rawItemsDat);
    } catch (err) {
      console.warn("[ItemIconRenderer] Failed to parse rawItemsDat:", err);
    }

    try {
      const loaderFile = path.join(this.rootDir, "public", "MagnoliaClient-1.50.js");
      if (fs.existsSync(loaderFile)) {
        const text = fs.readFileSync(loaderFile, "utf8");
        const re = /\{filename:"([^"]+)",start:(\d+),end:(\d+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          this.vfsIndex.set(m[1], {
            start: Number(m[2]),
            end: Number(m[3]),
          });
        }
      }
    } catch (err) {
      console.warn("[ItemIconRenderer] Failed to index VFS offsets:", err);
    }
  }

  private parseItemsDat(buf: Buffer): void {
    const version = buf.readUInt16LE(0);
    const count = buf.readUInt32LE(2);
    let pos = 6;

    const readStr = (): string => {
      const len = buf.readUInt16LE(pos);
      pos += 2;
      const s = buf.toString("latin1", pos, pos + len);
      pos += len;
      return s;
    };

    for (let idx = 0; idx < count && pos < buf.length; idx++) {
      const id = buf.readUInt32LE(pos);
      const actionType = buf[pos + 6];
      pos += 8;

      const nameLen = buf.readUInt16LE(pos);
      pos += 2;
      const nameChars = Buffer.allocUnsafe(nameLen);
      for (let i = 0; i < nameLen; i++) {
        nameChars[i] = buf[pos + i] ^ SECRET_KEY.charCodeAt((i + id) % 16);
      }
      pos += nameLen;
      const name = nameChars.toString("utf8");

      const texture = readStr();
      const tx = buf[pos + 9];
      const ty = buf[pos + 10];
      const spreadType = buf[pos + 11];
      pos += 23;

      readStr(); // extraFile
      pos += 8; // extraFileHash(4) + audioVolume(4)
      readStr(); // petName
      readStr(); // petPrefix
      readStr(); // petSuffix
      readStr(); // petAbility

      const seedColor = (0xff000000 | (buf.readUInt32BE(pos + 4) & 0xffffff)) >>> 0;
      const seedColor2 = (0xff000000 | (buf.readUInt32BE(pos + 8) & 0xffffff)) >>> 0;
      pos += 24;

      readStr(); // extraOptions
      readStr(); // texture2
      readStr(); // extraOptions2
      pos += 80;

      if (version >= 11) readStr();
      if (version >= 12) pos += 13;
      if (version >= 13) pos += 4;
      if (version >= 14) pos += 4;
      if (version >= 15) {
        pos += 25;
        readStr();
      }
      if (version >= 16) readStr();
      if (version >= 17) pos += 4;
      if (version >= 18) pos += 4;

      const isSeed = (id % 2 === 1 && actionType === 19) || name.endsWith(" Seed");
      this.itemMeta.set(id, {
        id,
        name,
        texture,
        tx,
        ty,
        spreadType,
        actionType,
        isSeed,
        seedColor,
        seedColor2,
      });
    }
  }

  private readRawRttex(relGamePath: string): Buffer | null {
    const cleanRel = relGamePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^game\//i, "");
    const diskCandidates = [
      path.join(this.rootDir, "public", "cache", "game", cleanRel),
      path.join(this.rootDir, "public", "GameData", cleanRel),
      path.join(this.rootDir, "data", "cache", "game", cleanRel),
      path.join(this.rootDir, "tools", "gt", "Growtopia", "game", cleanRel),
    ];
    for (const full of diskCandidates) {
      if (fs.existsSync(full)) {
        try {
          return fs.readFileSync(full);
        } catch {
          // try next candidate
        }
      }
    }

    const vfsKey = "/game/" + cleanRel;
    const slice = this.vfsIndex.get(vfsKey);
    if (!slice || slice.end <= slice.start) return null;

    const partsDir = path.join(this.rootDir, "data", "client", "parts");
    const singleData = path.join(this.rootDir, "data", "client", "client.data");
    const totalLen = slice.end - slice.start;
    const out = Buffer.allocUnsafe(totalLen);

    try {
      if (fs.existsSync(partsDir)) {
        let cur = slice.start;
        let written = 0;
        while (cur < slice.end) {
          const partIdx = Math.floor(cur / PART_SIZE);
          const partOff = cur % PART_SIZE;
          const take = Math.min(slice.end - cur, PART_SIZE - partOff);
          const partFile = path.join(partsDir, `part-${String(partIdx).padStart(3, "0")}.bin`);
          const fd = fs.openSync(partFile, "r");
          try {
            fs.readSync(fd, out, written, take, partOff);
          } finally {
            fs.closeSync(fd);
          }
          cur += take;
          written += take;
        }
        return out;
      }
      if (fs.existsSync(singleData)) {
        const fd = fs.openSync(singleData, "r");
        try {
          fs.readSync(fd, out, 0, totalLen, slice.start);
        } finally {
          fs.closeSync(fd);
        }
        return out;
      }
    } catch {
      return null;
    }
    return null;
  }

  private getDecodedSheet(relGamePath: string): DecodedSheet | null {
    const key = relGamePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^game\//i, "");
    if (this.sheetCache.has(key)) {
      return this.sheetCache.get(key) || null;
    }

    const raw = this.readRawRttex(key);
    if (!raw || raw.length < 124) {
      this.sheetCache.set(key, null);
      return null;
    }

    let rttxtr = raw;
    try {
      if (raw.subarray(0, 6).toString("ascii") === "RTPACK") {
        rttxtr = zlib.inflateSync(raw.subarray(32));
      }
    } catch {
      this.sheetCache.set(key, null);
      return null;
    }

    if (rttxtr.length < 124 || rttxtr.subarray(0, 6).toString("ascii") !== "RTTXTR") {
      this.sheetCache.set(key, null);
      return null;
    }

    const height = rttxtr.readInt32LE(8);
    const width = rttxtr.readInt32LE(12);
    const format = rttxtr.readInt32LE(16);
    const usesAlpha = rttxtr[28] !== 0;
    const bpp = format === 5121 ? (usesAlpha ? 4 : 3) : 4;
    const pixelOffset = 124;

    if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || pixelOffset + width * height * bpp > rttxtr.length) {
      this.sheetCache.set(key, null);
      return null;
    }

    const rgba = Buffer.allocUnsafe(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = height - 1 - y; // RTTEX stores rows bottom-to-top
      const srcBase = pixelOffset + srcRow * width * bpp;
      const dstBase = y * width * 4;
      if (bpp === 4) {
        rttxtr.copy(rgba, dstBase, srcBase, srcBase + width * 4);
      } else {
        for (let x = 0; x < width; x++) {
          const s = srcBase + x * 3;
          const d = dstBase + x * 4;
          rgba[d] = rttxtr[s];
          rgba[d + 1] = rttxtr[s + 1];
          rgba[d + 2] = rttxtr[s + 2];
          rgba[d + 3] = 255;
        }
      }
    }

    // Keep sheet cache bounded so server RAM footprint stays small (~16-24 MB max)
    if (this.sheetCache.size >= 10) {
      const oldest = this.sheetCache.keys().next().value;
      if (oldest !== undefined) this.sheetCache.delete(oldest);
    }

    const decoded: DecodedSheet = { width, height, rgba };
    this.sheetCache.set(key, decoded);
    return decoded;
  }

  private cropTile32(sheet: DecodedSheet, tileX: number, tileY: number): Buffer | null {
    const pxX = tileX * 32;
    const pxY = tileY * 32;
    if (pxX < 0 || pxY < 0 || pxX + 32 > sheet.width || pxY + 32 > sheet.height) return null;

    const tile = Buffer.allocUnsafe(32 * 32 * 4);
    let nonEmpty = false;
    for (let row = 0; row < 32; row++) {
      const srcStart = ((pxY + row) * sheet.width + pxX) * 4;
      const dstStart = row * 32 * 4;
      sheet.rgba.copy(tile, dstStart, srcStart, srcStart + 32 * 4);
      if (!nonEmpty) {
        for (let a = dstStart + 3; a < dstStart + 128; a += 4) {
          if (tile[a] > 0) {
            nonEmpty = true;
            break;
          }
        }
      }
    }
    return nonEmpty ? tile : null;
  }

  public getIconPng(itemId: number): Buffer {
    const id = Math.floor(Number(itemId));
    if (!Number.isFinite(id) || id <= 0) return TRANSPARENT_1X1_PNG;

    const cached = this.pngCache.get(id);
    if (cached) return cached;

    this.ensureInitialized();

    let meta = this.itemMeta.get(id);
    if (!meta || meta.name === "Unavailable Item") {
      return TRANSPARENT_1X1_PNG;
    }

    // If a seed item uses generic seed sheet, prefer its parent item's icon with subtle seed badge or parent icon
    if (meta.isSeed && id > 0 && this.itemMeta.has(id - 1)) {
      const parentMeta = this.itemMeta.get(id - 1)!;
      if (parentMeta && parentMeta.name !== "Unavailable Item") {
        meta = parentMeta;
      }
    }

    const cleanTex = meta.texture.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^game\//i, "");
    const candidates: string[] = [];
    if ((meta.actionType === 20 || meta.actionType === 107) && cleanTex.endsWith(".rttex") && !cleanTex.endsWith("_icon.rttex")) {
      candidates.push(cleanTex.slice(0, -6) + "_icon.rttex");
    }
    candidates.push(cleanTex);

    for (const cand of candidates) {
      const sheet = this.getDecodedSheet(cand);
      if (!sheet) continue;

      let ix = meta.tx;
      let iy = meta.ty;
      if (!cand.endsWith("_icon.rttex")) {
        if (meta.spreadType === 2 || meta.spreadType === 5) {
          ix += 4;
          iy += 1;
        } else if (meta.spreadType === 3 || meta.spreadType === 9) {
          ix += 3;
        } else if (meta.spreadType === 4) {
          ix += 4;
        }
      }

      let tile = this.cropTile32(sheet, ix, iy);
      if (!tile && (ix !== meta.tx || iy !== meta.ty)) {
        tile = this.cropTile32(sheet, meta.tx, meta.ty);
      }
      if (tile) {
        const png = encodeRgbaPng(32, 32, tile);
        if (this.pngCache.size >= 2048) {
          const oldest = this.pngCache.keys().next().value;
          if (oldest !== undefined) this.pngCache.delete(oldest);
        }
        this.pngCache.set(id, png);
        return png;
      }
    }

    return TRANSPARENT_1X1_PNG;
  }
}
