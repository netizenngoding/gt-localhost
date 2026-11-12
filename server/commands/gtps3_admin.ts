import { hasPermission, canModerate, modTagOff } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { generateFreshWorld } from "../database/world";
import { makeTextPacket, makeVariantPacket, NET_MESSAGE_GAME_MESSAGE } from "../proton/packet";
import { expireMods } from "../playmods/service";
import { isFrozen } from "../action/hazards";
import { toggleWearableItem } from "../gamePacket/item_activate";
import {
  OnConsoleMessage, OnTextOverlay, OnTalkBubble, OnDialogRequest, OnSetPos,
  broadcastConsoleMessage, broadcastNameChanged, broadcastSetPos, applySkinColorUpdate,
} from "../onVariant";
import { stripGtColors } from "../tools/string";

// GTPS3 flags that have no persistent column here: m_h (/hide) and the
// /kickall cooldown. Both are session-scoped, like pInfo() fields.
const hidden = new WeakSet<PlayerSession>();
const lastKickAll = new WeakMap<PlayerSession, number>();
const resetConfirm = new WeakMap<PlayerSession, number>();
export const isHiddenStaff = (s: PlayerSession): boolean => hidden.has(s);

const UNKNOWN = "`4Unknown command.`` Enter `$/?`` for a list of valid commands.";
const sfx = (s: PlayerSession, file: string) =>
  s.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|play_sfx\nfile|${file}\ndelayMS|0\n`), true);
const pname = (s: PlayerSession) => s.account.name;
const nameOf = (s: PlayerSession) => (hasPermission(s.account, "moderate") ? "`#" : "`0") + pname(s) + "``";

function inWorldTarget(session: PlayerSession, query: string): PlayerSession | undefined {
  const w = session.world;
  if (!w || !query) return undefined;
  const q = query.toLowerCase();
  const list = [...w.peers].filter(p => p !== session);
  return list.find(p => p.account.name.toLowerCase() === q)
    || list.find(p => p.account.name.toLowerCase().slice(0, 3) === q.slice(0, 3));
}

function controlsWorld(ctx: ServerContext, s: PlayerSession): boolean {
  const w = s.world;
  if (!w) return false;
  if (hasPermission(s.account, "debug") || w.ownerUserId === s.account.userId) return true;
  return w.tiles.some(t => [242, 1796, 7188, 11550].includes(t.fg) && t.extra?.kind === "lock" && t.extra.adminIds.includes(s.account.userId));
}

function resetWorld(ctx: ServerContext, session: PlayerSession): void {
  const w = session.world!;
  const fresh = generateFreshWorld(w.name);
  const peers = [...w.peers];
  w.tiles = fresh.tiles; w.objects = []; w.lastObjectUid = 0; w.weatherId = 0;
  w.ownerUserId = 0; w.worldBans = {}; w.nuked = false;
  w.bulletin = []; w.bulletinSettings = []; w.storageItems = []; w.cctvSettings = []; w.cctvLogs = [];
  w.spawnX = fresh.spawnX; w.spawnY = fresh.spawnY;
  ctx.dirty = true; ctx.savePersistentState();
  for (const p of peers) { const sp = ctx.findMainDoorPixel(w); ctx.moveToWorld(p, w, sp.x, sp.y); }
}

/**
 * GTPS3 World.h SendCmd moderator/developer chains. Returns true when handled.
 * Players without the required rank receive GTPS3's "unknown command" reply.
 */
export function handleGtps3Admin(ctx: ServerContext, session: PlayerSession, cmd: string, parts: string[], argStr: string): boolean {
  const mod = hasPermission(session.account, "moderate");
  const dev = hasPermission(session.account, "debug");
  const world = session.world;
  const deny = (): boolean => { OnConsoleMessage(session, UNKNOWN); return true; };

  switch (cmd) {
    case "invis": case "invis2": {
      if (!mod) return deny();
      sfx(session, "audio/dialog_confirm.wav");
      session.invis = !session.invis;
      OnConsoleMessage(session, session.invis ? "`oYou are now ninja, invisible at all." : "`oYou are once again visible to mortals.");
      const pkt = makeVariantPacket(["OnInvis", { type: "i32", value: session.invis ? 1 : 0 }], session.netId);
      for (const p of world ? world.peers : [session]) {
        p.peer.sendPacket(0, pkt, true);
        if (cmd === "invis2") sfx(p, "audio/already_used.wav");
      }
      ctx.sendCharacterState(session);
      return true;
    }
    case "hide": {
      if (!mod) return deny();
      if (hidden.has(session)) hidden.delete(session); else hidden.add(session);
      OnConsoleMessage(session, hidden.has(session)
        ? "`o>> You hide yourself from everyone (You `4won't`` be visible in /mods, /msg etc.)``"
        : "`o>> You un-hide yourself from everyone (You `2will`` be visible in /mods, /msg etc.)``");
      return true;
    }
    case "togglemods": {
      if (!mod) return deny();
      if (modTagOff.has(session)) modTagOff.delete(session); else modTagOff.add(session);
      OnConsoleMessage(session, modTagOff.has(session) ? "`o>> You removed your mod tag.``" : "`o>> You added your mod tag back.``");
      broadcastNameChanged(session);
      return true;
    }
    case "unequip": {
      if (!mod) return deny();
      OnConsoleMessage(session, "`o>> You used `2/unequip``");
      for (const slot of [...session.account.inventory]) {
        const def = ctx.itemsDb.get(slot.itemId);
        if (slot.equipped && slot.count > 0 && def?.isClothing) toggleWearableItem(ctx, session, slot.itemId);
      }
      return true;
    }
    case "trashall": {
      if (!dev) return deny();
      let recycled = "";
      for (const slot of [...session.account.inventory]) {
        if (slot.itemId === 18 || slot.itemId === 32 || slot.count <= 0) continue;
        const def = ctx.itemsDb.get(slot.itemId);
        if (!def) continue;
        const n = slot.count;
        if (ctx.consumeInventoryItem(session, slot.itemId, n, false, false)) recycled += `${n} \`w${def.name}\`\` trashed.\n`;
      }
      ctx.sendInventory(session); ctx.savePlayersNow();
      OnConsoleMessage(session, recycled);
      return true;
    }
    case "ridcheck": {
      if (!mod) return deny();
      const t = ctx.findOnlineSessionByName(argStr);
      if (t) OnConsoleMessage(session, `>> RID CHECK on player ${nameOf(t)} (${t.account.name}) -> ${t.account.deviceKey}`);
      return true;
    }
    case "warpto": {
      if (!mod) return deny();
      const t = ctx.findOnlineSessionByName(argStr);
      if (!t || t.invis) return true;
      if (!t.world) { OnTalkBubble(session, session.netId, "Hmm, this person isn't in a world right now.", 0, true); return true; }
      OnTextOverlay(session, `Moving to location of ${nameOf(t)} (\`2${t.world.name}\`\`) ...`);
      if (dev) ctx.moveToWorld(session, t.world, t.x, t.y); else ctx.joinWorld(session, t.world.name);
      return true;
    }
    case "summon": {
      if (!mod) return deny();
      const t = ctx.findOnlineSessionByName(argStr);
      if (!t || t.invis || !world) return true;
      OnTextOverlay(t, "You were summoned by a mod");
      OnTextOverlay(session, "Summoning...");
      ctx.moveToWorld(t, world, session.x, session.y);
      return true;
    }
    case "info": {
      if (!mod) return deny();
      const q = argStr.trim().toLowerCase();
      const acct = [...ctx.accounts.values()].find(a => a.name.toLowerCase() === q)
        || ctx.findOnlineSessionByName(argStr)?.account;
      if (!acct) { OnConsoleMessage(session, `\`4Oops: \`oPlayer \`w${argStr}\`o was not found.``); return true; }
      const online = [...ctx.sessions].find(s => s.account === acct);
      OnDialogRequest(session, [
        "set_default_color|`o",
        `add_label_with_icon|big|\`1Punish / View - ${acct.name}\`\`|left|732|`,
        "add_spacer|small|",
        `add_textbox|User ID: \`w${acct.userId}\`\` | Rank: \`w${acct.rank || "player"}\`\` | Gems: \`w${acct.gems}\`\`|left|`,
        `add_textbox|Status: ${online ? `\`2Online\`\` in \`w${online.world?.name ?? "(menu)"}\`\`` : "`4Offline``"} | Banned: \`w${acct.banned ? "yes" : "no"}\`\`|left|`,
        `add_textbox|Recent worlds: \`#${(acct.recentWorlds || []).slice(-8).reverse().join("``, `#") || "none"}\`\`|left|`,
        `add_textbox|RID: \`w${acct.deviceKey}\`\`|left|`,
        "add_quick_exit|",
        "end_dialog|info|Close||",
      ].join("\n"));
      return true;
    }
    case "freezeall": {
      if (!dev) return deny();
      if (!world) return true;
      OnConsoleMessage(session, "`o>> You used `2/freezeall``");
      for (const p of world.peers) {
        if (p === session || isFrozen(p)) continue;
        p.account.playmods ??= []; p.account.playmods.push({ id: "gtps3-2", expiresAt: Date.now() + 15000 });
        ctx.dirty = true; ctx.sendCharacterState(p); applySkinColorUpdate(p, false);
        OnConsoleMessage(p, "Your body has turned to ice. You can't move! (`$Frozen!`` mod added, `$15 seconds`` left)");
      }
      return true;
    }
    case "pullall": {
      if (!dev) return deny();
      if (!world) return true;
      for (const p of world.peers) {
        if (p === session || p.invis) continue;
        p.x = session.x; p.y = session.y;
        broadcastSetPos(world, p.netId, session.x, session.y);
        OnTextOverlay(p, `You were pulled by ${pname(session)}`);
      }
      return true;
    }
    case "kickall": {
      if (!world) return true;
      if (!mod && !controlsWorld(ctx, session)) { OnTextOverlay(session, "Can't `4kick``, is not in a locked area you control!"); return true; }
      const now = Date.now();
      if ((lastKickAll.get(session) ?? 0) + 600000 >= now && !dev) return true;
      lastKickAll.set(session, now);
      for (const p of [...world.peers]) {
        if (p === session || hasPermission(p.account, "debug")) continue;
        ctx.respawnPlayer(p, false);
        OnConsoleMessage(p, "`4(KICKALL ACTIVATED!)``");
      }
      OnConsoleMessage(session, "`4(KICKALL ACTIVATED!)``");
      return true;
    }
    case "banall": {
      if (!dev) return deny();
      if (!world) return true;
      world.worldBans ??= {};
      for (const p of [...world.peers]) {
        if (p === session || hasPermission(p.account, "debug")) continue;
        world.worldBans[String(p.account.userId)] = Date.now() + 3600000;
        const msg = `${nameOf(session)} \`4world bans\`\` ${nameOf(p)} from \`0${world.name}\`\`!`;
        OnConsoleMessage(p, msg); OnConsoleMessage(session, msg);
        sfx(p, "audio/repair.wav"); ctx.exitToWorldSelect(p);
      }
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "removedrop": {
      if (!dev) return deny();
      if (!world) return true;
      OnConsoleMessage(session, " >> Removed all dropped items.");
      ctx.removeAllDrops(world);
      return true;
    }
    case "fixworld": {
      if (!mod) return deny();
      if (!world) return true;
      OnConsoleMessage(session, " >> Fixed the world.");
      for (const [k, until] of Object.entries(world.worldBans || {})) if (until <= Date.now()) delete world.worldBans![k];
      if (world.ownerUserId && !ctx.findAccountByUserId(world.ownerUserId)) world.ownerUserId = 0;
      world.nuked = false;
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "resetworld": {
      if (!dev) return deny();
      if (!world) return true;
      const n = (resetConfirm.get(session) ?? 0) + 1;
      if (n === 1) {
        resetConfirm.set(session, 1);
        OnConsoleMessage(session, ` >> Type \`2/resetworld\`\` again to confirm the reset of the world \`#${world.name}\`\`.`);
      } else {
        resetConfirm.delete(session);
        OnTextOverlay(session, "Cleared the world...");
        resetWorld(ctx, session);
      }
      return true;
    }
    case "banworld": case "unbanworld": {
      if (!mod) return deny();
      if (!world) return true;
      if (!world.nuked) {
        world.nuked = true;
        const msg = `\`o>> \`4${world.name} \`4was nuked from orbit\`o. It's the only way to be sure. Play nice, everybody!`;
        for (const p of ctx.sessions) { sfx(p, "audio/bigboom.wav"); OnConsoleMessage(p, msg); }
        for (const p of [...world.peers]) if (!hasPermission(p.account, "moderate")) ctx.exitToWorldSelect(p);
      } else {
        world.nuked = false;
        OnConsoleMessage(session, "This world is once again available to everyone!");
      }
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "unmute": case "mute": case "ipcheck": case "1hit":
      return false;
    default:
      return false;
  }
}

/** Pre-checks for the world-owner moderation commands, using GTPS3's replies. */
export function gtps3ModerationGate(ctx: ServerContext, session: PlayerSession, cmd: string, parts: string[]): boolean {
  const world = session.world;
  if (!world) return false;
  const q = (parts[1] || "").toLowerCase();
  if (!q) return false;
  const self = session.account.name.toLowerCase() === q;
  if (cmd === "kick") {
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "Can't `4kick``, is not in a locked area you control!"); return true; }
    if (self) { OnConsoleMessage(session, "`oYou give yourself a solid boot to the backside. But what did that really accomplish?"); return true; }
  } else if (cmd === "pull") {
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "Can't `5pull``, that player is not standing in an area you control!"); return true; }
    if (self) { OnConsoleMessage(session, "`oOuch!"); return true; }
  } else if (cmd === "ban" || cmd === "worldban") {
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "Can't `4world ban``, is not in a world you control!"); return true; }
    if (self) { OnConsoleMessage(session, "`oYou are banned from banning yourself!"); return true; }
  } else return false;
  // Name-prefix lookup within the world, like GTPS3's first-3-letters match.
  const t = inWorldTarget(session, q);
  if (!t) { session.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|log\nmsg| \`4Oops: \`oThere is nobody currently in this world with a name starting with \`w${parts[1]}\`o.\n`), true); return true; }
  parts[1] = t.account.name;
  return false;
}

export { stripGtColors, expireMods, canModerate, OnSetPos, broadcastConsoleMessage };
