import { allRanks, rankDef, type Permission, type RankDefinition } from "./registry";

/** Rank id is free-form: any id created in data_store/ranks.json is valid. */
export type RankId = string;
export type { Permission, RankDefinition } from "./registry";

/**
 * Backwards-compatible view over the dynamic registry.
 * Existing code reads `RANKS[id].label/.prefix/.level`; a Proxy keeps that
 * working while the underlying table can change at runtime.
 */
export const RANKS: Record<string, { label: string; prefix: string; level: number; chatColor: string; permissions: Permission[] }> =
  new Proxy({} as Record<string, RankDefinition>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return rankDef(prop);
    },
    has(_target, prop) {
      return typeof prop === "string" && allRanks().some((r) => r.id === prop);
    },
    ownKeys() {
      return allRanks().map((r) => r.id);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return { enumerable: true, configurable: true, value: rankDef(prop) };
    },
  });

export function isRank(value: unknown): value is RankId {
  return typeof value === "string" && allRanks().some((r) => r.id === value);
}
