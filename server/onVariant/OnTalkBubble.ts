import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnTalkBubble(
  session: PlayerSession,
  netId: number,
  text: string,
  colorFlag = 0,
  overlay = false
): void {
  const args: Parameters<typeof makeVariantPacket>[0] = [
    "OnTalkBubble",
    { type: "u32", value: netId >>> 0 },
    text,
    { type: "u32", value: colorFlag >>> 0 },
  ];
  if (overlay) {
    args.push({ type: "u32", value: 1 });
  }
  session.peer.sendPacket(0, makeVariantPacket(args), true);
}

export function broadcastTalkBubble(
  world: WorldInstance,
  netId: number,
  text: string,
  colorFlag = 0,
  overlay = false
): void {
  const args: Parameters<typeof makeVariantPacket>[0] = [
    "OnTalkBubble",
    { type: "u32", value: netId >>> 0 },
    text,
    { type: "u32", value: colorFlag >>> 0 },
  ];
  if (overlay) {
    args.push({ type: "u32", value: 1 });
  }
  const pkt = makeVariantPacket(args);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}
