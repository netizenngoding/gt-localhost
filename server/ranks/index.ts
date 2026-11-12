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
  // Display text cannot supply @, newline or packet delimiters.
  const rawNick = session.account.nickname?.trim();
  if (rawNick) {
    return rawNick.replace(/[|\r\n\0]/g, "").slice(0, 24) + "``";
  }
  const name = session.account.name.replace(/[^A-Za-z0-9_]/g, "").slice(0,18);
  const rank = rankOf(session.account);
  let prefix: string = RANKS[rank].prefix;
  if (session.world) {
    // Staff keep their rank colour inside their own world. Only ordinary
    // players switch to the world-owner green, so moderators/developers no
    // longer turn green simply by placing a lock.
    if (session.world.ownerUserId === session.account.userId && rank === "player") prefix = "`2";
    else if (rank === "player" && session.world.tiles.some(t => t.extra?.kind === "lock" && [242,1796,7188,11550].includes(t.fg) && t.extra.adminIds.includes(session.account.userId))) prefix = "`^";
  }
  return `${prefix}${name}\`\``;
}

export function protocolFlags(account: PlayerAccount): {mstate:number;smstate:number} {
  const level=RANKS[rankOf(account)].level;
  return {mstate:level>=1?1:0,smstate:level>=2?1:0};
}
