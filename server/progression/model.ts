/** Server-owned progression. Never populated from login/dialog packet fields. */
export interface Progression {
  version: 1;
  level: number;
  xp: number;
  superSupporter: boolean;
  hideStatus: boolean;
  counters: Record<string, number>;
  earned: Record<string, number>;
}
export const MAX_LEVEL = 125;
export const SUPER_SUPPORTER_LEVEL = 50; // This server's rule, NOT the official purchase requirement.
export const xpRequired = (level: number): number => 50 * (level * level + 2);
const integer = (n: unknown, min: number, max: number, fallback = min): number =>
  typeof n === 'number' && Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
export function normalizeProgression(raw?: Partial<Progression>): Progression {
  const level = integer(raw?.level, 1, MAX_LEVEL);
  const record = (input: unknown): Record<string, number> => {
    const out: Record<string, number> = Object.create(null);
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      for (const [key, value] of Object.entries(input).slice(0, 512)) {
        if (/^[a-z][a-z0-9_]{0,63}$/.test(key) && key !== 'constructor' && key !== 'prototype') out[key] = integer(value, 0, Number.MAX_SAFE_INTEGER);
      }
    }
    return out;
  };
  return {version: 1, level, xp: level === MAX_LEVEL ? 0 : integer(raw?.xp, 0, xpRequired(level) - 1),
    superSupporter: raw?.superSupporter === true || level >= SUPER_SUPPORTER_LEVEL,
    hideStatus: raw?.hideStatus === true,
    counters: record(raw?.counters), earned: record(raw?.earned)};
}
export function addXp(p: Progression, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000) return;
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= xpRequired(p.level)) { p.xp -= xpRequired(p.level); p.level++; }
  if (p.level === MAX_LEVEL) p.xp = 0;
  if (p.level >= SUPER_SUPPORTER_LEVEL) p.superSupporter = true;
}
export function farmingXp(rarity: number): number {
  // Wiki Leveling: 1 + rarity/5 truncated; unranked (999) items must not yield 200 XP.
  return 1 + Math.floor(Math.max(0, Math.min(200, rarity === 999 ? 0 : rarity)) / 5);
}
