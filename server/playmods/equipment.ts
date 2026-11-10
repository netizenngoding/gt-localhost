import type { PlayerAccount } from '../database/peer';
// Original items only. A visual/animation marker (items.dat isRayman) is NOT a gameplay ability.
export const hasRaymanFist = (a: PlayerAccount): boolean => a.inventory.some(s=>s.equipped && s.count>0 && s.itemId===5480);
// Pickaxe and Golden Pickaxe: Enhanced Digging reduces the successful break threshold
// by one hit, never below one. No build/punch range bonus (GTOSLatest player/tile logic).
export const hasEnhancedDigging = (a: PlayerAccount): boolean => a.inventory.some(s=>s.equipped && s.count>0 && [98,1438].includes(s.itemId));
