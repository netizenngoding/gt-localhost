import type { PlayerAccount } from '../database/peer';
import { activeMods } from './model';
import { PUNCH_DAMAGE_IDS, PUNCH_RANGE_IDS, BUILD_RANGE_IDS, DOUBLE_JUMP_IDS, SPEEDY_IDS, HIGH_JUMP_IDS, HOVER_IDS } from './wearable-catalog';
import { WEARABLE_MODS_BY_ITEM } from './wearable-mod-catalog';

// These are gameplay classifications, not mappings of cosmetic punch sprites.
// Only positive-count equipped slots count; effects disappear on unequip/reload.
export const hasRaymanFist = (a: PlayerAccount): boolean => a.inventory.some(s=>s.equipped && s.count>0 && s.itemId===5480);
export const hasEnhancedDigging = (a: PlayerAccount): boolean => equippedAbilities(a).damage.length > 0 || activeMods(a).some(m=>m.punchDamage);
export interface EquippedAbilities {
  damage: number[]; punchRange: number[]; buildRange: number[]; doubleJump: number[]; speedy: number[]; highJump: number[]; hover: number[];
}
export function equippedAbilities(a: PlayerAccount): EquippedAbilities {
  const r: EquippedAbilities={damage:[],punchRange:[],buildRange:[],doubleJump:[],speedy:[],highJump:[],hover:[]};
  for (const slot of a.inventory) {
    if (!slot.equipped || slot.count<=0) continue;
    const id=slot.itemId;
    const mods = WEARABLE_MODS_BY_ITEM[id] || [];
    if (PUNCH_DAMAGE_IDS.has(id) || mods.includes('Punch Damage')) r.damage.push(id);
    if (PUNCH_RANGE_IDS.has(id) || mods.includes('Punch Range')) r.punchRange.push(id);
    if (BUILD_RANGE_IDS.has(id) || mods.includes('Build Range')) r.buildRange.push(id);
    if (DOUBLE_JUMP_IDS.has(id) || mods.includes('Double Jump')) r.doubleJump.push(id);
    if (SPEEDY_IDS.has(id) || mods.includes('Speedy')) r.speedy.push(id);
    if (HIGH_JUMP_IDS.has(id) || mods.includes('High Jump')) r.highJump.push(id);
    if (HOVER_IDS.has(id) || mods.includes('Slow Fall')) r.hover.push(id);
  }
  return r;
}
