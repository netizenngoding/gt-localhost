export type RankId = "player" | "moderator" | "developer";
export type Permission = "moderate" | "grantItems" | "debug";
export const RANKS = {
  player: { label: "Player", prefix: "`w", level: 0 },
  moderator: { label: "Moderator", prefix: "`#@", level: 1 },
  developer: { label: "Developer", prefix: "`6@", level: 2 },
} as const;
export function isRank(value: unknown): value is RankId {
  return value === "player" || value === "moderator" || value === "developer";
}
