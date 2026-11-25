import type { ServerContext } from "../database/context";
import type { PlayerAccount, PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest, broadcastNameChanged } from "../onVariant";
import { ALL_PERMISSIONS, allRanks, applyRank, canAssignRank, createRank, deleteRank, hasPermission, rankDef, rankExists, rankOf, reloadRanks, updateRank, type Permission } from "../ranks";

const PREFIX_FORBIDDEN = /[|\r\n\0]/g;
/** Huge Lock, the rank panel icon. */
const ROLE_ICON = 206;
/** The client drops a dialog sent in the same tick as a chat command. */
const DIALOG_DELAY_MS = 120;

const PERM_HELP: Record<Permission, string> = {
  moderate: "Kick, pull, ban and build anywhere.",
  grantItems: "Give items with /give.",
  debug: "Level, XP and developer tools.",
  setRanks: "Open this Roles panel.",
};

interface PanelState {
  filterRanks: string[];
  onlineOnly: boolean;
  search: string;
}

function fmtRank(id: string): string {
  const def = rankDef(id);
  return `${def.prefix}${def.label}\`\``;
}

/**
 * Every entry point of the rank panel re-checks this. A modified client can
 * call any dialog handler with any `buttonClicked`, so the permission no
 * longer relies on the buttons the panel happens to render.
 */
function mayManageRanks(session: PlayerSession): boolean {
  return hasPermission(session.account, "setRanks");
}

function actorLevel(session: PlayerSession): number {
  return rankDef(rankOf(session.account)).level;
}

/** A rank may only be handed out by somebody who outranks it. */
function mayAssign(actor: PlayerSession, target: PlayerAccount, rankId: string): boolean {
  if (!canAssignRank(actor.account, rankId)) return false;
  const targetLevel = rankDef(rankOf(target)).level;
  // Never let somebody demote or promote an account that outranks them.
  return target.userId === actor.account.userId || targetLevel < actorLevel(actor);
}

const CLEAN = (value: string | undefined): string => (value || "").replace(/[|\r\n\0]/g, "").trim();

function holderCount(ctx: ServerContext, rankId: string): number {
  return [...ctx.accounts.values()].filter((a) => rankOf(a) === rankId).length;
}

/* ------------------------------------------------------------------ *
 * Tab 1 — Roles home: one button per section.
 * ------------------------------------------------------------------ */
export function openRolesDialog(ctx: ServerContext, session: PlayerSession): void {
  if (!mayManageRanks(session)) return;
  const mine = rankDef(rankOf(session.account));
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`wRoles\`\`|left|${ROLE_ICON}|`);
  lines.push("add_smalltext|`oRanks decide a name colour, a chat colour and a set of powers. Pick a section below.|left|");
  lines.push("add_spacer|small|");
  lines.push(`add_textbox|\`wYou are ${mine.prefix}${mine.label}\`\` \`0(level ${mine.level})|left|`);
  lines.push(`add_textbox|\`wAccounts on this server: \`0${ctx.accounts.size}|left|`);
  lines.push("add_spacer|small|");
  lines.push(`add_button|role_tab_ranks|\`wRanks \`0(${allRanks().length})|noflags|0|0|`);
  lines.push("add_smalltext|`8Look at every rank and edit one.|left|");
  lines.push(`add_button|role_tab_players|\`wPlayers \`0(${ctx.sessions.size} online)|noflags|0|0|`);
  lines.push("add_smalltext|`8Find a player and change their rank.|left|");
  lines.push(`add_button|role_tab_create|\`wNew Rank|noflags|0|0|`);
  lines.push("add_smalltext|`8Build a new rank from scratch.|left|");
  lines.push("add_spacer|small|");
  lines.push("add_button||Close|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|roles|||");
  OnDialogRequest(session, lines.join("\n"), DIALOG_DELAY_MS);
}

/* ------------------------------------------------------------------ *
 * Tab 2 — Ranks: one row per rank, opens the editor.
 * ------------------------------------------------------------------ */
export function openRanksTab(ctx: ServerContext, session: PlayerSession): void {
  if (!mayManageRanks(session)) return;
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`wRanks\`\`|left|${ROLE_ICON}|`);
  lines.push("add_smalltext|`oClick a rank to change its colours, level or powers.|left|");
  lines.push("add_spacer|small|");
  for (const rank of allRanks()) {
    const def = rankDef(rank.id);
    const holders = holderCount(ctx, rank.id);
    lines.push(`add_button|role_open_${rank.id}|${def.prefix}${def.label}\`\` \`0- level ${def.level} - ${holders} player${holders === 1 ? "" : "s"}|noflags|0|0|`);
  }
  lines.push("add_spacer|small|");
  lines.push("add_button|role_back|Back|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|role_ranks|||");
  OnDialogRequest(session, lines.join("\n"));
}

/* ------------------------------------------------------------------ *
 * Tab 3 — Rank editor with the current values already filled in.
 * ------------------------------------------------------------------ */
export function openRankEditorDialog(ctx: ServerContext, session: PlayerSession, rankId: string): void {
  if (!mayManageRanks(session)) return;
  if (!rankExists(rankId) || rankDef(rankId).level > actorLevel(session)) return;
  const def = rankDef(rankId);
  const holders = holderCount(ctx, rankId);
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`w${def.label}\`\` |left|${ROLE_ICON}|`);
  lines.push(`add_smalltext|\`oRank id \`0${def.id}\`o - ${holders} player${holders === 1 ? "" : "s"} hold it. Saving updates them all.|left|`);
  lines.push("add_spacer|small|");
  lines.push("add_label_with_icon|small|`wAppearance|left|11550|");
  lines.push(`add_text_input|role_label|Label:|${def.label}|32|`);
  lines.push(`add_text_input|role_prefix|Name prefix:|${def.prefix}|8|`);
  lines.push(`add_text_input|role_color|Chat colour:|${def.chatColor}|8|`);
  lines.push("add_smalltext|`oThe name prefix sits in front of the player name, the chat colour paints their chat.|left|");
  lines.push("add_spacer|small|");
  lines.push("add_label_with_icon|small|`wLevel|left|18|");
  lines.push(`add_text_input|role_level|Level:|${def.level}|4|`);
  lines.push("add_smalltext|`oHigher level wins. A rank can never be given by someone below its level.|left|");
  lines.push("add_spacer|small|");
  lines.push("add_label_with_icon|small|`wPowers|left|242|");
  lines.push("add_smalltext|`oTick every power this rank should have.|left|");
  for (const perm of ALL_PERMISSIONS) {
    lines.push(`add_checkbox|perm_${perm}|` + "`w" + perm + "`0 - " + PERM_HELP[perm] + `|${def.permissions.includes(perm) ? 1 : 0}|`);
  }
  lines.push("add_spacer|small|");
  lines.push(`add_smalltext|` + "`wPreview: " + `${def.prefix}name\`\` \`0- ${def.chatColor}chat text\`\`|left|`);
  lines.push("add_spacer|small|");
  lines.push(`add_button|role_save_${rankId}|` + "`wSave Changes" + `|noflags|0|0|`);
  if (rankId !== "player" && rankId !== "owner") lines.push(`add_button|role_del_${rankId}|` + "`4Delete Rank" + `|noflags|0|0|`);
  lines.push("add_button|role_back|Back|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|role_rank|||");
  OnDialogRequest(session, lines.join("\n"));
}

/* ------------------------------------------------------------------ *
 * Tab 4 — Players: filters + result list.
 * ------------------------------------------------------------------ */
export function openPlayersTab(ctx: ServerContext, session: PlayerSession, state?: Partial<PanelState>): void {
  if (!mayManageRanks(session)) return;
  const current: PanelState = {
    filterRanks: state?.filterRanks ?? [],
    onlineOnly: state?.onlineOnly ?? false,
    search: state?.search ?? "",
  };
  const online = new Set([...ctx.sessions].map((s) => s.account.userId));
  const accounts = [...ctx.accounts.values()]
    .filter((a) => {
      if (current.onlineOnly && !online.has(a.userId)) return false;
      if (current.filterRanks.length && !current.filterRanks.includes(rankOf(a))) return false;
      const needle = current.search.trim().toLowerCase();
      return !needle || a.name.toLowerCase().includes(needle);
    })
    .sort((a, b) => (online.has(b.userId) ? 1 : 0) - (online.has(a.userId) ? 1 : 0) || a.name.localeCompare(b.name));

  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`wPlayers\`\`|left|18|`);
  lines.push("add_smalltext|`oTick any ranks to filter, then press Apply. Click a player to change their rank.|left|");
  lines.push("add_spacer|small|");
  lines.push(`add_checkbox|filter_online|` + "`wOnline players only" + `|${current.onlineOnly ? 1 : 0}|`);
  for (const rank of allRanks()) {
    const def = rankDef(rank.id);
    const holders = holderCount(ctx, rank.id);
    lines.push(`add_checkbox|filter_${rank.id}|${def.prefix}${def.label}\`\` \`0- ${holders} player${holders === 1 ? "" : "s"}|${current.filterRanks.includes(rank.id) ? 1 : 0}|`);
  }
  lines.push("add_text_input|role_search|Name contains:||24|");
  lines.push("add_button|role_apply_filter|`wApply Filter|noflags|0|0|");
  lines.push("add_spacer|small|");
  lines.push(`add_textbox|\`wResults \`0(${accounts.length})|left|`);
  for (const account of accounts.slice(0, 20)) {
    const def = rankDef(rankOf(account));
    const dot = online.has(account.userId) ? "`2●" : "`8●";
    lines.push(`add_button|role_player_${account.userId}|${dot} \`\`${account.name} \`8- ${def.prefix}${def.label}\`\`|noflags|0|0|`);
  }
  if (!accounts.length) lines.push("add_smalltext|`8No player matched those filters.|left|");
  if (accounts.length > 20) lines.push(`add_smalltext|\`8${accounts.length - 20} more hidden - narrow the filter.|left|`);
  lines.push("add_spacer|small|");
  lines.push("add_button|role_back|Back|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|role_players|||");
  OnDialogRequest(session, lines.join("\n"));
}

/* ------------------------------------------------------------------ *
 * Tab 5 — One player: single-choice rank list.
 * ------------------------------------------------------------------ */
export function openPlayerRoleDialog(ctx: ServerContext, session: PlayerSession, userId: number): void {
  if (!mayManageRanks(session)) return;
  const account = [...ctx.accounts.values()].find((a) => a.userId === userId);
  if (!account) {
    OnConsoleMessage(session, "That player could not be found.");
    return;
  }
  const currentDef = rankDef(rankOf(account));
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`w${account.name}\`\`|left|18|`);
  lines.push(`add_smalltext|\`oCurrently ${currentDef.prefix}${currentDef.label}\`\` \`0- level ${currentDef.level}. Tick one rank and press Apply.|left|`);
  lines.push("add_spacer|small|");
  lines.push("add_label_with_icon|small|`wGive a rank|left|206|");
  lines.push("max_checks|1|");
  for (const rank of allRanks()) {
    if (!canAssignRank(session.account, rank.id)) continue;
    const def = rankDef(rank.id);
    lines.push(`add_checkbox|give_${rank.id}|${def.prefix}${def.label}\`\` \`0- level ${def.level}|${rankOf(account) === rank.id ? 1 : 0}|`);
  }
  lines.push("add_smalltext|`0Only one rank can be ticked. Ticking another clears the previous one.|left|");
  lines.push("add_spacer|small|");
  lines.push(`embed_data|role_uid|${userId}`);
  lines.push("add_button|role_apply_give|`wApply|noflags|0|0|");
  lines.push("add_button|role_back|Back|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push(`end_dialog|role_player|||`);
  OnDialogRequest(session, lines.join("\n"));
}

/* ------------------------------------------------------------------ *
 * Tab 6 — Create a rank.
 * ------------------------------------------------------------------ */
export function openCreateRankDialog(session: PlayerSession): void {
  if (!mayManageRanks(session)) return;
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|big|\`wNew Rank\`\`|left|${ROLE_ICON}|`);
  lines.push("add_smalltext|`oRank ids use lowercase letters, digits or underscore. The id can never be changed later.|left|");
  lines.push("add_spacer|small|");
  lines.push("add_text_input|role_id|Rank id:||24|");
  lines.push("add_text_input|role_label|Label:||32|");
  lines.push("add_text_input|role_prefix|Name prefix:||8|");
  lines.push("add_text_input|role_color|Chat colour:||8|");
  lines.push("add_text_input|role_level|Level:||4|");
  lines.push("add_spacer|small|");
  lines.push("add_label_with_icon|small|`wPowers|left|242|");
  for (const perm of ALL_PERMISSIONS) {
    lines.push(`add_checkbox|perm_${perm}|` + "`w" + perm + "`0 - " + PERM_HELP[perm] + `|0|`);
  }
  lines.push("add_spacer|small|");
  lines.push("add_button|role_create_ok|`wCreate|noflags|0|0|");
  lines.push("add_button|role_back|Back|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|role_create|||");
  OnDialogRequest(session, lines.join("\n"));
}

function stateFrom(kv: Record<string, string>): PanelState {
  return {
    filterRanks: allRanks().map((r) => r.id).filter((id) => kv[`filter_${id}`] === "1"),
    onlineOnly: kv.filter_online === "1",
    search: kv.role_search || "",
  };
}

function checked(kv: Record<string, string>, prefix: string): string[] {
  return allRanks().map((r) => r.id).filter((id) => kv[`${prefix}${id}`] === "1");
}

function refreshRankHolders(ctx: ServerContext, rankId: string): void {
  for (const s of ctx.sessions) {
    if (rankOf(s.account) === rankId) {
      ctx.sendCharacterState(s);
      broadcastNameChanged(s);
    }
  }
}

/** Home/tab routing. */
export function handleRolesDialog(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_tab_ranks") {
    openRanksTab(ctx, session);
    return true;
  }
  if (btn === "role_tab_players") {
    openPlayersTab(ctx, session);
    return true;
  }
  if (btn === "role_tab_create") {
    openCreateRankDialog(session);
    return true;
  }
  return true;
}

export function handleRanksTab(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_back") {
    openRolesDialog(ctx, session);
    return true;
  }
  if (btn.startsWith("role_open_")) {
    openRankEditorDialog(ctx, session, btn.slice("role_open_".length));
    return true;
  }
  return true;
}

export function handlePlayersTab(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_back") {
    openRolesDialog(ctx, session);
    return true;
  }
  if (btn === "role_apply_filter") {
    openPlayersTab(ctx, session, stateFrom(kv));
    return true;
  }
  if (btn.startsWith("role_player_")) {
    openPlayerRoleDialog(ctx, session, Number(btn.slice("role_player_".length)));
    return true;
  }
  return true;
}

export function handleRankEditorDialog(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_back") {
    openRanksTab(ctx, session);
    return true;
  }
  if (btn.startsWith("role_save_")) {
    const id = btn.slice("role_save_".length);
    if (!rankExists(id)) return true;
    const mine = actorLevel(session);
    if (rankDef(id).level > mine) {
      OnConsoleMessage(session, "You cannot edit a rank above your own level.");
      openRanksTab(ctx, session);
      return true;
    }
    const patch: Record<string, unknown> = {};
    const label = CLEAN(kv.role_label);
    const prefix = CLEAN(kv.role_prefix);
    const color = CLEAN(kv.role_color);
    const level = CLEAN(kv.role_level);
    if (label) patch.label = label;
    if (prefix) patch.prefix = prefix;
    if (color) patch.chatColor = color;
    if (level && /^\d+$/.test(level)) patch.level = Math.min(mine, Number(level));
    // A rank can never be given a power its editor does not hold itself.
    patch.permissions = ALL_PERMISSIONS.filter((p: Permission) => kv[`$erm_${p}`] === "1" && hasPermission(session.account, p));
    const error = updateRank(id, patch);
    OnConsoleMessage(session, error ? `>> ${error}` : `>> Saved the ${id} rank.`);
    refreshRankHolders(ctx, id);
    openRanksTab(ctx, session);
    return true;
  }
  if (btn.startsWith("role_del_")) {
    const id = btn.slice("role_del_".length);
    if (!rankExists(id)) return true;
    if (rankDef(id).level >= actorLevel(session)) {
      OnConsoleMessage(session, "You cannot delete a rank at or above your own level.");
      openRanksTab(ctx, session);
      return true;
    }
    const error = deleteRank(id);
    OnConsoleMessage(session, error ? `>> ${error}` : `>> Deleted the ${id} rank.`);
    openRanksTab(ctx, session);
    return true;
  }
  return true;
}

export function handlePlayerRoleDialog(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_back") {
    openPlayersTab(ctx, session);
    return true;
  }
  if (btn !== "role_apply_give") return true;

  const userId = Number(kv.role_uid || 0);
  const picked = checked(kv, "give_");
  if (!Number.isSafeInteger(userId) || !picked.length) {
    openPlayerRoleDialog(ctx, session, userId);
    return true;
  }
  const rankId = picked.sort((a, b) => rankDef(b).level - rankDef(a).level)[0];
  const account = [...ctx.accounts.values()].find((a) => a.userId === userId);
  if (!account) return true;
  // Refuse anything the client was not entitled to send, whatever it clicked.
  if (!mayAssign(session, account, rankId)) {
    OnConsoleMessage(session, "You cannot give a rank at or above your own level.");
    openPlayerRoleDialog(ctx, session, userId);
    return true;
  }
  applyRank(account, rankId);
  ctx.dirty = true;
  ctx.savePlayersNow();
  const online = [...ctx.sessions].find((s) => s.account.userId === userId);
  if (online) {
    ctx.sendCharacterState(online);
    broadcastNameChanged(online);
    OnConsoleMessage(online, `Your role is now ${fmtRank(rankId)} (Level ${rankDef(rankId).level}).`);
  }
  OnConsoleMessage(session, `You gave ${account.name} the ${fmtRank(rankId)} role.`);
  openPlayerRoleDialog(ctx, session, userId);
  return true;
}

export function handleRoleManageDialog(ctx: ServerContext, session: PlayerSession, dlg: string, kv: Record<string, string>): boolean {
  if (!mayManageRanks(session)) return true;
  const btn = (kv.buttonClicked || "").trim();
  if (btn === "role_back") {
    openRanksTab(ctx, session);
    return true;
  }
  if (dlg !== "role_create" || btn !== "role_create_ok") return true;
  const id = (kv.role_id || "").toLowerCase().trim();
  const mine = actorLevel(session);
  const requested = /^d+$/.test((kv.role_level || "").trim()) ? Number(kv.role_level) : 0;
  // A new rank can never outrank the account that creates it, and it can only
  // receive powers its creator already holds.
  const level = Math.min(mine, Math.max(0, requested));
  const prefix = CLEAN(kv.role_prefix) || "`w";
  const color = CLEAN(kv.role_color) || prefix;
  const label = CLEAN(kv.role_label) || id;
  const permissions = ALL_PERMISSIONS.filter((p: Permission) => kv[`$erm_${p}`] === "1" && hasPermission(session.account, p));
  const error = createRank({ id, label, level, prefix, chatColor: color, permissions });
  OnConsoleMessage(session, error ? `>> ${error}` : `>> Created the ${prefix}${label} rank (id ${id}, level ${level}).`);
  openRanksTab(ctx, session);
  return true;
}

/** /ranks and /rank only; everybody else gets the plain unknown-command reply. */
export function handleRankCommand(ctx: ServerContext, session: PlayerSession, cmd: string, parts: string[], _argStr: string): boolean {
  if (cmd === "ranks" || cmd === "rank") {
    if (!mayManageRanks(session)) return false;
    openRolesDialog(ctx, session);
    return true;
  }
  if (cmd === "setrank") {
    if (!mayManageRanks(session)) return false;
    const targetName = parts[1] || "";
    const rankId = (parts[2] || "").toLowerCase();
    const onlineTarget = ctx.findOnlineSessionByName(targetName);
    const account = onlineTarget?.account ?? ctx.accounts.get(targetName.toLowerCase());
    if (!targetName || !rankId || !rankExists(rankId) || !account) {
      OnConsoleMessage(session, "Usage: /setrank `$<player name> <rank id>`o - Gives a player one of the ranks in /ranks.");
      return true;
    }
    if (!mayAssign(session, account, rankId)) {
      OnConsoleMessage(session, "You cannot give a rank at or above your own level.");
      return true;
    }
    applyRank(account, rankId);
    ctx.dirty = true;
    ctx.savePlayersNow();
    const online = onlineTarget ?? [...ctx.sessions].find((s) => s.account === account);
    if (online) {
      ctx.sendCharacterState(online);
      broadcastNameChanged(online);
      OnConsoleMessage(online, `Your role is now ${fmtRank(rankId)} (Level ${rankDef(rankId).level}).`);
    }
    OnConsoleMessage(session, `You gave ${account.name} the ${fmtRank(rankId)} role.`);
    return true;
  }
  if (cmd === "rankreload") {
    if (!mayManageRanks(session)) return false;
    const count = reloadRanks(ctx.rootDir);
    for (const s of ctx.sessions) {
      ctx.sendCharacterState(s);
      broadcastNameChanged(s);
    }
    OnConsoleMessage(session, `>> Reloaded ${count} ranks.`);
    return true;
  }
  return false;
}
