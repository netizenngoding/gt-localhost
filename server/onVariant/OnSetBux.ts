import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

export function OnSetBux(session: PlayerSession): void {
  session.peer.sendPacket(
    0,
    makeVariantPacket([
      "OnSetBux",
      { type: "i32", value: session.account.gems },
      { type: "i32", value: 0 },
      { type: "i32", value: 0 },
    ]),
    true
  );
}
