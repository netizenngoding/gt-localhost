import type { ItemDatabase } from "./items";

/** Portrait, Posh Portrait, and Villain Portrait blocks share one extra layout. */
export const PORTRAIT_IDS = new Set([3818, 11196, 15950]);

// items.dat clothingType values (verified against data/cache/items.dat v18):
// 0 = Hat, 7 = Hair. Hair Dye only ever tints the Hair slot.
export const CLOTHING_SLOT_HAT = 0;
export const CLOTHING_SLOT_HAIR = 7;

/**
 * Wire order of the portrait extra (see proton/packet.ts `kind === "portrait"`):
 * expression, hairColor, skinColor, face, c_head, c_hair.
 * `mask` serializes into c_head (headwear, never tinted) and `hair` into
 * c_hair (tinted with hairColor), so the field names are kept for compatibility
 * with worlds.json but their meaning is fixed here.
 */
export interface PortraitExtraSlots {
  hair: number;
  mask: number;
}

export function clothingSlotOf(itemsDb: ItemDatabase, itemId: number): number {
  if (!itemId) return -1;
  const def = itemsDb.get(itemId);
  if (!def || !def.isClothing) return -1;
  return def.actionType === 107 ? 9 : def.clothingType;
}

export function isHairSlotItem(itemsDb: ItemDatabase, itemId: number): boolean {
  return clothingSlotOf(itemsDb, itemId) === CLOTHING_SLOT_HAIR;
}

/**
 * Older builds painted the hat slot (0) into the tinted c_hair field and the
 * hair slot (7) into the untinted c_head field, so hats inherited the account's
 * Hair Dye in already-painted portraits. Move every item back to the field its
 * clothing slot belongs to. Returns true when the extra was rewritten.
 */
export function normalizePortraitSlots(itemsDb: ItemDatabase, extra: PortraitExtraSlots): boolean {
  const headIsHair = isHairSlotItem(itemsDb, extra.mask);
  const hairIsHair = isHairSlotItem(itemsDb, extra.hair);
  if (headIsHair && !hairIsHair) {
    const hat = extra.hair;
    extra.hair = extra.mask;
    extra.mask = hat;
    return true;
  }
  // Hat-only portrait: headwear was parked in the tinted field with c_head empty.
  if (!hairIsHair && extra.hair !== 0 && extra.mask === 0) {
    extra.mask = extra.hair;
    extra.hair = 0;
    return true;
  }
  return false;
}
