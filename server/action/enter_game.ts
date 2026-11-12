import { SERVER_NAME } from "../config/branding";
import { isPlayableWorldName } from "../database/world-policy";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import {
  OnConsoleMessage,
  OnPlayPositioned,
  OnSetBux,
  OnEmoticonDataChanged,
  RequestGazette,
  SetHasGrowID,
} from "../onVariant";

export function handleEnterGame(ctx: ServerContext, session: PlayerSession): void {
  if (session.enteredGame) return;
  session.enteredGame = true;
  const acct = session.account;
  ctx.sendInventory(session, false);
  OnSetBux(session);
  OnEmoticonDataChanged(session);
  if (acct.isGuest) {
    SetHasGrowID(session, false, "", "");
  }
  OnPlayPositioned(session, "audio/door_open.wav");

  // Exact GTPS3 Source.cpp:4202-4217 welcome console messages
  const friendsCount = (acct.friendIds || []).length;
  const friendsOnline = (acct.friendIds || []).filter(id => [...ctx.sessions].some(s => s.account.userId === id)).length;
  const friendMsg = friendsCount === 0 ? "" : (friendsOnline > 0 ? ` \`w${friendsOnline}\`\` friend is online.` : " No friends are online.");

  OnConsoleMessage(session, `Welcome back, \`w${acct.name}\`\`\`\`.${friendMsg}`);
  OnConsoleMessage(session, "`2Goals event``: Start working on your goals, you can be farmer, geiger hunter, take providers to receive prizes for leveling up. You will be able to claim your rewards at the end of the week!");
  OnConsoleMessage(session, "`3Limited time event``: 3x Gems from breaking blocks, Trees time reduced by 50%, Providers time reduced by 50%!");

  const day = new Date().getDay();
  if (day === 1) OnConsoleMessage(session, "`3Today is Trees Day!`` 50% higher chance to get `2extra block`` from harvesting tree.");
  else if (day === 2) OnConsoleMessage(session, "`3Today is Breaking Day!`` 15% higher chance to get `2extra seed``.");
  else if (day === 3) OnConsoleMessage(session, "`3Today is Geiger Day!`` Higher chance of getting a `2better Geiger prize`` & Irradiated mod will last only `210 minutes``.");
  else if (day === 4) OnConsoleMessage(session, "`3Today is Tasks Day!`` Get extra `210`` points for completing a task.");
  else if (day === 5) OnConsoleMessage(session, "`3Today is Gems Day!`` 50% higher chance to get `2extra`` gem drop.");
  else if (day === 6) OnConsoleMessage(session, "`3Today is Surgery Day!`` Malpractice takes `215 minutes`` and Recovering takes `230 minutes`` & receive `2different prizes``.");
  else if (day === 0) OnConsoleMessage(session, "`3Today is Fishing Day!`` Catch a fish and receive `2extra lb``.");
  // Growtopia native flow: automatically rejoin the most recent world if one exists, otherwise START
  const recent = (acct.recentWorlds || []).filter((w) => isPlayableWorldName(w));
  const autoWorld = recent.length > 0 ? recent[0] : "START";
  ctx.joinWorld(session, autoWorld);
  RequestGazette(session);
}
