import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";

export function handleFriends(ctx: ServerContext, session: PlayerSession): void {
  const online = Array.from(ctx.sessions);
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wSocial Portal``", 1366)
    .addSmalltext(`\`2Online Players: \`w${online.length}\`\``)
    .addSpacer("small");

  for (const p of online.slice(0, 30)) {
    const loc = p.world ? p.world.name : "EXIT";
    dlg.addTextbox(
      `\`2*\`\` \`w${p.account.name}\`\` ${p.account.isGuest ? "`#([Guest])``" : "`2([GrowID])``"} - in \`5${loc}\`\``
    );
  }
  dlg.addQuickExit();
  OnDialogRequest(session, dlg.endDialog("social_portal", "Close", ""));
}
