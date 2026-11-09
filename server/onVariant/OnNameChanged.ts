import { displayName } from "../ranks";
import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function broadcastNameChanged(
  sessionOrWorld: PlayerSession | WorldInstance,
  maybeSession?: PlayerSession
): void {
  const session = maybeSession ?? (sessionOrWorld as PlayerSession);
  const pkt = makeVariantPacket(["OnNameChanged", displayName(session)], session.netId);
  if (session.world) {
    for (const p of session.world.peers) p.peer.sendPacket(0, pkt, true);
  } else {
    session.peer.sendPacket(0, pkt, true);
  }
}
