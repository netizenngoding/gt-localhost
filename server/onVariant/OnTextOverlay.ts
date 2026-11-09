import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnTextOverlay(session: PlayerSession, message: string): void {
  session.peer.sendPacket(0, makeVariantPacket(["OnTextOverlay", message]), true);
}

export function broadcastTextOverlay(world: WorldInstance, message: string): void {
  const pkt = makeVariantPacket(["OnTextOverlay", message]);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}
