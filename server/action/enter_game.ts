import { SERVER_NAME } from "../config/branding";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import {
  OnConsoleMessage,
  OnSetBux,
  RequestGazette,
  RequestWorldSelectMenu,
  SetHasGrowID,
} from "../onVariant";

export function handleEnterGame(ctx: ServerContext, session: PlayerSession): void {
  if (session.enteredGame) return;
  session.enteredGame = true;
  const acct = session.account;
  // Send inventory once on enter_game (modeled on Gurotopia `action/enter_game.cpp`)
  ctx.sendInventory(session, false);
  OnSetBux(session);
  if (acct.isGuest) {
    SetHasGrowID(session, false, "", "");
  }
  OnConsoleMessage(
    session,
    acct.isGuest
      ? `\`2Welcome to ${SERVER_NAME}, \`w${acct.name}\`\` (\`#Guest Account\`\`)! Press \`wESC\`\` -> \`2Get GrowID\`\` anytime to upgrade for free.`
      : `\`2Welcome back to ${SERVER_NAME}, \`w${acct.name}\`\`! Select a world or enter any name to play.`
  );
  RequestWorldSelectMenu(session, ctx.worlds);
  RequestGazette(session);
}
