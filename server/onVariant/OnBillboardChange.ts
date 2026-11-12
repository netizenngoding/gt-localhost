import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnBillboardChange(target: PlayerSession, subject: PlayerSession): void {
  const b = subject.account.billboard;
  if (!b) return;
  const billFlags = `${b.show ? 1 : 0},${b.buying ? 1 : 0}`;
  target.peer.sendPacket(
    0,
    makeVariantPacket(
      [
        "OnBillboardChange",
        { type: "i32", value: subject.netId },
        { type: "i32", value: b.itemId },
        billFlags,
        { type: "i32", value: b.priceWl },
        { type: "i32", value: b.perItem ? 1 : 0 },
      ],
      subject.netId
    ),
    true
  );
}

export function broadcastBillboardChange(world: WorldInstance, subject: PlayerSession): void {
  for (const p of world.peers) {
    OnBillboardChange(p, subject);
  }
}
