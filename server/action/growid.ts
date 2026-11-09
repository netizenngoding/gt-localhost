import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { applyGrowIdUpgrade } from "./dialog_return/growid_apply";

/**
 * Verified against ReGrowtopia-1.50.wasm Func #4475 @ 1433 (`PauseMenuOnSelect`):
 * Clicking `"Get GrowID (#It's free!)"` sends bare `"action|growid\n"`!
 */
export function showGrowIdApplyModal(
  session: PlayerSession,
  errorBanner = "",
  prefillName = ""
): void {
  const baseFromGuest = session.account.name.replace(/_\d{3,4}$/, "");
  const suggested = prefillName || baseFromGuest || session.account.name;
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wGet a GrowID``", 206)
    .addSpacer("small");

  if (errorBanner) {
    dlg.addTextbox(`\`4${errorBanner}\`\``).addSpacer("small");
  } else {
    dlg.addTextbox(
      "By choosing a `wGrowID``, you can logon from any browser or device! All of your `#Guest Account`` items, worn clothes, gems, and World Locks will transfer automatically."
    );
  }

  const built = dlg
    .addTextInput("logon", "GrowID Name:", suggested, 18)
    .addTextInputPassword("password", "Password:", "", 18)
    .addTextInputPassword("password_verify", "Verify Password:", "", 18)
    .addTextInput("email", "Email (optional):", "", 64)
    .endDialog("growid_apply", "Cancel", "Get My GrowID!");

  OnDialogRequest(session, built);
}

export function handleGrowIdAction(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const inlineName = (kv.tankIDName || kv.logon || "").trim();
  const inlinePass = kv.tankIDPass || kv.password || "";
  if (inlineName && inlinePass) {
    applyGrowIdUpgrade(ctx, session, inlineName, inlinePass, inlinePass);
    return;
  }
  if (!session.account.isGuest) {
    OnConsoleMessage(
      session,
      `\`2You already have a registered GrowID (\`w${session.account.growId || session.account.name}\`2)!\`\``
    );
    return;
  }
  showGrowIdApplyModal(session);
}
