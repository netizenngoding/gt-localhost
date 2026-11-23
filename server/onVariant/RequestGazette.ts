import { SERVER_NAME } from "../config/branding";
import { DialogBuilder } from "../tools/create_dialog";
import type { PlayerSession } from "../database/peer";
import { OnDialogRequest } from "./OnDialogRequest";
import { GAZETTE_NEWS } from "./RequestWorldSelectMenu";

/**
 * Modeled on Gurotopia's `onVariant/RequestGazette.hpp`, strictly using V1.50-verified
 * `OnDialogRequest` (`ReGrowtopia-1.50.wasm` has no `OnRequestGazette` variant handler).
 */
export function RequestGazette(session: PlayerSession): void {
  const acct = session.account;
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`wThe ${SERVER_NAME} Gazette\`\``, 5016)
    .addSpacer("small")
    .addImageButton("gazette_banner", "interface/large/news_banner.rttex", "bannerlayout")
    .addSpacer("small")
    .addTextbox(
      acct.isGuest
        ? `\`oWelcome, \`w${acct.name}\`o (\`#Guest Account\`o)! Open the pause menu (\`wESC\`o) and click \`2Get GrowID\`\` anytime to secure your progress with a free GrowID.\`\``
        : `\`oWelcome back, \`2${acct.name}\`o! Your GrowID & 10-slot outfit are automatically saved.\`\``
    )
    .addSpacer("small");

  for (const n of GAZETTE_NEWS) {
    dlg.addLabelWithIcon("small", `\`2${n.title}\`\``, 482);
    dlg.addSmallText(`\`o${n.body}\`\``);
    dlg.addSpacer("small");
  }

  if (acct.isGuest) {
    dlg.addButton("open_growid_apply", "`2Get a Free GrowID!``");
  }
  dlg.addQuickExit();
  OnDialogRequest(session, dlg.endDialog("gazette", "Close", ""));
}
