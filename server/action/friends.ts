import type { ServerContext } from "../database/context";
import type { PlayerAccount, PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest, OnPlayPositioned, OnTalkBubble } from "../onVariant";
import { openSocialPortal } from "./social_portal";
import {
  openMessageCompose as composeMessage,
  openMuteConfirm as muteConfirmDialog,
  openTradeConfirm as tradeConfirmDialog,
  sendPrivateMessage,
  warpToFriend as warpFriend,
} from "./friend_dialogs";

/**
 * Friend system — AstroVerse parity (Server/Handle/WorldInfo.h Friends / Edit_All_Friends /
 * Edit_Friend / Info_Friend + Server/Handle/DialogReturn.h friends_options, all_friends,
 * mute_all_friends, block_all_friends, remove_all_friends + Server/Dialog/dialog_return.h
 * friend_add). Dialog text, button ids and sound cues are copied from AstroVerse:
 *   - request sent      -> audio/tip_start.wav on the receiver + "`3FRIEND REQUEST:`` ..."
 *   - mutual accept     -> audio/love_in.wav on both + "`3FRIEND ADDED:`` ..."
 */

const FRIEND_ICON = 1366;
const MAX_FRIENDS = 200;

export interface FriendView {
  userId: number;
  name: string;
  online: boolean;
  world?: string;
  mute: boolean;
  blockTrade: boolean;
  lastSeen: number;
}

function meta(account: PlayerAccount, userId: number) {
  account.friendMeta ??= {};
  const key = String(userId);
  account.friendMeta[key] ??= { mute: false, blockTrade: false, lastSeen: 0 };
  return account.friendMeta[key];
}

function findAccountById(ctx: ServerContext, id: number): PlayerAccount | undefined {
  for (const a of ctx.accounts.values()) if (a.userId === id) return a;
  return undefined;
}

function findSessionById(ctx: ServerContext, id: number): PlayerSession | undefined {
  for (const s of ctx.sessions) if (s.account.userId === id) return s;
  return undefined;
}

export function friendViews(ctx: ServerContext, account: PlayerAccount): FriendView[] {
  const ids = account.friendIds || [];
  return ids.map((id) => {
    const acc = findAccountById(ctx, id);
    const live = findSessionById(ctx, id);
    const m = meta(account, id);
    return {
      userId: id,
      name: acc?.name || String(id),
      online: !!live,
      // AstroVerse: location is only shared when the friend allows it.
      world: live && acc?.showLocation !== false ? live.world?.name : undefined,
      mute: !!m.mute,
      blockTrade: !!m.blockTrade,
      lastSeen: m.lastSeen || 0,
    };
  });
}

/** AstroVerse add_friend_image_label_button time text: 30s / 12m / 3h / 2d. */
function timeAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ms <= 0) return "never";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function clean(name: string, len = 18): string {
  return name.replace(/[^A-Za-z0-9_]/g, "").slice(0, len);
}

export function openFriends(ctx: ServerContext, session: PlayerSession, all = false): void {
  const account = session.account;
  const views = friendViews(ctx, account);
  const online = views.filter((v) => v.online);
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|${online.length} of ${views.length} \`wFriends Online\`\`|left|${FRIEND_ICON}|`);
  lines.push("add_spacer|small|");

  if (all) {
    // Offline friends first (AstroVerse lists them with their last-seen age) …
    for (const v of views) {
      if (v.online) continue;
      lines.push(`add_button|friend_${v.userId}|\`4(${timeAgo(v.lastSeen)}) \`\`${clean(v.name)}${v.mute ? " <Muted>" : ""}${v.blockTrade ? " <Trade Block>" : ""}\`\`|noflags|0|0|`);
    }
    // … then the ignored list.
    const ignored = (account.ignoredIds || []);
    if (!ignored.length) {
      lines.push("add_textbox|`oYou aren't currently ignoring anyone.``|left|");
    } else {
      for (const id of ignored) {
        const acc = findAccountById(ctx, id);
        lines.push(`add_button|unignore_${id}|\`4Stop ignoring ${clean(acc?.name || String(id))}\`\`|noflags|0|0|`);
      }
    }
    lines.push("add_spacer|small|");
    lines.push("add_button|all_friends|Edit Friends|noflags|0|0|");
    lines.push("add_button|friends_options|Friend Options|noflags|0|0|");
    lines.push("add_button|back|Back|noflags|0|0|");
    lines.push("add_button||Close|noflags|0|0|");
    lines.push("add_quick_exit|");
    lines.push("end_dialog|friends|||");
    OnDialogRequest(session, lines.join("\n"));
    return;
  }

  if (!views.length) {
    lines.push("add_textbox|`oYou currently have no friends.  That's just sad.  To make some, press a person's wrench icon, then choose `5Add as friend``.``|left|");
    lines.push("add_spacer|small|");
  } else if (!online.length) {
    lines.push("add_textbox|`oNone of your friends are currently online.``|left|");
    lines.push("add_spacer|small|");
  } else {
    for (const v of online) {
      lines.push(`add_button|friend_${v.userId}|\`2${clean(v.name)}\`\` ${v.world ? "(" + v.world + ")" : ""}${v.mute ? " <Muted>" : ""}${v.blockTrade ? " <Trade Block>" : ""}|noflags|0|0|`);
    }
    lines.push("add_spacer|small|");
  }
  lines.push("add_button|friend_all|Show offline and ignored too|noflags|0|0|");
  lines.push("add_button|all_friends|Edit Friends|noflags|0|0|");
  lines.push("add_button|friends_options|Friend Options|noflags|0|0|");
  lines.push("add_button|back|Back|noflags|0|0|");
  lines.push("add_button||Close|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|friends|||");
  OnDialogRequest(session, lines.join("\n"));
}

function openFriendOptions(session: PlayerSession): void {
  const account = session.account;
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`wFriend Options\`\`|left|${FRIEND_ICON}|`,
    "add_spacer|small|",
    `add_checkbox|checkbox_public|Show location to friends|${account.showLocation === false ? 0 : 1}`,
    `add_checkbox|checkbox_notifications|Show friend notifications|${account.showFriendNotifications === false ? 0 : 1}`,
    "add_spacer|small|",
    "add_button|back|OK|noflags|0|0|",
    "end_dialog|friends_options|||",
    "add_quick_exit|",
  ];
  OnDialogRequest(session, lines.join("\n"));
}

function openEditFriends(ctx: ServerContext, session: PlayerSession, selected: number[] = []): void {
  const views = friendViews(ctx, session.account);
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`wAll Friends\`\`|left|${FRIEND_ICON}|`);
  lines.push("add_spacer|small|");
  lines.push("add_button|remove_multi_friends|Remove|noflags|0|0|");
  lines.push("add_button|block_multi_friends|Block / Unblock Trade|noflags|0|0|");
  lines.push("add_button|mute_multi_friends|Mute / Unmute|noflags|0|0|");
  lines.push("add_spacer|small|");
  if (!views.length) lines.push("add_textbox|`oYou currently have no friends.``|left|");
  views.forEach((v, i) => {
    lines.push(`add_checkbox|cf_${i}|${clean(v.name)}${v.mute ? " <Muted>" : ""}${v.blockTrade ? " <Trade Block>" : ""}|${selected.includes(v.userId) ? 1 : 0}|`);
  });
  lines.push("add_button|back|Back|noflags|0|0|");
  lines.push("end_dialog|all_friends|||");
  lines.push("add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

function openFriendInfo(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const account = session.account;
  const view = friendViews(ctx, account).find((v) => v.userId === userId);
  if (!view) return openFriends(ctx, session);
  session.lastFriendEdit = userId;
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`w${clean(view.name)}\`\`|left|${FRIEND_ICON}|`);
  lines.push("add_spacer|small|");
  if (view.online && account.showLocation !== false) {
    lines.push(`add_textbox|\`o${clean(view.name)} is \`2online\`\` now in the world \`5${view.world || "EXIT"}\`\`.|left|`);
  } else if (view.online) {
    lines.push(`add_textbox|\`o${clean(view.name)} is \`2online\`\` now, but has not made their location public to friends.|left|`);
  } else {
    lines.push(`add_textbox|\`o${clean(view.name)} is \`4offline\`\` (last seen ${timeAgo(view.lastSeen)} ago).|left|`);
  }
  lines.push("add_spacer|small|");
  lines.push(`embed_data|friendID|${userId}`);
  if (view.online && view.world) {
    // AstroVerse Info_Friend: `goto` warps straight to the friend's world.
    lines.push(`add_button|goto|Warp to \`5${view.world}\`\`|noflags|0|0|`);
  }
  if (view.mute) lines.push("add_button||`4Can't Send message``|disabled|0|0|");
  else lines.push("add_button|msg|`5Send message``|noflags|0|0|");
  lines.push(`add_button|mute|${view.mute ? "Un Mute Friend" : "Mute Friend"}|noflags|0|0|`);
  lines.push(`add_button|trade_block|${view.blockTrade ? "Enable Trade" : "Disable Trade"}|noflags|0|0|`);
  lines.push("add_spacer|small|");
  lines.push("add_button|remove|Remove as friend|noflags|0|0|");
  lines.push("add_button|back|Back|noflags|0|0|");
  lines.push("end_dialog|friends_edit|||");
  lines.push("add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

function openRemoveConfirm(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const view = friendViews(ctx, session.account).find((v) => v.userId === userId);
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`4Remove Friend\`\`|left|${FRIEND_ICON}|`,
    "add_spacer|small|",
    `add_textbox|\`oAre you sure you wish to \`4remove\`\` ${clean(view?.name || "this player")} as a friend?|left|`,
    "add_spacer|small|",
    "add_button|remove|`4Remove Friend``|noflags|0|0|",
    "add_button|back|Back|noflags|0|0|",
    "end_dialog|friends_remove|||",
    "add_quick_exit|",
  ];
  OnDialogRequest(session, lines.join("\n"));
}

/** Removes the friendship on both sides (AstroVerse remove_friend). */
function removeFriend(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const a = session.account;
  const b = findAccountById(ctx, userId);
  const oldA = a.friendIds, oldB = b?.friendIds;
  a.friendIds = (a.friendIds || []).filter((id) => id !== userId);
  if (b) b.friendIds = (b.friendIds || []).filter((id) => id !== a.userId);
  try {
    ctx.savePlayersNow();
  } catch (error) {
    a.friendIds = oldA;
    if (b) b.friendIds = oldB;
    throw error;
  }
}

/** AstroVerse `friend_add`: request first, second click accepts. */
export function addFriendRequest(ctx: ServerContext, session: PlayerSession, other: PlayerSession): void {
  const me = session.account;
  const them = other.account;
  if (me.friendIds?.includes(them.userId)) {
    OnTalkBubble(session, session.netId, "That's already my friend!", 0, true);
    return;
  }
  if (Math.abs(session.x - other.x) > 96 || Math.abs(session.y - other.y) > 96) {
    // AstroVerse: "`5[```4Too far away`` `0- Stand closer to`` X`0 first!```5]``"
    OnTalkBubble(session, session.netId, `\`5[\`\`\`4Too far away\`\` \`0- Stand closer to\`\` ${clean(them.name)}\`0 first!\`\`\`5]\`\``, 0, true);
    return;
  }
  // They already asked me -> mutual accept.
  if ((me.pendingFriendIds || []).includes(them.userId)) {
    if ((me.friendIds || []).length >= MAX_FRIENDS || (them.friendIds || []).length >= MAX_FRIENDS) {
      OnConsoleMessage(session, "`4Friend list full.``");
      return;
    }
    me.friendIds ??= [];
    them.friendIds ??= [];
    me.friendIds.push(them.userId);
    them.friendIds.push(me.userId);
    me.pendingFriendIds = (me.pendingFriendIds || []).filter((id) => id !== them.userId);
    them.pendingFriendIds = (them.pendingFriendIds || []).filter((id) => id !== me.userId);
    meta(me, them.userId); meta(them, me.userId);
    try {
      ctx.savePlayersNow();
    } catch (error) {
      me.friendIds = me.friendIds.filter((id) => id !== them.userId);
      them.friendIds = them.friendIds.filter((id) => id !== me.userId);
      throw error;
    }
    OnPlayPositioned(session, "audio/love_in.wav");
    OnPlayPositioned(other, "audio/love_in.wav");
    OnConsoleMessage(session, `\`3FRIEND ADDED:\`\` You're now friends with ${clean(them.name)}!`);
    OnConsoleMessage(other, `\`3FRIEND ADDED:\`\` You're now friends with ${clean(me.name)}!`);
    return;
  }
  // Otherwise send the request (AstroVerse pending_friends).
  them.pendingFriendIds ??= [];
  if (!them.pendingFriendIds.includes(me.userId)) them.pendingFriendIds.push(me.userId);
  ctx.savePlayersNow();
  OnTalkBubble(session, session.netId, `\`5[\`\`Friend request sent to ${clean(them.name)}\`5]\`\``, 0, true);
  OnPlayPositioned(other, "audio/tip_start.wav");
  OnConsoleMessage(other, `\`3FRIEND REQUEST:\`\` You've received a \`wfriend request\`\` from ${clean(me.name)}! To accept, press the \`wwrench by his/her name\`\` and then choose \`wAdd as friend\`\`.`);
}

/** AstroVerse ignore_player parity (Server/Dialog/dialog_return.h). */
export function ignorePlayer(ctx: ServerContext, session: PlayerSession, target: PlayerSession): void {
  const me = session.account;
  const them = target.account;
  if (me.userId === them.userId) {
    OnConsoleMessage(session, "`oDon't look now, but that person is `5IN YOUR HOUSE``!");
    return;
  }
  me.ignoredIds ??= [];
  if (me.ignoredIds.includes(them.userId)) {
    me.ignoredIds = me.ignoredIds.filter((id) => id !== them.userId);
    ctx.savePlayersNow();
    OnConsoleMessage(session, `You removed \`5${clean(them.name)}\`\` from ignore list!`);
    openFriends(ctx, session, true);
    return;
  }
  me.ignoredIds.push(them.userId);
  ctx.savePlayersNow();
  OnConsoleMessage(
    session,
    `\`4PERSON IGNORED!\`\` Ok, you won't see messages from \`5${clean(them.name)}\`\`. If you change your mind, you can remove him/her from ignore by using the \`5Friends List\`\`.`
  );
  openFriends(ctx, session, true);
}

function toggleMute(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const m = meta(session.account, userId);
  m.mute = !m.mute;
  ctx.savePlayersNow();
}

function toggleTradeBlock(ctx: ServerContext, session: PlayerSession, userId: number): void {
  const m = meta(session.account, userId);
  m.blockTrade = !m.blockTrade;
  ctx.savePlayersNow();
}

export function isMuted(account: PlayerAccount, fromUserId: number): boolean {
  return !!account.friendMeta?.[String(fromUserId)]?.mute;
}

export function isIgnored(account: PlayerAccount, fromUserId: number): boolean {
  return (account.ignoredIds || []).includes(fromUserId);
}

export function friendDialogReturn(ctx: ServerContext, s: PlayerSession, dlg: string, button: string, kv: Record<string, string> = {}): boolean {
  const account = s.account;
  const views = friendViews(ctx, account);
  const byIndex = (i: number): FriendView | undefined => views[i];

  if (dlg === "playerportal" && button === "socialportal") { openSocialPortal(ctx, s, "Social"); return true; }

  if (dlg === "socialportal" || dlg === "social_portal") {
    if (button === "showfriend") openFriends(ctx, s);
    return true;
  }

  if (dlg === "friends") {
    if (button === "back") { openSocialPortal(ctx, s, "Social"); return true; }
    if (button === "friend_all") { openFriends(ctx, s, true); return true; }
    if (button === "all_friends") { openEditFriends(ctx, s); return true; }
    if (button === "friends_options") { openFriendOptions(s); return true; }
    const edit = /^friend_(\d+)$/.exec(button);
    if (edit) { openFriendInfo(ctx, s, Number(edit[1])); return true; }
    const unignore = /^unignore_(\d+)$/.exec(button);
    if (unignore) {
      const id = Number(unignore[1]);
      account.ignoredIds = (account.ignoredIds || []).filter((x) => x !== id);
      ctx.savePlayersNow();
      openFriends(ctx, s, true);
      return true;
    }
    return true;
  }

  if (dlg === "friends_options") {
    if (kv.checkbox_public !== undefined) account.showLocation = kv.checkbox_public === "1";
    if (kv.checkbox_notifications !== undefined) account.showFriendNotifications = kv.checkbox_notifications === "1";
    if (button === "back" || !button) {
      ctx.savePlayersNow();
      openFriends(ctx, s, views.some((v) => v.online));
    }
    return true;
  }

  if (dlg === "friends_edit") {
    const friendId = Number(kv.friendID || kv.friendid || "");
    const id = Number.isSafeInteger(friendId) && friendId > 0 ? friendId : (s.lastFriendEdit || 0);
    if (button === "back") { openFriends(ctx, s); return true; }
    if (!id || !(account.friendIds || []).includes(id)) return true;
    const view = friendViews(ctx, account).find((v) => v.userId === id);
    const info = (uid: number): void => openFriendInfo(ctx, s, uid);
    if (button === "mute") { muteConfirmDialog(ctx, s, id, !!view?.mute, info); return true; }
    if (button === "trade_block") { tradeConfirmDialog(ctx, s, id, !!view?.blockTrade, info); return true; }
    if (button === "remove") { openRemoveConfirm(ctx, s, id); return true; }
    if (button === "msg") { composeMessage(ctx, s, id, info); return true; }
    if (button === "goto") { warpFriend(ctx, s, id); return true; }
    return true;
  }

  // AstroVerse `friends_message` (message compose opened from the friend dialog).
  if (dlg === "friends_message") {
    const id = Number(kv.friendID || kv.friendid || s.lastFriendEdit || 0);
    if (button === "back") { openFriendInfo(ctx, s, id); return true; }
    if (button === "send") {
      const body = (kv.text || "").replace(/[|\r\n\0]/g, " ").trim().slice(0, 120);
      sendPrivateMessage(ctx, s, id, body);
      openFriendInfo(ctx, s, id);
      return true;
    }
    return true;
  }

  // AstroVerse `mute_friend` / `block_friend` confirmations.
  if (dlg === "mute_friend") {
    const id = Number(kv.friendID || kv.friendid || s.lastFriendEdit || 0);
    if (button === "back") { openFriendInfo(ctx, s, id); return true; }
    if (button === "ok") { toggleMute(ctx, s, id); openFriendInfo(ctx, s, id); return true; }
    return true;
  }

  if (dlg === "block_friend") {
    const id = Number(kv.friendID || kv.friendid || s.lastFriendEdit || 0);
    if (button === "back") { openFriendInfo(ctx, s, id); return true; }
    if (button === "ok") { toggleTradeBlock(ctx, s, id); openFriendInfo(ctx, s, id); return true; }
    return true;
  }

  if (dlg === "friends_remove") {
    const id = Number(kv.friendID || kv.friendid || "");
    if (button === "back") { openFriends(ctx, s, views.some((v) => v.online)); return true; }
    if (button === "remove" && Number.isSafeInteger(id) && id > 0) {
      removeFriend(ctx, s, id);
      OnPlayPositioned(s, "audio/dialog_cancel.wav");
      openFriends(ctx, s, true);
    }
    return true;
  }

  if (dlg === "all_friends") {
    if (button === "back") {
      openFriends(ctx, s, views.some((v) => v.online));
      return true;
    }
    // AstroVerse collects every checked `cf_<index>` checkbox first.
    const picked: number[] = [];
    for (const [key, value] of Object.entries(kv)) {
      const m = /^cf_(\d+)$/.exec(key);
      if (!m || value !== "1") continue;
      const view = byIndex(Number(m[1]));
      if (view) picked.push(view.userId);
    }
    if (button === "remove_multi_friends" || button === "block_multi_friends" || button === "mute_multi_friends") {
      if (!picked.length) {
        OnDialogRequest(s, ["set_default_color|`o", `add_label_with_icon|big|\`wConfirm\`\`|left|${FRIEND_ICON}|`, "add_textbox|`oYou have not selected any friends|left|", "add_spacer|small|", "add_button|back|`wBack``|noflags|0|0|", "add_button|close|`wClose``|noflags|0|0|", "end_dialog|friends|||", "add_quick_exit|"].join("\n"));
        return true;
      }
      s.pendingFriendSelection = picked;
      const what = button === "mute_multi_friends" ? "mute" : button === "block_multi_friends" ? "block trade" : "remove";
      const targetDlg = button === "mute_multi_friends" ? "mute_all_friends" : button === "block_multi_friends" ? "block_all_friends" : "remove_all_friends";
      OnDialogRequest(s, [
        "set_default_color|`o",
        `add_label_with_icon|big|\`wConfirm\`\`|left|${FRIEND_ICON}|`,
        `add_textbox|\`oAre you sure you want to \`4${what}\`\` ${picked.length} friends?|left|`,
        "add_spacer|small|",
        "add_button|confirm|`wYes``|noflags|0|0|",
        "add_button|back|`wBack``|noflags|0|0|",
        "add_button|close|`wClose``|noflags|0|0|",
        `end_dialog|${targetDlg}|||`,
        "add_quick_exit|",
      ].join("\n"));
      return true;
    }
    return true;
  }

  if (dlg === "mute_all_friends" || dlg === "block_all_friends" || dlg === "remove_all_friends") {
    const picked = s.pendingFriendSelection || [];
    if (button === "back" || button === "close") { openEditFriends(ctx, s); return true; }
    if (button === "confirm") {
      for (const id of picked) {
        if (dlg === "mute_all_friends") toggleMute(ctx, s, id);
        else if (dlg === "block_all_friends") toggleTradeBlock(ctx, s, id);
        else removeFriend(ctx, s, id);
      }
      s.pendingFriendSelection = [];
      openEditFriends(ctx, s);
      return true;
    }
    return true;
  }

  return false;
}

// Backwards-compatible alias used by older call sites.
export function showFriendList(ctx: ServerContext, s: PlayerSession, all = false): void {
  openFriends(ctx, s, all);
}