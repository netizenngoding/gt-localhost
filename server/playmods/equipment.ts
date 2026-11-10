import type { PlayerAccount } from '../database/peer';
import { activeMods } from './model';
import { PUNCH_DAMAGE_IDS, PUNCH_RANGE_IDS, BUILD_RANGE_IDS, DOUBLE_JUMP_IDS, SPEEDY_IDS } from './wearable-catalog';

// These are gameplay classifications, not mappings of cosmetic punch sprites.
// Only positive-count equipped slots count; effects disappear on unequip/reload.
export const hasRaymanFist = (a: PlayerAccount): boolean => a.inventory.some(s=>s.equipped && s.count>0 && s.itemId===5480);
export const hasEnhancedDigging = (a: PlayerAccount): boolean => a.inventory.some(s=>s.equipped && s.count>0 && PUNCH_DAMAGE_IDS.has(s.itemId)) || activeMods(a).some(m=>m.punchDamage);
export interface EquippedAbilities {
  damage: number[]; punchRange: number[]; buildRange: number[]; doubleJump: number[]; speedy: number[];
}
export function equippedAbilities(a: PlayerAccount): EquippedAbilities {
  const r: EquippedAbilities={damage:[],punchRange:[],buildRange:[],doubleJump:[],speedy:[]};
  for (const slot of a.inventory) {
    if (!slot.equipped || slot.count<=0) continue;
    const id=slot.itemId;
    if (PUNCH_DAMAGE_IDS.has(id)) r.damage.push(id);
    if (PUNCH_RANGE_IDS.has(id)) r.punchRange.push(id);
    if (BUILD_RANGE_IDS.has(id)) r.buildRange.push(id);
    if (DOUBLE_JUMP_IDS.has(id)) r.doubleJump.push(id);
    if (SPEEDY_IDS.has(id)) r.speedy.push(id);
  }
  return r;
}
