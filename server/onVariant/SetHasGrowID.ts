import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

/**
 * Verified in ReGrowtopia-1.50.wasm:
 *  - Guest Account: SetHasGrowID(0, "", "") -> PauseMenu displays `"Get GrowID (#It's free!)"`!
 *  - Registered GrowID: SetHasGrowID(1, growId, passwordOrBlank) -> saves GrowID into client shared db!
 */
export function SetHasGrowID(
  session: PlayerSession,
  hasGrowId: boolean,
  growIdName = "",
  plainPasswordToSave = ""
): void {
  session.peer.sendPacket(
    0,
    makeVariantPacket([
      "SetHasGrowID",
      { type: "i32", value: hasGrowId ? 1 : 0 },
      hasGrowId ? growIdName : "",
      plainPasswordToSave,
    ]),
    true
  );
}
