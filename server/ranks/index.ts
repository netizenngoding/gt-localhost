import type { PlayerAccount, PlayerSession } from "../database/peer";
import { RANKS, isRank, type RankId, type Permission } from "./definitions";
export { RANKS, type RankId } from "./definitions";
export function rankOf(account: Pick<PlayerAccount, "rank">): RankId { return isRank(account.rank) ? account.rank : "player"; }
export function hasPermission(account: Pick<PlayerAccount, "rank">, permission: Permission): boolean {
  return RANKS[rankOf(account)].level >= (permission === "moderate" ? 1 : 2);
}
export function canModerate(actor: PlayerAccount, target: PlayerAccount): boolean {
  return hasPermission(actor, "moderate") && RANKS[rankOf(actor)].level > RANKS[rankOf(target)].level;
}
export function displayName(session: PlayerSession): string {
  // Display text cannot supply color codes, @, newline or packet delimiters.
  const name = session.account.name.replace(/[^A-Za-z0-9_]/g, "").slice(0,18);
  const rank = rankOf(session.account);
  let prefix: string = RANKS[rank].prefix;
  if (rank === "player" && session.world) {
    if (session.world.ownerUserId === session.account.userId) prefix = "`2";
    else if (session.world.tiles.some(t => t.extra?.kind === "lock" && [242,1796,7188].includes(t.fg) && t.extra.adminIds.includes(session.account.userId))) prefix = "`^";
  }
  return `${prefix}${name}\`\``;
}

export function protocolFlags(account: PlayerAccount): {mstate:number;smstate:number} {
  const level=RANKS[rankOf(account)].level;
  return {mstate:level>=1?1:0,smstate:level>=2?1:0};
}
