import { buildTankPacket, PACKET_SET_ICON_STATE } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function broadcastIconState(
  world: WorldInstance,
  session: PlayerSession,
  state: number,
  includeSelf = false
): void {
  const pkt = buildTankPacket({
    type: PACKET_SET_ICON_STATE,
    netId: session.netId,
    flags: state,
    value: state,
  });
  session.iconState = state;
  session.lastIconStatePacket = state === 0 ? undefined : pkt;
  for (const other of world.peers) {
    if (includeSelf || other !== session) {
      other.peer.sendPacket(0, pkt, true);
    }
  }
}
