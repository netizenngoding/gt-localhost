import type { ServerContext } from "../database/context";
import type { PlayerAccount, PlayerSession } from "../database/peer";
import { chatPortrait, OnConsoleMessage, OnDialogRequest, OnPlayPositioned, OnTalkBubble } from "../onVariant";

/**
 * Friend dialogs copied from AstroVerse
 * (Server/Dialog/dialog_return.h `friends_message` / `friends_edit` goto|msg|mute|trade_block,
 *  Server/Handle/DialogReturn.h `mute_friend` / `block_friend`).
 *
 * Kept in its own module so the message/warp helpers stay out of friends.ts and
 * there is no import cycle; anything that needs to redraw the friend info panel
 * gets it as a callback.
 */
const FRIEND_ICON = 1366;

function clean(name: string, len = 18): string {
  return name.replace(/[^A-Za-z0-9_]/g, "").slice(0, len);
}

function findAccount(ctx: ServerContext, id: number): PlayerAccount | undefined {
  for (const a of ctx.accounts.values()) if (a.userId === id) return a;
  return undefined;
}

function findSession(ctx: ServerContext, id: number): PlayerSession | undefined {
  for (const s of ctx.sessions) if (s.account.userId === id) return s;
  return undefined;
}

type OpenInfo = (userId: number) => void;

/** AstroVerse `friends_message`: write and send a private message from the dialog. */
export function openMessageCompose(
  ctx: ServerContext,
  session: PlayerSession,
  userId: number,
  openInfo: OpenInfo
): void {
  const account = findAccount(ctx, userId);
  session.lastFriendEdit = userId;
  OnDialogRequest(
    session,
    [
      "set_default_color|`o",
      `add_label_with_icon|big|\`5Message to \`\`${clean(account?.name || "friend")}|left|660|`,
      "add_spacer|small|",
      "add_text_input|text|||80|left|",
      "add_spacer|small|",
      `embed_data|friendID|${userId}`,
      "add_button|send|`5Send``|noflags|0|0|",
      "add_button|back|Back|noflags|0|0|",
      "end_dialog|friends_message|||",
      "add_quick_exit|",
    ].join("\n")
  );
  void openInfo;
}

/** AstroVerse Info_Friend `goto`: warp straight to the friend's world. */
export function warpToFriend(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const friendAccount = findAccount(ctx, userId);
  const target = findSession(ctx, userId);
  if (!friendAccount || !target) {
    OnTalkBubble(session, session.netId, "Hmm, my friend isn't in a world right now.", 0, true);
    return;
  }
  if (friendAccount.showLocation === false) {
    // AstroVerse only warps while the friend shares their location.
    OnTalkBubble(session, session.netId, "Hmm, my friend has not made their location public to friends.", 0, true);
    return;
  }
  if (!target.world) {
    OnTalkBubble(session, session.netId, "Hmm, my friend isn't in a world right now.", 0, true);
    return;
  }
  if (target.world === session.world) {
    OnTalkBubble(session, session.netId, "You want to warp to the same world you're in?  That's illogical, captain.", 0, true);
    return;
  }
  ctx.joinWorld(session, target.world.name);
}

/** AstroVerse `mute_friend` confirmation dialog. */
export function openMuteConfirm(
  ctx: ServerContext,
  session: PlayerSession,
  userId: number,
  muted: boolean,
  openInfo: OpenInfo
): void {
  const account = findAccount(ctx, userId);
  const name = clean(account?.name || "this player");
  session.lastFriendEdit = userId;
  const text = muted
    ? `Are you sure you want to \`4Un Mute\`\` ${name}? You will receive any messages from this player until you mute.`
    : `Are you sure you want to \`4Mute\`\` ${name}? You will not receive any messages from this player until you unmute, consider this /ignore a friend`;
  OnDialogRequest(
    session,
    [
      "set_default_color|`o",
      `add_label_with_icon|big|\`wConfirm\`\`|left|${FRIEND_ICON}|`,
      `add_textbox|${text}|left|`,
      `embed_data|friendID|${userId}`,
      "add_button|ok|OK|noflags|0|0|",
      "add_button|back|Back|noflags|0|0|",
      "end_dialog|mute_friend|||",
      "add_quick_exit|",
    ].join("\n")
  );
  void openInfo;
}

/** AstroVerse `block_friend` confirmation dialog. */
export function openTradeConfirm(
  ctx: ServerContext,
  session: PlayerSession,
  userId: number,
  blocked: boolean,
  openInfo: OpenInfo
): void {
  const account = findAccount(ctx, userId);
  const name = clean(account?.name || "this player");
  session.lastFriendEdit = userId;
  const text = blocked
    ? `Are you sure you want to \`4Enable Trade\`\` with ${name}? You will receive any trade request until you disable trading again.`
    : `Are you sure you want to \`4Disable Trade\`\` with ${name}? You will not receive any trade request until you enable trading again.`;
  OnDialogRequest(
    session,
    [
      "set_default_color|`o",
      `add_label_with_icon|big|\`wConfirm\`\`|left|${FRIEND_ICON}|`,
      `add_textbox|${text}|left|`,
      `embed_data|friendID|${userId}`,
      "add_button|ok|OK|noflags|0|0|",
      "add_button|back|Back|noflags|0|0|",
      "end_dialog|block_friend|||",
      "add_quick_exit|",
    ].join("\n")
  );
  void openInfo;
}

/** Private message used by the friends dialog (same wire format as /msg). */
export function sendPrivateMessage(
  ctx: ServerContext,
  session: PlayerSession,
  userId: number,
  body: string
): void {
  const target = findSession(ctx, userId);
  if (!target) {
    OnConsoleMessage(session, "`6>> That friend is not online right now.``");
    return;
  }
  if (session.account.friendMeta?.[String(userId)]?.mute) {
    OnConsoleMessage(session, "`6>> You muted this friend. Unmute them first.``");
    return;
  }
  if (!body) {
    OnConsoleMessage(session, `\`6>> \`$${clean(target.account.name)}\`\` is online now.\`\``);
    return;
  }
  const tname = clean(target.account.name);
  OnConsoleMessage(session, `CT:[MSG]_\`6>> (Sent to \`$${tname}\`\`)\`\``);
  target.lastMsg = session.account.name;
  target.lastMsgWorld = session.world?.name || "";
  OnConsoleMessage(
    target,
    `CP:0_PL:0_OID:_CT:[MSG]_>> \`c>> from (\`\`\`c\`w${session.account.name}\`\`\`\`\`c) in [\`$${session.world?.name || "EXIT"}\`\`] > \`\`\`$${body}\`\``,
    chatPortrait(session, ctx.itemsDb)
  );
  OnPlayPositioned(target, "audio/pay_time.wav");
}
