import { displayName } from "../ranks";
import { makeVariantPacket } from "../proton/packet";
import { liveSessions, type PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

/**
 * netIds are unique server-wide (ctx.nextNetId increments across every session),
 * so OnNameChanged can be delivered to every live session: any viewer that
 * currently has this avatar on screen — in any world — sees the new name
 * instantly. Nobody ever has to relog to see an access/rank colour change
 * (AstroVerse only refreshed the current world; this is strictly fresher).
 */
export function broadcastNameChanged(
  sessionOrWorld: PlayerSession | WorldInstance,
  maybeSession?: PlayerSession
): void {
  const session = maybeSession ?? (sessionOrWorld as PlayerSession);
  const name = displayName(session);
  const shown = makeVariantPacket(["OnNameChanged", name], session.netId);
  // While `/invis` is on, the name plate stays blank for everybody else (the
  // state mask only hides the body). The owner of the account keeps their name.
  const blank = makeVariantPacket(["OnNameChanged", ""], session.netId);
  for (const p of liveSessions) {
    p.peer.sendPacket(0, session.invis && p !== session ? blank : shown, true);
  }
}

/** Re-broadcast every member's name of a world after access/ownership changed. */
export function refreshWorldNames(world: WorldInstance): void {
  for (const p of world.peers) broadcastNameChanged(p);
}