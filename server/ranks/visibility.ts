import type { PlayerSession } from "../database/peer";
import { rankLevel } from "./index";
import { isHiddenStaff } from "./staff_hidden";

/**
 * Who may know about this player right now.
 *
 * `/invis` is a hard blackout for every other account: no spawn, no movement,
 * no clothing, no character state and no name plate reach their clients while
 * `target.invis` is set. The invisible player still sees themselves (and keeps
 * receiving their own packets), which is what makes the toggle stable: there
 * is no partial "eyes only" state that can desynchronise.
 *
 * `/hide` keeps its own rank hierarchy for staff.
 */
export function canSeePlayer(viewer: PlayerSession, target: PlayerSession): boolean {
  if (viewer === target) return true;
  if (target.invis) return false;
  if (isHiddenStaff(target) && rankLevel(viewer.account) < rankLevel(target.account)) return false;
  return true;
}

/** Peers this viewer is allowed to know about right now. */
export function visiblePeers(viewer: PlayerSession): PlayerSession[] {
  const world = viewer.world;
  if (!world) return [viewer];
  return [...world.peers].filter((peer) => canSeePlayer(viewer, peer));
}

/**
 * Chat visibility while `/invis` is on: the message (bubble and console line)
 * only reaches accounts whose rank level is at least the sender's, so staff of
 * the same rank or higher still read it while everybody below sees nothing.
 */
export function canSeeInvisChat(viewer: PlayerSession, target: PlayerSession): boolean {
  if (viewer === target) return true;
  if (!target.invis) return true;
  return rankLevel(viewer.account) >= rankLevel(target.account);
}
