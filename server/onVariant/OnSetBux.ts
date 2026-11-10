import { isSuperSupporter } from "../progression/service";
import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

export function OnSetBux(session: PlayerSession): void {
  session.peer.sendPacket(
    0,
    makeVariantPacket([
      "OnSetBux",
      { type: "i32", value: session.account.gems },
      { type: "i32", value: 0 },
      { type: "i32", value: isSuperSupporter(session.account) ? 1 : 0 },
      { type: "vec3", x: isSuperSupporter(session.account) ? 33796 : 0, y: isSuperSupporter(session.account) ? 1 : 0, z: 0 },
    ]),
    true
  );
}
