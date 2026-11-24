import type { PlayerAccount, PlayerSession } from "../database/peer";
import { RANKS, isRank, type Permission, type RankId } from "./definitions";
import { allRanks, rankDef, setAssignment, assignmentOf } from "./registry";
export { RANKS, type RankId } from "./definitions";
export type { Permission, RankDefinition } from "./registry";
export { allRanks, rankDef, ALL_PERMISSIONS, createRank, deleteRank, updateRank, setAssignment, assignmentOf, reloadRanks, saveRanks, rankExists } from "./registry";

export function rankOf(account: Pick<PlayerAccount, "rank">): RankId {
  return isRank(account.rank) ? account.rank : "player";
}

export function rankLevel(account: Pick<PlayerAccount, "rank">): number {
  return RANKS[rankOf(account)].level;
}

export function hasPermission(account: Pick<PlayerAccount, "rank">, permission: Permission): boolean {
  return RANKS[rankOf(account)].permissions.includes(permission);
}

export function canModerate(actor: PlayerAccount, target: PlayerAccount): boolean {
  return hasPermission(actor, "moderate") && rankLevel(actor) > rankLevel(target);
}

/** May `actor` hand out the given rank? Never above their own level. */
export function canAssignRank(actor: PlayerAccount, rankId: string): boolean {
  if (!hasPermission(actor, "setRanks")) return false;
  if (!isRank(rankId)) return false;
  // Developers/owners may hand out any rank; everyone else only up to their level.
  if (hasPermission(actor, "debug")) return true;
  return RANKS[rankId].level <= rankLevel(actor);
}

export function applyRank(account: PlayerAccount, rankId: string): void {
  account.rank = rankId;
  account.moderator = rankId !== "player";
  setAssignment(account.userId, rankId);
}

const WORLD_LOCK_ITEM_IDS = [242, 1796, 7188, 11550];

export function displayName(session: PlayerSession): string {
  // Display text cannot supply @, newline or packet delimiters.
  const rawNick = session.account.nickname?.trim();
  if (rawNick) {
    return rawNick.replace(/[|\r\n\0]/g, "").slice(0, 24) + "``";
  }
  const name = session.account.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 18);
  const rank = rankOf(session.account);
  const def = RANKS[rank];
  let prefix: string = def.prefix;
  // AstroVerse Role::Prefix2: only unrestriced ranks fall back to the
  // world-owner green / lock-admin colour.
  if (def.level === 0 && def.permissions.length === 0 && session.world) {
    if (session.world.ownerUserId === session.account.userId) prefix = "`2";
    else if (
      session.world.tiles.some(
        (t) => t.extra?.kind === "lock" && WORLD_LOCK_ITEM_IDS.includes(t.fg) && t.extra.adminIds.includes(session.account.userId)
      )
    )
      prefix = "`^";
  }
  return `${prefix}${name}\`\``;
}

/** Chat text colour for a rank (AstroVerse `chatcolor`). */
export function chatColorOf(account: Pick<PlayerAccount, "rank">): string {
  return RANKS[rankOf(account)].chatColor;
}

/** Name colour (prefix) for a rank. */
export function nameColorOf(account: Pick<PlayerAccount, "rank">): string {
  return RANKS[rankOf(account)].prefix;
}

/**
 * Staff client flags. AstroVerse/Magnolia give moderators and above the
 * expanded camera and long punch, so those flags follow the permissions
 * instead of a rank name. VIP and players always get 0.
 */
export function protocolFlags(account: PlayerAccount): { mstate: number; smstate: number } {
  const moderate = hasPermission(account, "moderate");
  return { mstate: moderate ? 1 : 0, smstate: moderate ? 1 : 0 };
}

export { allRanks as listRanks };
