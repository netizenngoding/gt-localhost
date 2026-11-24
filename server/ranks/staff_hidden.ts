import type { PlayerSession } from "../database/peer";

/**
 * `/hide` state (GTPS3 `pInfo->m_h`).
 *
 * Hidden staff stay out of player-facing lists (`/mods`, `/who`, `/msg`) and
 * are not spawned for players; other staff still see and reach them.
 */
const hidden = new WeakSet<PlayerSession>();

export function isHiddenStaff(session: PlayerSession): boolean {
  return hidden.has(session);
}

/** Returns the new state. */
export function toggleHiddenStaff(session: PlayerSession): boolean {
  if (hidden.has(session)) {
    hidden.delete(session);
    return false;
  }
  hidden.add(session);
  return true;
}
