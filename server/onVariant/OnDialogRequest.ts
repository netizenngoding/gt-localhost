import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

const RGBA_RE = /^[0-9]{1,3}(,[0-9]{1,3}){3}$/;

export function OnDialogRequest(session: PlayerSession, dialogString: string, delayMs = 0): void {
  // AstroVerse SetColor(): a saved dialog theme rides on top of every dialog.
  const border = session.account.borderColor;
  const theme =
    border && border !== "Default" && RGBA_RE.test(border)
      ? `set_border_color|${border}\nset_bg_color|${RGBA_RE.test(session.account.bgColor || "") ? session.account.bgColor : border}\n`
      : "";
  session.peer.sendPacket(0, makeVariantPacket(["OnDialogRequest", theme + dialogString], -1, delayMs), true);
}
