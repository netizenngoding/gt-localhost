import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import { ModernDialog, type ModernDialogSpec } from "../tools/modern_dialog";

/**
 * Sends a modern Growtopia RmlUi popup (`OnModernDialogRequest`) to `session`.
 *
 * Accepts:
 *  - a `ModernDialog` builder instance,
 *  - a raw `ModernDialogSpec` JSON object, OR
 *  - any classic Growtopia pipe-delimited dialog string (`set_default_color|...`).
 */
export function OnModernDialogRequest(
  session: PlayerSession,
  dialog: ModernDialog | ModernDialogSpec | string,
  delayMs = 0
): void {
  if (!session.peer) return;
  let payloadJson: string;
  if (dialog instanceof ModernDialog) {
    payloadJson = dialog.toJson();
  } else if (typeof dialog === "string") {
    const trimmed = dialog.trim();
    payloadJson = trimmed.startsWith("{")
      ? trimmed
      : JSON.stringify(ModernDialog.fromPipeString(dialog));
  } else {
    payloadJson = JSON.stringify(dialog);
  }
  session.peer.sendPacket(
    0,
    makeVariantPacket(["OnModernDialogRequest", payloadJson], -1, delayMs),
    true,
    false
  );
}
