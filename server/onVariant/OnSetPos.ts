import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnSetPos(
  target: PlayerSession,
  netIdOrX: number,
  xOrY: number,
  maybeY?: number
): void {
  const netId = maybeY !== undefined ? netIdOrX : target.netId;
  const x = maybeY !== undefined ? xOrY : netIdOrX;
  const y = maybeY !== undefined ? maybeY : xOrY;
  target.peer.sendPacket(
    0,
    makeVariantPacket(["OnSetPos", { type: "vec2", x, y }], netId),
    true
  );
}

export function broadcastSetPos(world: WorldInstance, netId: number, x: number, y: number): void {
  const pkt = makeVariantPacket(["OnSetPos", { type: "vec2", x, y }], netId);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}
