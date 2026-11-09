import { hasPermission } from "../ranks";
import type { RankId } from "../ranks/definitions";
import type { ENetServerPeer } from "../network/enet";
import {
  CHAR_STATE_DOUBLE_JUMP,
  CHAR_STATE_NOCLIP,
  type CharacterStateParams,
  type InventorySlot,
} from "../proton/packet";
import { DEFAULT_SKIN_COLOR } from "../tools/string";
import type { ItemDatabase } from "./items";
import type { WorldInstance } from "./world";

export const STARTER_KIT: Array<[number, number]> = [
  [242, 5],   // World Lock
  [1796, 2],  // Diamond Lock
  [7188, 1],  // Blue Gem Lock
  [634, 1],   //Parasol / Wings fallback if present
  [48, 1],    // Jeans / Shirt
  [98, 1],    // Pickaxe
  [5480, 1],  // Rayman's Fist
  [2, 200],   // Dirt
  [14, 100],  // Cave Background
  [20, 10],   // Sign
];

export const KIT_COOLDOWN_MS = 30 * 60 * 1000;

export const STORE_IDS: number[] = [
  242, 1796, 7188, 202, 204, 206, 98, 5480, 932, 934, 946, 984,
  68, 48, 50, 86, 138, 146, 312, 334, 678, 758, 1460, 1784, 3106,
  2, 4, 10, 12, 14, 16, 20, 34, 102, 182, 566, 720,
];

export const LOCK_CHAIN: number[] = [202, 204, 206, 242, 1796, 7188];

export interface BillboardState {
  itemId: number;
  show: boolean;
  buying: boolean;
  priceWl: number;
  perItem: boolean;
}

export interface PlayerAccount {
  userId: number;
  name: string;
  isGuest: boolean;
  growId: string;
  passwordHash: string;
  deviceKey: string;
  gems: number;
  skinColor: number;
  flag: string;
  moderator: boolean;
  rank?: RankId;
  banned: boolean;
  backpackSize: number;
  inventory: InventorySlot[];
  unavailableInventory?: InventorySlot[];
  recentWorlds: string[];
  billboard: BillboardState;
  lastKitClaim?: number;
  spawnWorld?: string;
  spawnX?: number;
  spawnY?: number;
}

export interface PendingTradeOffer {
  role: "offering" | "awaiting";
  fromNetId: number;
  toNetId: number;
  itemId?: number;
}

export interface PlayerSession {
  peer: ENetServerPeer;
  enteredGame?: boolean;
  chatTimestamps?: number[];
  respawnUntil?: number;
  respawnGeneration?: number;
  account: PlayerAccount;
  netId: number;
  world: WorldInstance | null;
  x: number;
  y: number;
  facingLeft: boolean;
  mstate: number;
  smstate: number;
  cheats: {
    noclip: boolean;
    speed: boolean;
    fly: boolean;
  };
  pendingEditTile: { x: number; y: number } | null;
  pendingTradeOffer: PendingTradeOffer | null;
  lastItemSearchQuery: string;
}

export type TenClothingSlots = [
  number, number, number, number, number,
  number, number, number, number, number
];

export function createStarterInventory(): InventorySlot[] {
  return [
    { itemId: 18, count: 1, equipped: false },
    { itemId: 32, count: 1, equipped: false },
  ];
}

export function normalizeAccount(raw: Partial<PlayerAccount> & { userId: number; name: string }): PlayerAccount {
  const inv: InventorySlot[] = Array.isArray(raw.inventory)
    ? raw.inventory
        .filter((s) => s && typeof s.itemId === "number" && s.count > 0 && s.itemId !== 6)
        .map((s) => ({
          itemId: s.itemId,
          count: Math.min(200, Math.max(1, Math.floor(s.count))),
          equipped: !!s.equipped,
        }))
    : createStarterInventory();

  for (const baseId of [18, 32]) {
    if (!inv.some((s) => s.itemId === baseId)) {
      inv.unshift({ itemId: baseId, count: 1, equipped: false });
    }
  }

  const hasGrowId = typeof raw.growId === "string" && raw.growId.length > 0
    ? true
    : raw.isGuest === false;

  return {
    userId: raw.userId,
    name: raw.name,
    isGuest: !hasGrowId,
    growId: hasGrowId ? (raw.growId || raw.name) : "",
    passwordHash: typeof raw.passwordHash === "string" ? raw.passwordHash : "",
    deviceKey: typeof raw.deviceKey === "string" ? raw.deviceKey : "",
    gems: typeof raw.gems === "number" ? raw.gems : 0,
    skinColor: typeof raw.skinColor === "number" ? raw.skinColor >>> 0 : DEFAULT_SKIN_COLOR,
    flag: typeof raw.flag === "string" && raw.flag.length >= 2 ? raw.flag : "id",
    moderator: false,
    rank: "player",
    banned: !!raw.banned,
    backpackSize: typeof raw.backpackSize === "number" && Number.isSafeInteger(raw.backpackSize) && raw.backpackSize >= 16 ? Math.min(396, raw.backpackSize) : 16,
    inventory: inv,
    // Retain disabled/unknown inventory separately so a save never destroys it.
    unavailableInventory: Array.isArray(raw.unavailableInventory)
      ? raw.unavailableInventory.filter(s => s && Number.isSafeInteger(s.itemId) && s.itemId > 0 && Number.isSafeInteger(s.count) && s.count > 0)
          .map(s => ({ itemId: s.itemId, count: Math.min(200, s.count), equipped: !!s.equipped }))
      : [],
    recentWorlds: Array.isArray(raw.recentWorlds) ? raw.recentWorlds.slice(0, 8) : ["START"],
    billboard: raw.billboard ?? { itemId: 0, show: false, buying: false, priceWl: 1, perItem: true },
    lastKitClaim: raw.lastKitClaim,
    spawnWorld: raw.spawnWorld,
    spawnX: raw.spawnX,
    spawnY: raw.spawnY,
  };
}

/**
 * Verified against ReGrowtopia-1.50.wasm Func #4579 @ 2068..2110 & Gurotopia SetClothing.cpp:
 * All 10 clothing slots (0=Hair, 1=Shirt, 2=Pants, 3=Feet, 4=Face, 5=Hand, 6=Back, 7=Mask, 8=Necklace, 9=Ances).
 */
export function getClothingVector(account: PlayerAccount, itemsDb: ItemDatabase): TenClothingSlots {
  const slots: TenClothingSlots = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const s of account.inventory) {
    if (!s.equipped || s.count <= 0) continue;
    const def = itemsDb.get(s.itemId);
    if (!def || !def.isClothing) continue;
    const cType = def.actionType === 107 ? 9 : def.clothingType;
    if (cType >= 0 && cType <= 9) {
      slots[cType] = s.itemId;
    }
  }
  return slots;
}

export function buildCharacterStateForSession(
  session: PlayerSession,
  itemsDb: ItemDatabase
): CharacterStateParams {
  const clothes = getClothingVector(session.account, itemsDb);
  let stateFlags = 0;
  let punchEffect = 0;
  let punchRangeTiles = 2;
  let buildRangeTiles = 2;
  let moveSpeed = 250.0;
  let gravity = 1000.0;

  // Back slot (6): wings / jetpack / cape grant double jump; parasol slows fall
  const backId = clothes[6];
  if (backId > 0) {
    const backDef = itemsDb.get(backId);
    const nm = (backDef?.name || "").toLowerCase();
    if (nm.includes("parasol") || nm.includes("umbrella")) {
      gravity = 320.0;
    } else {
      stateFlags |= CHAR_STATE_DOUBLE_JUMP;
    }
  }

  // Feet slot (3): speedy / air robins / skates boost speed
  const feetId = clothes[3];
  if (feetId > 0) {
    const feetDef = itemsDb.get(feetId);
    const nm = (feetDef?.name || "").toLowerCase();
    if (nm.includes("air") || nm.includes("skate") || nm.includes("speed") || nm.includes("sneaker")) {
      moveSpeed = 310.0;
    }
  }

  // Hand slot (5): Rayman's Fist (#5480), Pickaxe (#98), Swords, Flame items
  const handId = clothes[5];
  if (handId === 5480) {
    punchEffect = 4; // Rayman beam punch
  } else if (handId === 98) {
    punchRangeTiles = 3;
  } else if (handId > 0) {
    const handDef = itemsDb.get(handId);
    const nm = (handDef?.name || "").toLowerCase();
    if (nm.includes("flame") || nm.includes("fire")) punchEffect = 1;
    else if (nm.includes("zeus") || nm.includes("lightning")) punchEffect = 13;
  }

  if (session.cheats.noclip) {
    stateFlags |= CHAR_STATE_NOCLIP;
  }
  if (session.cheats.speed) {
    moveSpeed = 400.0;
  }
  if (session.cheats.fly) {
    stateFlags |= CHAR_STATE_DOUBLE_JUMP;
    gravity = 300.0;
  }

  if (hasPermission(session.account, "moderate")) {
    buildRangeTiles = Math.max(buildRangeTiles, 4);
  }

  return {
    netId: session.netId,
    punchEffect,
    buildRangeTiles,
    punchRangeTiles,
    stateFlags,
    moveSpeed,
    gravity,
  };
}
