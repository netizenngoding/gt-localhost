import fs from "node:fs";
import path from "node:path";

/**
 * Dynamic rank registry, modelled on AstroVerse's `RoleManager`
 * (`database/json/roles_config.json` + `Role::Prefix` / `Role::RecalculateLevel`).
 *
 * Difference: every rank field is editable at runtime and persisted to
 * `data_store/ranks.json`, so operators can create unlimited ranks with their
 * own level, chat/name prefix, chat colour and permissions.
 */
export type Permission = "moderate" | "grantItems" | "debug" | "setRanks";

export interface RankDefinition {
  id: string;
  label: string;
  level: number;
  /** Colour codes placed before the player name, e.g. "`^" or "`6@". */
  prefix: string;
  /** Colour code used for the chat text of this rank. */
  chatColor: string;
  permissions: Permission[];
}

export const ALL_PERMISSIONS: Permission[] = ["moderate", "grantItems", "debug", "setRanks"];

/** AstroVerse ladder, with `^` for moderators and `5` for developers. */
const DEFAULT_RANKS: RankDefinition[] = [
  { id: "player", label: "Player", level: 0, prefix: "`w", chatColor: "`$", permissions: [] },
  { id: "vip", label: "VIP", level: 1, prefix: "`1", chatColor: "`1", permissions: [] },
  { id: "moderator", label: "Moderator", level: 3, prefix: "`#@", chatColor: "`^", permissions: ["moderate"] },
  { id: "administrator", label: "Administrator", level: 4, prefix: "`8@", chatColor: "`^", permissions: ["moderate", "grantItems", "debug", "setRanks"] },
  { id: "owner", label: "Owner", level: 8, prefix: "`6@", chatColor: "`5", permissions: ["moderate", "grantItems", "debug", "setRanks"] },
];

export const RANK_ID_PATTERN = /^[a-z0-9_]{1,24}$/;
const MAX_RANKS = 200;
const MAX_ASSIGNMENTS = 5000;

let ranks = new Map<string, RankDefinition>();
let assignments = new Map<number, string>();
let storeFile = "";

function sanitizeText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[|\r\n\0]/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function normalizeRank(raw: unknown, id: string): RankDefinition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (!RANK_ID_PATTERN.test(id)) return undefined;
  const base = DEFAULT_RANKS.find((r) => r.id === id);
  const level = Number(value.level);
  const perms = Array.isArray(value.permissions)
    ? (value.permissions.filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission)))
    : base?.permissions ?? [];
  return {
    id,
    label: sanitizeText(value.label, 32, base?.label ?? id),
    level: Number.isFinite(level) ? Math.max(0, Math.min(1000, Math.trunc(level))) : base?.level ?? 0,
    prefix: sanitizeText(value.prefix, 8, base?.prefix ?? "`w"),
    chatColor: sanitizeText(value.chatColor, 8, base?.chatColor ?? "`w"),
    permissions: [...new Set(perms)],
  };
}

function seedDefaults(): void {
  ranks = new Map(DEFAULT_RANKS.map((r) => [r.id, { ...r, permissions: [...r.permissions] }]));
  assignments = new Map();
}

/** Loads (and on first run creates) `data_store/ranks.json`. */
export function loadRanks(rootDir: string): void {
  storeFile = path.join(rootDir, "data_store", "ranks.json");
  seedDefaults();
  if (!fs.existsSync(storeFile)) {
    saveRanks();
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  } catch {
    console.warn("[ranks] ranks.json is not valid JSON; keeping defaults");
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const config = parsed as Record<string, unknown>;

  // Legacy v1 files only had assignments; keep them and add the defaults.
  const rawRanks = config.ranks;
  if (rawRanks && typeof rawRanks === "object" && !Array.isArray(rawRanks)) {
    const next = new Map<string, RankDefinition>();
    for (const [id, value] of Object.entries(rawRanks as Record<string, unknown>)) {
      const def = normalizeRank(value, id);
      if (def && next.size < MAX_RANKS) next.set(id, def);
    }
    if (next.size) ranks = next;
  }
  if (!ranks.has("player")) {
    const fallback = DEFAULT_RANKS.find((r) => r.id === "player")!;
    ranks.set("player", { ...fallback, permissions: [...fallback.permissions] });
  }

  const rawAssignments = config.assignments;
  if (rawAssignments && typeof rawAssignments === "object" && !Array.isArray(rawAssignments)) {
    let count = 0;
    for (const [key, value] of Object.entries(rawAssignments as Record<string, unknown>)) {
      if (count++ >= MAX_ASSIGNMENTS) break;
      const userId = Number(key);
      if (!/^[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(userId)) continue;
      if (typeof value !== "string" || !ranks.has(value)) continue;
      assignments.set(userId, value);
    }
  }
}

export function saveRanks(): void {
  if (!storeFile) return;
  const payload = {
    schemaVersion: 2,
    ranks: Object.fromEntries([...ranks.values()].map((r) => [r.id, { ...r }])),
    assignments: Object.fromEntries([...assignments.entries()].map(([id, rank]) => [String(id), rank])),
  };
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, storeFile);
}

export function reloadRanks(rootDir: string): number {
  loadRanks(rootDir);
  return ranks.size;
}

export function rankExists(id: string): boolean {
  return ranks.has(id);
}

export function rankDef(id: string | undefined): RankDefinition {
  const found = id ? ranks.get(id) : undefined;
  return found ?? ranks.get("player")!;
}

export function allRanks(): RankDefinition[] {
  return [...ranks.values()].sort((a, b) => b.level - a.level || a.label.localeCompare(b.label));
}

export function createRank(def: Omit<RankDefinition, "permissions"> & { permissions?: Permission[] }): string | undefined {
  if (!RANK_ID_PATTERN.test(def.id)) return "Rank id must be lowercase letters, digits or underscore (max 24).";
  if (ranks.has(def.id)) return `Rank '${def.id}' already exists.`;
  if (ranks.size >= MAX_RANKS) return `Rank limit reached (${MAX_RANKS}).`;
  ranks.set(def.id, {
    id: def.id,
    label: sanitizeText(def.label, 32, def.id),
    level: Math.max(0, Math.min(1000, Math.trunc(def.level) || 0)),
    prefix: sanitizeText(def.prefix, 8, "`w"),
    chatColor: sanitizeText(def.chatColor, 8, "`w"),
    permissions: [...new Set(def.permissions ?? [])],
  });
  saveRanks();
  return undefined;
}

export function deleteRank(id: string): string | undefined {
  if (id === "player") return "The player rank cannot be deleted.";
  if (!ranks.has(id)) return `Rank '${id}' does not exist.`;
  ranks.delete(id);
  for (const [userId, rank] of [...assignments.entries()]) {
    if (rank === id) assignments.set(userId, "player");
  }
  saveRanks();
  return undefined;
}

export function updateRank(id: string, patch: Partial<Omit<RankDefinition, "id">>): string | undefined {
  const current = ranks.get(id);
  if (!current) return `Rank '${id}' does not exist.`;
  const next: RankDefinition = {
    id,
    label: patch.label !== undefined ? sanitizeText(patch.label, 32, current.label) : current.label,
    level: patch.level !== undefined
      ? Math.max(0, Math.min(1000, Math.trunc(patch.level) || 0))
      : current.level,
    prefix: patch.prefix !== undefined ? sanitizeText(patch.prefix, 8, current.prefix) : current.prefix,
    chatColor: patch.chatColor !== undefined ? sanitizeText(patch.chatColor, 8, current.chatColor) : current.chatColor,
    permissions: patch.permissions !== undefined ? [...new Set(patch.permissions)] : current.permissions,
  };
  ranks.set(id, next);
  saveRanks();
  return undefined;
}

export function assignmentOf(userId: number): string | undefined {
  return assignments.get(userId);
}

export function setAssignment(userId: number, rank: string): string | undefined {
  if (!ranks.has(rank)) return `Rank '${rank}' does not exist.`;
  if (assignments.size >= MAX_ASSIGNMENTS && !assignments.has(userId)) return "Assignment limit reached.";
  if (rank === "player") assignments.delete(userId);
  else assignments.set(userId, rank);
  saveRanks();
  return undefined;
}

export function assignmentCount(): number {
  return assignments.size;
}
