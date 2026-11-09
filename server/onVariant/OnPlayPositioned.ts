import { makePlayPositionedPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnPlayPositioned(session: PlayerSession, file: string, delayMs = 0): void {
  const netId = session.world ? session.netId : -1;
  session.peer.sendPacket(0, makePlayPositionedPacket(netId, file, delayMs), true);
}

export function broadcastPositionedSfx(world: WorldInstance | null, netId: number, file: string): void {
  if (!world) return;
  const pkt = makePlayPositionedPacket(netId, file);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}
