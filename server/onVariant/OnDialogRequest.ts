import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

export function OnDialogRequest(session: PlayerSession, dialogString: string, delayMs = 0): void {
  session.peer.sendPacket(0, makeVariantPacket(["OnDialogRequest", dialogString], -1, delayMs), true);
}
