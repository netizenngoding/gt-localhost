import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function broadcastOnRemove(world: WorldInstance, leaving: PlayerSession): void {
  const pkt = makeVariantPacket(["OnRemove", `netID|${leaving.netId}\npId|${leaving.account.userId}\n`]);
  for (const p of world.peers) {
    if (p !== leaving) p.peer.sendPacket(0, pkt, true);
  }
}
