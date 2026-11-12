import { GTPS3_PUNCH_EFFECTS } from '../playmods/gtps3-punch.generated';
import { equippedAbilities, hasRaymanFist } from '../playmods/equipment';
import { normalizeMods, activeMods, type TimedMod } from "../playmods/model";
import { isSuperSupporter } from "../progression/service";
import { normalizeProgression, type Progression } from "../progression/model";
import { staffInteractionReach } from "../ranks/interaction";
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
  progression?: Progression;
  playmods?: TimedMod[];
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
  friendIds?: number[];
  lastDailyReward?: number;
  personalNote?: string;
  homeWorld?: string;
  lastKitClaim?: number;
  spawnWorld?: string;
  spawnX?: number;
  spawnY?: number;
  hairColor?: number;
  eyeColor?: number;
  pupilColor?: number;
  lastDailyQuestDay?: number;
  nickname?: string;
  backpackLevel?: number;
  storedItems?: Array<{ itemId: number; count: number }>;
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
  lastInfectPunchAt?: number;
  hp?: number;
  lastHazardHitAt?: number;
  lastHazardRegenAt?: number;
  respawnUntil?: number;
  respawnGeneration?: number;
  pullGeneration?: number;
  pullUntil?: number;
  pullImmuneUntil?: number;
  lastFindItemIds?: number[];
  findSelectedItemIds?: number[];
  account: PlayerAccount;
  netId: number;
  world: WorldInstance | null;
  x: number;
  y: number;
  facingLeft: boolean;
  mstate: number;
  smstate: number;
  iconState?: number;
  brb?: boolean;
  radio?: boolean;
  lastMsg?: string;
  lastMsgWorld?: string;
  lastIconStatePacket?: Buffer;
  cheats: {
    noclip: boolean;
    speed: boolean;
    fly: boolean;
  };
  pendingEditTile: { x: number; y: number } | null;
  pendingTradeOffer: PendingTradeOffer | null;
  lastItemSearchQuery: string;
  fishing?: { baitId: number; tx: number; ty: number; startedAt: number; biteAt: number } | null;
  lastGeigerPingAt?: number;
  magplantRemote?: { x: number; y: number; itemId: number } | null;
  lastLockeItem?: number;
  lastWrenchX?: number;
  lastWrenchY?: number;
  lastWrenchB?: number;
  lastChoosenItem?: number;
  lastChoosenNr?: number;
  invis?: boolean;
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
    progression: normalizeProgression(raw.progression),
    playmods: normalizeMods(raw.playmods),
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
    friendIds: Array.isArray(raw.friendIds) ? [...new Set(raw.friendIds.filter(id => Number.isSafeInteger(id) && id > 0 && id !== raw.userId))].slice(0,200) : [],
    personalNote: typeof raw.personalNote==='string' ? raw.personalNote.replace(/[|\r\n\0]/g,' ').slice(0,128) : '',
    billboard: raw.billboard ?? { itemId: 0, show: false, buying: false, priceWl: 1, perItem: true },
    lastKitClaim: raw.lastKitClaim,
    lastDailyReward: typeof raw.lastDailyReward === "number" ? raw.lastDailyReward : undefined,
    lastDailyQuestDay: typeof raw.lastDailyQuestDay === "number" ? raw.lastDailyQuestDay : undefined,
    hairColor: typeof raw.hairColor === "number" ? raw.hairColor >>> 0 : undefined,
    eyeColor: typeof raw.eyeColor === "number" ? raw.eyeColor >>> 0 : undefined,
    pupilColor: typeof raw.pupilColor === "number" ? raw.pupilColor >>> 0 : undefined,
    spawnWorld: raw.spawnWorld,
    spawnX: raw.spawnX,
    spawnY: raw.spawnY,
    nickname: typeof raw.nickname === "string" ? raw.nickname.replace(/[|\r\n\0]/g, "").slice(0, 24) : undefined,
    backpackLevel: typeof raw.backpackLevel === "number" && raw.backpackLevel >= 1 ? Math.min(20, raw.backpackLevel) : 1,
    storedItems: Array.isArray(raw.storedItems)
      ? raw.storedItems.filter((s) => s && Number.isSafeInteger(s.itemId) && s.itemId > 0 && Number.isSafeInteger(s.count) && s.count > 0)
      : [],
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
    const c = session.cheats;
    let stateFlags = isSuperSupporter(session.account) && !session.account.progression?.hideStatus ? 1 << 24 : 0;
    let moveSpeed = 250.0;
    let gravity = 1000.0;
    let buildRangeTiles = 2;
    let punchRangeTiles = 2;
    let punchEffect = 0;

    const abilities = equippedAbilities(session.account);
    if (abilities.doubleJump.length) stateFlags |= CHAR_STATE_DOUBLE_JUMP;
    // GTPS3 World.h form_state(): Mark of Growganoth uses state bit 4.
    // No-Face is the face-slot item that hides eyes/mouth; verify client visual.
    if (session.account.inventory.some(v=>v.itemId===3774 && v.equipped && v.count>0)) stateFlags |= 1<<4;
    if (abilities.speedy.length) moveSpeed = 310.0;
    if (abilities.highJump.length) gravity = 700.0;
    // Ordinary punch range stacks up to two extra tiles. Ring of Range has
    // a separate owner-world rule and is deliberately absent from the table.
    const ringOfRange = session.account.inventory.some(i=>i.equipped && i.count>0 && i.itemId===11094);
    const ringBonus = ringOfRange ? (session.world?.ownerUserId === session.account.userId ? 3 : 1) : 0;
    const rangeCap = ringBonus === 3 ? 3 : 2;
    buildRangeTiles += Math.min(rangeCap, abilities.buildRange.length + ringBonus);
    punchRangeTiles += Math.min(rangeCap, abilities.punchRange.length + ringBonus);
    if (hasRaymanFist(session.account)) {
      punchRangeTiles = Math.max(punchRangeTiles, 10);
      // Punch animation is selected separately by the GTPS3 slot priority below.
    }
    // GTPS3 World.h update_clothes slot precedence: hand, neck, back, face,
    // mask, hair, feet, shirt, pants, ances. Numeric type values are items.dat.
    for (const clothingType of [5, 8, 6, 4, 7, 0, 3, 1, 2, 9]) {
      const slot = session.account.inventory.find(v => {
        if (!v.equipped || v.count <= 0) return false;
        const item = itemsDb.get(v.itemId);
        return !!item?.isClothing && (item.actionType === 107 ? 9 : item.clothingType) === clothingType && !!GTPS3_PUNCH_EFFECTS[v.itemId];
      });
      if (slot) { punchEffect = GTPS3_PUNCH_EFFECTS[slot.itemId]; break; }
    }

    for (const mod of activeMods(session.account)) {
      stateFlags |= mod.flags;
      if (mod.gravity!==undefined) gravity = mod.gravity;
      if (mod.speed!==undefined) moveSpeed = mod.speed;
    }
    // GTPS3 World.h update_clothes: Infected movement speed & Floating! (-30 gravity).
    if (activeMods(session.account).some(m=>m.id==='gtps3-infected')) moveSpeed=(moveSpeed===420||moveSpeed===310||moveSpeed===325)?190:150;
    if (activeMods(session.account).some((m) => m.group === "floating")) {
      gravity = -30.0;
    }

    const xeno = session.world?.xenonite?.enabled ? session.world.xenonite : undefined;
    if (xeno) {
      if (xeno.doubleJump === 1) stateFlags |= CHAR_STATE_DOUBLE_JUMP;
      else if (xeno.doubleJump === 2) stateFlags &= ~CHAR_STATE_DOUBLE_JUMP;
      if (xeno.highJump === 1) gravity = Math.min(gravity, 700.0);
      else if (xeno.highJump === 2) gravity = Math.max(gravity, 1000.0);
      if (xeno.speedy === 1) moveSpeed = Math.max(moveSpeed, 310.0);
      else if (xeno.speedy === 2) moveSpeed = 250.0;
      if (xeno.longBuild === 1) buildRangeTiles = Math.max(buildRangeTiles, 4);
      else if (xeno.longBuild === 2) buildRangeTiles = 2;
      if (xeno.longPunch === 1) punchRangeTiles = Math.max(punchRangeTiles, 4);
      else if (xeno.longPunch === 2) punchRangeTiles = 2;
    }

    if (c.noclip) stateFlags |= 1 << 0;
    if (c.speed) moveSpeed = 420.0;
    if (c.fly) {
      stateFlags |= 1 << 1;
      moveSpeed = 350.0;
      gravity = 600.0;
    }

    const staffReach = staffInteractionReach(session.account);
    if (staffReach !== null) {
      buildRangeTiles = staffReach;
      punchRangeTiles = staffReach;
    }


  return {
    netId: session.netId,
    punchEffect,
    buildRangeTiles,
    punchRangeTiles,
    stateFlags,
    moveSpeed,
    gravity,
    // Native Func #4565 reads the lens/pupil colour from the tank body at +12
    // and eye lenses at +8; hair/eye-drop live at +44/+48. Omitting pupilColor
    // previously sent 0 at +12, so the client could never tint contact lenses.
    pupilColor: session.account.pupilColor ?? 0,
    hairColor: session.account.hairColor ?? 0xFFFFFFFF,
    eyeDrop: session.account.eyeColor ?? 0xFFFFFFFF,
    eyeLenses: session.account.pupilColor ?? 0,
  };
}
