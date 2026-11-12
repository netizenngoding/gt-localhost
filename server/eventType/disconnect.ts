import type { ENetServerPeer } from "../network/enet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";

export function onPeerDisconnect(ctx: ServerContext, peer: ENetServerPeer): void {
  const session = peer.userData as PlayerSession | null;
  if (!session) return;

  peer.userData = null;
  ctx.leaveCurrentWorld(session, false);
  ctx.sessions.delete(session);
  if (session.account.isGuest) { session.account.rank = "player"; session.account.moderator = false; }
  // Immediately persist player & world state on disconnect so reconnects NEVER lose equipped items or drops!
  ctx.savePersistentState();
}
