import fs from "node:fs";
import path from "node:path";
import { ORIGINAL_ITEMS_BASE64 } from "./original-item-data";
import { ORIGINAL_ITEM_REFERENCE } from "./original-item-reference";

export interface ItemDef {
  id: number;
  flags: number;
  actionType: number;
  material: number;
  name: string;
  texture: string;
  collisionType: number;
  breakHits: number;
  dropChance: number;
  clothingType: number;
  rarity: number;
  maxAmount: number;
  seedColor: number;
  ing1: number;
  ing2: number;
  growTime: number;
  isRayman: number;
  extraOptions: string;
  punchOptions: string;
  isSeed: boolean;
  isBackground: boolean;
  isClothing: boolean;
  isLock: boolean;
  isDoor: boolean;
  isSign: boolean;
  isWeather: boolean;
  isHazard: boolean;
  isBouncy: boolean;
  isCheckpoint: boolean;
  isPlatform: boolean;
  isBedrock: boolean;
}

export function protonHash(buf: Buffer): number {
  let acc = 0x55555555 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    acc = (((acc >>> 27) + ((acc << 5) >>> 0) + buf[i]) >>> 0);
  }
  return acc >>> 0;
}

const SECRET_KEY = "PBG892FXX982ABC*";

// Exact Growtopia client weather IDs corresponding to Weather Machine items (matches GTPS3 World.h + WASM #960)
export const WEATHER_BY_ITEM_ID: Record<number, number> = {
  932: 4,     // Weather Machine - Sunny
  934: 2,     // Weather Machine - Night
  946: 3,     // Weather Machine - Arid
  984: 5,     // Weather Machine - Rainy City
  1210: 8,    // Weather Machine - Spooky
  1490: 10,   // Weather Machine - Nothingness
  1364: 11,   // Weather Machine - Snowy
  1750: 15,   // Weather Machine - Warp Speed
  2046: 17,   // Weather Machine - Comet
  2284: 18,   // Weather Machine - Party
  2744: 19,   // Weather Machine - Pineapples
  3252: 20,   // Weather Machine - Snowy Night
  3446: 21,   // Weather Machine - Spring
  3534: 22,   // Weather Machine - Howling Sky
  3694: 28,   // Weather Machine - Heatwave
  3832: 29,   // Weather Machine - Stuff
  4242: 30,   // Weather Machine - Pagoda
  4486: 31,   // Weather Machine - Apocalypse
  4776: 32,   // Weather Machine - Jungle
  4892: 33,   // Weather Machine - Balloon Warz
  5000: 34,   // Weather Machine - Background
  5112: 35,   // Weather Machine - Autumn
  5654: 36,   // Weather Machine - Valentine's
  5716: 37,   // Weather Machine - St. Paddy's Day
  5958: 38,   // Epoch Machine
  6854: 42,   // Weather Machine - Digital Rain
  7644: 44,   // Weather Machine - Frozen Cliffs
  8896: 47,   // Weather Machine - Meteor Shower
  8836: 48,   // Weather Machine - Stargazing
  10058: 41,  // Infinity Weather Machine
  10286: 51,  // Weather Machine - Celebrity Hills
  11880: 59,  // Weather Machine - Plaza
  12054: 60,  // Weather Machine - Nebula
  12056: 61,  // Weather Machine - Protostar Landing
  12408: 64,  // Weather Machine - Dark Mountains
  12844: 65,  // Weather Machine - Mt. Growmore
  13004: 66,  // Weather Machine - Crack in Reality
  13070: 68,  // Weather Machine - Nian's Mountains
};

export class ItemDatabase {
  public readonly version: number;
  public readonly rawItemsDat: Buffer;
  public readonly items: Map<number, ItemDef> = new Map();
  public readonly nameIndex: Map<string, ItemDef> = new Map();
  public readonly spliceIndex: Map<string, number> = new Map();
  public readonly itemsDatHash: number;
  public readonly playerTributeHash: number;

  constructor(itemsDatBuf: Buffer = Buffer.from(ORIGINAL_ITEMS_BASE64, "base64"), playerTributeBuf?: Buffer) {
    this.rawItemsDat = itemsDatBuf;
    this.itemsDatHash = protonHash(itemsDatBuf);
    this.playerTributeHash = playerTributeBuf ? protonHash(playerTributeBuf) : 3366554574;
    this.version = itemsDatBuf.readUInt16LE(0);
    const count = itemsDatBuf.readUInt32LE(2);
    let pos = 6;
    const reference = new Map(ORIGINAL_ITEM_REFERENCE.map(row => [row[0], row]));
    const recordChunks: Buffer[] = [itemsDatBuf.subarray(0, 6)];
    let emptyRecord: Buffer | undefined;

    const readStr = (): string => {
      const len = itemsDatBuf.readUInt16LE(pos);
      pos += 2;
      const s = itemsDatBuf.toString("latin1", pos, pos + len);
      pos += len;
      return s;
    };

    for (let idx = 0; idx < count; idx++) {
      const recordStart = pos;
      const id = itemsDatBuf.readUInt32LE(pos);
      const flags = itemsDatBuf.readUInt16LE(pos + 4);
      const actionType = itemsDatBuf[pos + 6];
      const material = itemsDatBuf[pos + 7];
      pos += 8;

      const nameLen = itemsDatBuf.readUInt16LE(pos);
      pos += 2;
      const nameChars = Buffer.allocUnsafe(nameLen);
      for (let i = 0; i < nameLen; i++) {
        nameChars[i] = itemsDatBuf[pos + i] ^ SECRET_KEY.charCodeAt((i + id) % 16);
      }
      pos += nameLen;
      const name = nameChars.toString("utf8");

      const texture = readStr();
      const collisionType = itemsDatBuf[pos + 13];
      const breakHitsRaw = itemsDatBuf[pos + 14];
      const dropChance = itemsDatBuf.readUInt32LE(pos + 15);
      const clothingType = itemsDatBuf[pos + 19];
      const rarity = itemsDatBuf.readUInt16LE(pos + 20);
      const maxAmount = itemsDatBuf[pos + 22] || 200;
      pos += 23;

      readStr(); // extraFile
      pos += 8;  // extraFileHash(4) + audioVolume(4)
      readStr(); // petName
      readStr(); // petPrefix
      readStr(); // petSuffix
      readStr(); // petAbility

      const seedColor = itemsDatBuf.readUInt32LE(pos + 4);
      const ing1 = itemsDatBuf.readUInt16LE(pos + 12);
      const ing2 = itemsDatBuf.readUInt16LE(pos + 14);
      const growTime = itemsDatBuf.readUInt32LE(pos + 16);
      const isRayman = itemsDatBuf.readUInt16LE(pos + 22);
      pos += 24;

      const extraOptions = readStr();
      readStr(); // texture2
      readStr(); // extraOptions2
      pos += 80;

      let punchOptions = "";
      if (this.version >= 11) punchOptions = readStr();
      if (this.version >= 12) pos += 13;
      if (this.version >= 13) pos += 4;
      if (this.version >= 14) pos += 4;
      if (this.version >= 15) {
        pos += 25;
        readStr();
      }
      if (this.version >= 16) readStr();
      if (this.version >= 17) pos += 4;
      if (this.version >= 18) pos += 4;

      const isSeed = ((id % 2 === 1) && actionType === 19) || name.endsWith(" Seed");
      const isBackground = actionType === 18 || actionType === 22 || actionType === 28;
      const isClothing = actionType === 20 || actionType === 107;
      const isLock =
        actionType === 3 ||
        id === 202 ||
        id === 204 ||
        id === 206 ||
        id === 242 ||
        id === 1796 ||
        id === 5260 ||
        id === 7188 ||
        id === 11550;
      const isDoor = actionType === 2 || actionType === 13 || actionType === 26;
      const isSign = actionType === 10;
      const isWeather =
        actionType === 41 ||
        actionType === 81 ||
        actionType === 89 ||
        actionType === 134 ||
        WEATHER_BY_ITEM_ID[id] !== undefined ||
        name.startsWith("Weather Machine");
      const isHazard = actionType === 6 || actionType === 16 || actionType === 25 || actionType === 136;
      const isBouncy = actionType === 7 || actionType === 24 || actionType === 108;
      const isCheckpoint = actionType === 27;
      const isPlatform = actionType === 14 || collisionType === 2;
      const isBedrock = id === 8 || id === 6 || ((flags & 0x0400) !== 0 && id !== 12258);

      const def: ItemDef = {
        id,
        flags,
        actionType,
        material,
        name,
        texture,
        collisionType,
        breakHits: Math.max(1, Math.round(breakHitsRaw / 6)),
        dropChance,
        clothingType: actionType === 107 ? 9 : clothingType,
        rarity,
        maxAmount,
        seedColor,
        ing1,
        ing2,
        growTime: growTime || 30,
        isRayman,
        extraOptions,
        punchOptions,
        isSeed,
        isBackground,
        isClothing,
        isLock,
        isDoor,
        isSign,
        isWeather,
        isHazard,
        isBouncy,
        isCheckpoint,
        isPlatform,
        isBedrock,
      };
      const row = reference.get(id);
      const allowed = !!row && row[1] === name && row[2] === texture && row[3] === actionType && row[4] === def.clothingType;
      const record = itemsDatBuf.subarray(recordStart, pos);
      if (id === 0) {
        if (!allowed) throw new Error("Item 0 does not match the original reference");
        emptyRecord = Buffer.from(record);
      }
      if (!allowed) {
        if (!emptyRecord) throw new Error("Missing empty item template");
        const oldNameLen = emptyRecord.readUInt16LE(8);
        const label = Buffer.from("Unavailable Item");
        for (let n = 0; n < label.length; n++) label[n] ^= SECRET_KEY.charCodeAt((n + id) % 16);
        const prefix = Buffer.from(emptyRecord.subarray(0, 10));
        prefix.writeUInt32LE(id, 0); prefix.writeUInt16LE(label.length, 8);
        recordChunks.push(Buffer.concat([prefix, label, emptyRecord.subarray(10 + oldNameLen)]));
        continue; // Not searchable, grantable, purchasable, equipable or placeable.
      }
      recordChunks.push(record);
      this.items.set(id, def);
      if (name && !name.startsWith("null_")) {
        this.nameIndex.set(name.toLowerCase(), def);
      }
      if (ing1 > 0 && ing2 > 0) {
        const a = Math.min(ing1, ing2);
        const b = Math.max(ing1, ing2);
        this.spliceIndex.set(`${a}:${b}`, isSeed ? id : id + 1);
      }
    }

    if (pos !== itemsDatBuf.length) throw new Error("Unexpected items.dat trailing data");
    this.rawItemsDat = itemsDatBuf;
    this.itemsDatHash = protonHash(itemsDatBuf);

    // Populate canonical Growtopia seed splicing recipes resolved by exact item name
    // (items.dat v18 zeroes client-side ing1/ing2 to prevent recipe scraping).
    const resolveSeedId = (itemOrSeedName: string): number | null => {
      const lower = itemOrSeedName.toLowerCase();
      const direct = this.nameIndex.get(lower);
      if (direct) {
        if (direct.isSeed) return direct.id;
        const pairedSeed = this.items.get(direct.id + 1);
        if (pairedSeed && pairedSeed.isSeed) return pairedSeed.id;
      }
      const asSeed = this.nameIndex.get(`${lower} seed`);
      if (asSeed && asSeed.isSeed) return asSeed.id;
      return null;
    };

    const canonicalSplicesByName: Array<[string, string, string]> = [
      // Tier 1: Core starter combinations (Dirt, Rock, Lava, Cave Background)
      ["Dirt", "Rock", "Grass"],
      ["Dirt", "Lava", "Wood Block"],
      ["Dirt", "Cave Background", "Door"],
      ["Rock", "Cave Background", "Sign"],
      ["Rock", "Lava", "Glass Pane"],
      ["Lava", "Cave Background", "Torch"],

      // Tier 2: Early building, flora & backgrounds
      ["Dirt", "Grass", "Daisy"],
      ["Dirt", "Door", "Pointy Sign"],
      ["Dirt", "Sign", "Crappy Sign"],
      ["Rock", "Grass", "Bricks"],
      ["Rock", "Sign", "Danger Sign"],
      ["Cave Background", "Grass", "Mushroom"],
      ["Lava", "Grass", "Rose"],
      ["Lava", "Door", "Dungeon Door"],
      ["Grass", "Wood Block", "Wooden Background"],
      ["Wood Block", "Wooden Background", "Wooden Platform"],
      ["Wood Block", "Glass Pane", "Window"],
      ["Rock", "Glass Pane", "Sand"],
      ["Rock", "Wood Block", "Stone Wall"],
      ["Rock", "Cave Background", "Sign"],
      ["Cave Background", "Rock", "Sign"],

      // Tier 3: Architecture, furniture, nature & color primaries
      ["Rock", "Bricks", "Rock Background"],
      ["Bricks", "Wooden Background", "Brick Background"],
      ["Bricks", "Lava", "Evil Bricks"],
      ["Bricks", "Grass", "Red Bricks"],
      ["Door", "Window", "House Entrance"],
      ["Wood Block", "Window", "Wooden Window"],
      ["Dungeon Door", "Bricks", "Portcullis"],
      ["Glass Pane", "Glass Pane", "Glass Block"],
      ["Glass Pane", "Lava", "Amber Glass"],
      ["Daisy", "Rose", "Poppy"],
      ["Grass", "Rose", "Bush"],
      ["Bush", "Rose", "Blueberry"],
      ["Daisy", "Blueberry", "Apple"],
      ["Sand", "Grass", "Cactus"],
      ["Sand", "Rock", "Sandstone"],
      ["Dirt", "Sand", "Mud Glob"],
      ["Wood Block", "Sign", "Wooden Table"],
      ["Wooden Table", "Wood Block", "Wooden Chair"],
      ["Wood Block", "Daisy", "Picket Fence"],
      ["Wood Block", "Bricks", "Barrel"],
      ["Wood Block", "Door", "Super Crate Box"],
      ["Wooden Platform", "Wooden Background", "Ladder"],
      ["Bricks", "Torch", "Fireplace"],
      ["Window", "Torch", "Table Lamp"],
      ["Table Lamp", "Glass Block", "Chandelier"],
      ["Rock", "Mushroom", "Death Spikes"],
      ["Rock", "Dungeon Door", "Iron Bars"],
      ["Dungeon Door", "Iron Bars", "Jail Door"],

      // Color Blocks (official Growtopia pigment tree)
      ["Rock", "Daisy", "White Block"],
      ["Cave Background", "Stone Wall", "Black Block"],
      ["White Block", "Black Block", "Grey Block"],
      ["Rock", "Rose", "Red Block"],
      ["Dirt", "Daisy", "Yellow Block"],
      ["Rock", "Blueberry", "Blue Block"],
      ["Red Block", "Yellow Block", "Orange Block"],
      ["Yellow Block", "Blue Block", "Green Block"],
      ["Red Block", "Blue Block", "Purple Block"],
      ["Green Block", "Glass Pane", "Aqua Block"],
      ["Dirt", "Black Block", "Brown Block"],

      // Wallpapers, luxury blocks & gadgets
      ["Daisy", "Wooden Background", "Flowery Wallpaper"],
      ["White Block", "Red Block", "Polka Dot Block"],
      ["Yellow Block", "Blue Block", "Stripey Wallpaper"],
      ["Black Block", "White Block", "Checker Wallpaper"],
      ["Yellow Block", "Glass Block", "Golden Block"],
      ["Stone Wall", "Lava", "Steel Block"],
      ["Purple Block", "Orange Block", "Rainbow Block"],
      ["White Block", "Aqua Block", "Ice"],
      ["White Block", "Glass Pane", "Clouds"],
      ["Clouds", "Rock", "Cloudstone Block"],
      ["Sandstone", "Rock", "Granite Block"],
      ["Granite Block", "White Block", "Marble Block"],
      ["Toilet", "Water", "Bathtub"],
      ["Rock Background", "Glass Pane", "Toilet"],
      ["Wooden Chair", "Daisy", "Bed"],
      ["Wooden Table", "Window", "Dresser"],
      ["Wooden Background", "Wooden Chair", "Bookcase"],
      ["Lava", "Note Block", "Music Box"],
      ["Wood Block", "Torch", "Sheet Music: Blank"],
      ["Sheet Music: Blank", "Wood Block", "Note Block"],
      ["Golden Block", "Glass Block", "Disco Ball"],
      ["Cactus", "Death Spikes", "Venus Guytrap"],
      ["Steel Block", "Poppy", "Pinball Bumper"],
      ["Pinball Bumper", "Wooden Platform", "Pinball Sproinger"],

      // Classic Growtopia spliceable clothes
      ["Cave Background", "Glass Pane", "Shades"],
      ["Grass", "Daisy", "Green Shirt"],
      ["Black Block", "White Block", "Tuxedo"],
      ["Dirt", "Rock Background", "Brown Shoes"],
      ["Brown Shoes", "Rock", "Boots"],
      ["Blueberry", "Green Shirt", "Jeans"],
      ["Black Block", "Shades", "Top Hat"],
      ["Rose", "Bush", "Red Hair"],
      ["Dirt", "Bush", "Brown Hair"],
      ["Wood Block", "Steel Block", "Pickaxe"],
      ["Steel Block", "Sign", "Sword"],
    ];

    for (const [nameA, nameB, resultName] of canonicalSplicesByName) {
      const s1 = resolveSeedId(nameA);
      const s2 = resolveSeedId(nameB);
      const outSeed = resolveSeedId(resultName);
      if (s1 !== null && s2 !== null && outSeed !== null) {
        const a = Math.min(s1, s2);
        const b = Math.max(s1, s2);
        const key = `${a}:${b}`;
        if (!this.spliceIndex.has(key)) {
          this.spliceIndex.set(key, outSeed);
        }
      }
    }
  }

  private static resolveVfsSlices(rootDir: string): {
    upstreamDataUrl: string;
    items_dat: { start: number; end: number };
    player_tribute_dat: { start: number; end: number };
  } {
    const upstreamDataUrl =
      process.env.UPSTREAM_DATA_URL ||
      "https://play.creativeps.eu/creativegrowtopia_web/ReGrowtopia-1.50.data";
    const infoPath = path.join(rootDir, "server", "data_info.json");
    const fallback = fs.existsSync(infoPath)
      ? JSON.parse(fs.readFileSync(infoPath, "utf8"))
      : {
          items_dat: { start: 65361766, end: 70093966 },
          player_tribute_dat: { start: 70093966, end: 70097286 },
        };

    const jsPath = path.join(rootDir, "public", "ReGrowtopia-1.50.js");
    if (fs.existsSync(jsPath)) {
      const jsText = fs.readFileSync(jsPath, "utf8");
      const matchSlice = (vfsName: string) => {
        const re = new RegExp(
          `filename:\\s*"${vfsName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}",\\s*start:\\s*(\\d+),\\s*end:\\s*(\\d+)`
        );
        const m = jsText.match(re);
        return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
      };
      const itemsSlice = matchSlice("/cache/items.dat");
      const tributeSlice = matchSlice("/cache/player_tribute.dat");
      if (itemsSlice && tributeSlice) {
        return {
          upstreamDataUrl,
          items_dat: itemsSlice,
          player_tribute_dat: tributeSlice,
        };
      }
    }

    return {
      upstreamDataUrl,
      items_dat: fallback.items_dat,
      player_tribute_dat: fallback.player_tribute_dat || { start: 70093966, end: 70097286 },
    };
  }

  private static async fetchRangeSlice(
    url: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    const expectedLen = end - start;
    const resp = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end - 1}`,
      },
    });
    if (resp.status !== 206 && resp.status !== 200) {
      throw new Error(`HTTP ${resp.status} fetching Range ${start}-${end - 1} from ${url}`);
    }
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    if (resp.status === 200 && buf.length >= end) {
      return buf.subarray(start, end);
    }
    if (buf.length !== expectedLen) {
      throw new Error(`Range slice size mismatch: got ${buf.length}, expected ${expectedLen}`);
    }
    return buf;
  }

  public static async loadFromUpstreamOrCache(rootDir: string): Promise<ItemDatabase> {
    // Never use the CreativePS item database as authoritative item definitions.
    return new ItemDatabase(Buffer.from(ORIGINAL_ITEMS_BASE64, "base64"));
  }

  public get(id: number): ItemDef | undefined {
    return this.items.get(id);
  }

  public findSpliceSeed(seedA: number, seedB: number): number | null {
    const a = Math.min(seedA, seedB);
    const b = Math.max(seedA, seedB);
    return this.spliceIndex.get(`${a}:${b}`) ?? null;
  }

  public getWeatherIdForBlock(itemId: number): number {
    if (WEATHER_BY_ITEM_ID[itemId] !== undefined) {
      return WEATHER_BY_ITEM_ID[itemId];
    }
    const def = this.items.get(itemId);
    if (!def) return 0;
    const nm = def.name.toLowerCase();
    if (nm.includes("night") && nm.includes("snow")) return 20;
    if (nm.includes("night")) return 2;
    if (nm.includes("arid") || nm.includes("desert")) return 3;
    if (nm.includes("rain")) return 5;
    if (nm.includes("spooky") || nm.includes("halloween")) return 8;
    if (nm.includes("nothing") || nm.includes("void")) return 10;
    if (nm.includes("snow") || nm.includes("winter")) return 11;
    if (nm.includes("warp") || nm.includes("space")) return 15;
    if (nm.includes("comet") || nm.includes("meteor")) return 17;
    if (nm.includes("party")) return 18;
    if (nm.includes("pineapple")) return 19;
    if (nm.includes("spring") || nm.includes("blossom")) return 21;
    if (nm.includes("stuff")) return 29;
    if (nm.includes("infinity")) return 41;
    return 4;
  }

  public search(query: string, limit = 30, excludeSeeds = false): ItemDef[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: ItemDef[] = [];
    const exact = this.nameIndex.get(q);
    if (exact && !exact.name.startsWith("null_") && !exact.name.includes("REVOKED") && (!excludeSeeds || !exact.isSeed)) {
      results.push(exact);
    }
    if (/^\d+$/.test(q)) {
      const byId = this.items.get(Number(q));
      if (byId && !results.includes(byId) && !byId.name.startsWith("null_")) {
        results.push(byId);
      }
    }
    for (const item of this.items.values()) {
      if (results.length >= limit) break;
      if (results.includes(item)) continue;
      if (!item.name || item.name.startsWith("null_") || item.name.includes("REVOKED")) continue;
      if (excludeSeeds && item.isSeed) continue;
      const cleanName = item.name.replace(/`.|``/g, "").toLowerCase();
      if (cleanName.includes(q)) {
        results.push(item);
      }
    }
    return results;
  }
}

export const ITEM_FLAG_MULTI_FACING = 0x0001;
export const ITEM_FLAG_WRENCHABLE   = 0x0002;
export const ITEM_FLAG_PERMANENT    = 0x0004;
export const ITEM_FLAG_DROPLESS     = 0x0008;
export const ITEM_FLAG_NO_SEED      = 0x0010;
export const ITEM_FLAG_NO_SELF      = 0x0020;
export const ITEM_FLAG_NO_SHADOW    = 0x0040;
export const ITEM_FLAG_WORLD_LOCK   = 0x0080;
export const ITEM_FLAG_BETA         = 0x0100;
export const ITEM_FLAG_AUTO_PICKUP  = 0x0200;
export const ITEM_FLAG_MOD          = 0x0400;
export const ITEM_FLAG_RANDOM_GROW  = 0x0800;
export const ITEM_FLAG_PUBLIC       = 0x1000;
export const ITEM_FLAG_FOREGROUND   = 0x2000;
export const ITEM_FLAG_HOLIDAY      = 0x4000;
export const ITEM_FLAG_UNTRADABLE   = 0x8000;

export function isUntradeable(def?: ItemDef): boolean {
  if (!def) return false;
  return (
    def.id === 18 || // Fist
    def.id === 32 || // Wrench
    def.id === 1424 || // World Key / Phone Booth
    def.id === 5816 || // Growpass
    def.id === 6336 ||
    def.id === 8430 ||
    def.id === 11550 || // Blood Dragon Lock
    (def.flags & ITEM_FLAG_UNTRADABLE) !== 0
  );
}

export function isUndestroyable(def?: ItemDef): boolean {
  if (!def) return false;
  return (
    def.id === 18 || // Fist
    def.id === 32 || // Wrench
    def.id === 6336 ||
    (def.flags & ITEM_FLAG_PERMANENT) !== 0 ||
    (def.flags & ITEM_FLAG_UNTRADABLE) !== 0
  );
}
