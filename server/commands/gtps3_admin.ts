import { hasPermission, canModerate, displayName, rankLevel } from "../ranks";
import { canSeePlayer } from "../ranks/visibility";
import { toggleHiddenStaff } from "../ranks/staff_hidden";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { generateFreshWorld } from "../database/world";
import { buildCharacterStateForSession } from "../database/peer";
import { togglePermanentMod } from "../playmods/service";
import { effectiveSkin } from "../playmods/model";
import { makeSetCharacterStatePacket, makeTextPacket, makeVariantPacket, makeParticleEffectPacket, makeItemRemovePacket, NET_MESSAGE_GAME_MESSAGE } from "../proton/packet";
import { expireMods } from "../playmods/service";
import { isFrozen } from "../action/hazards";
import { toggleWearableItem } from "../gamePacket/item_activate";
import {
  OnConsoleMessage, OnTextOverlay, OnTalkBubble, OnDialogRequest, OnSetPos,
  broadcastConsoleMessage, broadcastNameChanged, broadcastSetPos, applySkinColorUpdate,
  OnSpawn, buildSetClothingPacket, broadcastSetClothing,
} from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";

// GTPS3 flags that have no persistent column here: m_h (/hide) and the
// /kickall cooldown. Both are session-scoped, like pInfo() fields.
/** Staff account notes: /note adds, /notes lists. Kept for the server lifetime. */
const accountNotes = new Map<number, string[]>();
const lastKickAll = new WeakMap<PlayerSession, number>();
const resetConfirm = new WeakMap<PlayerSession, string>();
const modTagOff = new WeakSet<PlayerSession>();

const UNKNOWN = "`4Unknown command.`` Enter `$/?`` for a list of valid commands.";
const sfx = (s: PlayerSession, file: string) =>
  s.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|play_sfx\nfile|${file}\ndelayMS|0\n`), true);
const pname = (s: PlayerSession) => s.account.name;
const nameOf = (s: PlayerSession) => stripGtColors(displayName(s));

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

function resetWorld(ctx: ServerContext, session: PlayerSession, width: number, height: number): void {
  const w = session.world!;
  const fresh = generateFreshWorld(w.name, width, height);
  const peers = [...w.peers];
  w.width = fresh.width; w.height = fresh.height; w.tiles = fresh.tiles; w.objects = []; w.lastObjectUid = 0; w.weatherId = 0;
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
    case "invis": {
      if (!mod) return deny();
      sfx(session, "audio/dialog_confirm.wav");
      session.invis = !session.invis;
      const on = session.invis;
      // Active-playmod entry, like GTPS3's ninja stealth listing.
      togglePermanentMod(ctx, session, "invisibility", on);
      const epoch = (session.invisEpoch = (session.invisEpoch || 0) + 1);
      const targetNetId = session.netId;
      const removePkt = makeVariantPacket(["OnRemove", `netID|${targetNetId}\npId|${session.account.userId}\n`]);
      const invisFlag = makeVariantPacket(["OnInvis", { type: "i32", value: on ? 1 : 0 }], targetNetId);
      const valid = (): boolean =>
        session.invisEpoch === epoch && session.invis === on && session.netId === targetNetId && session.world === world;
      const after = (delay: number, fn: () => void): void => {
        const timer = setTimeout(() => {
          if (valid()) fn();
        }, delay);
        if (typeof timer.unref === "function") timer.unref();
      };
      const others = world ? [...world.peers].filter((p) => p !== session) : [];
      for (const p of others) p.peer.sendPacket(0, invisFlag, true);
      for (const p of others) p.peer.sendPacket(0, removePkt, true);

      // The avatar is registered again with `invis|1` so the netId survives and
      // OnTalkBubble still renders, but the client only hides what the state
      // mask tells it to: the mask and an empty outfit must be pushed to every
      // viewer explicitly (sendCharacterState is filtered for invisible
      // players, so it never reached them - that is why wings/tags reappeared).
      const statePkt = makeSetCharacterStatePacket(buildCharacterStateForSession(session, ctx.itemsDb));
      const blankClothing = makeVariantPacket(
        [
          "OnSetClothing",
          { type: "vec3", x: 0, y: 0, z: 0 },
          { type: "vec3", x: 0, y: 0, z: 0 },
          { type: "vec3", x: 0, y: 0, z: 0 },
          { type: "u32", value: 0 },
          { type: "vec3", x: 0, y: 0, z: 0 },
        ],
        targetNetId
      );
      after(120, () => {
        for (const p of others) {
          if (!world || p.world !== world) continue;
          OnSpawn(p, session, false);
          if (on) {
            // Invisible: strip the whole outfit and apply the invis state mask.
            p.peer.sendPacket(0, blankClothing, true);
            p.peer.sendPacket(0, statePkt, true);
            // Blank the name plate as well: the state mask hides the body but
            // the client keeps rendering the label.
            p.peer.sendPacket(0, makeVariantPacket(["OnNameChanged", ""], targetNetId), true);
          }
        }
        if (on) return;
        // Becoming visible again: restore the full outfit with the joiner's
        // proven retry window.
        const outfit = (): void => {
          for (const p of others) {
            if (!world || p.world !== world || !world.peers.has(p)) continue;
            p.peer.sendPacket(
              0,
              makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(session.account, !!session.invis) >>> 0 }], targetNetId),
              true
            );
            p.peer.sendPacket(0, buildSetClothingPacket(session, ctx.itemsDb, false), true);
            p.peer.sendPacket(0, statePkt, true);
            // Restore the name plate that invisibility blanked.
            p.peer.sendPacket(0, makeVariantPacket(["OnNameChanged", displayName(session)], targetNetId), true);
          }
        };
        for (const delay of [180, 1000, 3000]) after(delay, outfit);
      });
      ctx.sendCharacterState(session);
      // Own avatar: no ghost skin while invisible, otherwise the leftover head
      // keeps the -2450 tint.
      session.peer.sendPacket(0, buildSetClothingPacket(session, ctx.itemsDb, false), true);
      session.peer.sendPacket(
        0,
        makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(session.account, !!session.invis) >>> 0 }], session.netId),
        true
      );
      ctx.dirty = true;
      ctx.savePlayersNow();
      return true;
    }
    case "getpos": {
      if (!mod) return deny();
      const px = Math.round(session.x);
      const py = Math.round(session.y);
      OnConsoleMessage(
        session,
        ">> Position: " + px + ", " + py + " in " + (world ? world.name : "?") +
          " (tile " + Math.floor(session.x / 32) + ", " + Math.floor(session.y / 32) + ")."
      );
      return true;
    }
    case "note": {
      if (!mod) return deny();
      const bits = argStr.trim().split(/\s+/).filter(Boolean);
      const who = bits.shift() || "";
      const text = bits.join(" ").trim();
      if (!who || text.length < 3) {
        OnConsoleMessage(session, "Usage: /note `$<player name> <text>`o - Saves a private staff note on that account.");
        return true;
      }
      const target =
        ctx.findOnlineSessionByName(who) ??
        [...ctx.accounts.values()].find((a) => a.name.toLowerCase() === who.toLowerCase());
      if (!target) {
        OnConsoleMessage(session, who + " was not found.");
        return true;
      }
      const account = "account" in target ? target.account : target;
      const list = accountNotes.get(account.userId) || [];
      list.push(new Date().toISOString().slice(0, 16).replace("T", " ") + " by " + pname(session) + ": " + text);
      accountNotes.set(account.userId, list.slice(-50));
      OnConsoleMessage(session, ">> Note saved for " + account.name + ".");
      return true;
    }
    case "notes": {
      if (!mod) return deny();
      const who = argStr.trim();
      if (!who) {
        OnConsoleMessage(session, "Usage: /notes `$<player name>`o - Lists the staff notes saved on that account.");
        return true;
      }
      const target =
        ctx.findOnlineSessionByName(who) ??
        [...ctx.accounts.values()].find((a) => a.name.toLowerCase() === who.toLowerCase());
      if (!target) {
        OnConsoleMessage(session, who + " was not found.");
        return true;
      }
      const account = "account" in target ? target.account : target;
      const list = accountNotes.get(account.userId) || [];
      const body = list.length
        ? list.map((n) => "add_smalltext|`o" + n + "``|left|").join("\n")
        : "add_smalltext|`oNo account notes yet.``|left|";
      OnDialogRequest(
        session,
        [
          "set_default_color|`o",
          "add_label_with_icon|big|`w" + account.name + " - Notes``|left|6016|",
          "add_spacer|small|",
          body,
          "add_spacer|small|",
          "add_button||Close|noflags|0|0|",
          "add_quick_exit|",
          "end_dialog|staff_notes|||",
        ].join("\n")
      );
      return true;
    }
    case "hide": {
      if (!mod) return deny();
      const nowHidden = toggleHiddenStaff(session);
      OnConsoleMessage(session, nowHidden
        ? ">> You are now hidden from /mods, /msg and other player lists."
        : ">> You are visible to everyone again.");
      return true;
    }
    case "togglemods": {
      if (!mod) return deny();
      if (modTagOff.has(session)) modTagOff.delete(session); else modTagOff.add(session);
      OnConsoleMessage(session, modTagOff.has(session) ? ">> Your mod tag is now hidden." : ">> Your mod tag is visible again.");
      broadcastNameChanged(session);
      return true;
    }
    case "unequip": {
      if (!mod) return deny();
      OnConsoleMessage(session, ">> Removed all of your equipped clothing.");
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
        if (ctx.consumeInventoryItem(session, slot.itemId, n, false, false)) recycled += `${n} ${def.name} trashed.\n`;
      }
      ctx.sendInventory(session); ctx.savePlayersNow();
      OnConsoleMessage(session, recycled || ">> Nothing was trashed.");
      return true;
    }
    case "ridcheck": {
      if (!mod) return deny();
      if (!argStr) { OnConsoleMessage(session, "Usage: /ridcheck <user>  This tells you everyone who's using his/her device.  Very accurate."); return true; }
      const target = ctx.findOnlineSessionByName(argStr)?.account ?? ctx.accounts.get(argStr.toLowerCase());
      if (!target || !target.deviceKey) { OnConsoleMessage(session, "Account doesn't have a valid RID to check against. (size is 0)"); return true; }
      const matches = Array.from(ctx.accounts.values()).filter(a => a.deviceKey === target.deviceKey);
      OnConsoleMessage(session, `Accounts with the RID address of ${target.deviceKey}:`);
      OnConsoleMessage(session, `Found ${matches.length} matches:`);
      for (const a of matches) OnConsoleMessage(session, `ON: ${a.name} (GrowID: ${a.name}) (ID: ${a.userId}) RID: ${a.deviceKey}`);
      return true;
    }
    case "warpto": {
      if (!mod) return deny();
      if (!argStr.trim()) { OnConsoleMessage(session, "Usage: /warpto `$<player name>`o - Moves you to that player's world."); return true; }
      const t = ctx.findOnlineSessionByName(argStr);
      if (!t || t.invis) return true;
      if (!t.world) { OnTalkBubble(session, session.netId, "Hmm, this person isn't in a world right now.", 0, true); return true; }
      OnTextOverlay(session, `Moving to the location of ${nameOf(t)} (${t.world.name}) ...`);
      if (dev) ctx.moveToWorld(session, t.world, t.x, t.y); else ctx.joinWorld(session, t.world.name);
      return true;
    }
    case "summon": {
      if (!mod) return deny();
      if (!argStr.trim()) { OnConsoleMessage(session, "Usage: /summon `$<player name>`o - Brings that player to your world."); return true; }
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
      if (!acct) { OnConsoleMessage(session, "Usage: /info `$<player name>`o - Shows account, rank, status and device details."); return true; }
      const online = [...ctx.sessions].find(s => s.account === acct);
      const statusText = online ? ("`2Online`` in `w" + (online.world?.name ?? "(menu)") + "``") : "`4Offline``";
      const bannedText = acct.banned ? "yes" : "no";
      const recentText = (acct.recentWorlds || []).slice(-8).reverse().join("``, `#") || "none";
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`1Punish / View - " + acct.name + "``", 732)
        .addSpacer("small")
        .addTextbox("User ID: `w" + acct.userId + "`` | Rank: `w" + (acct.rank || "player") + "`` | Gems: `w" + acct.gems + "``")
        .addTextbox("Status: " + statusText + " | Banned: `w" + bannedText + "``")
        .addTextbox("Recent worlds: `#" + recentText + "``")
        .addTextbox("RID: `w" + acct.deviceKey + "``")
        .addQuickExit()
        .endDialog("info", "Close", "");
      OnDialogRequest(session, dlg);
      return true;
    }
    case "freezeall": {
      if (!dev) return deny();
      if (!world) return true;
      let frozen = 0;
      for (const p of world.peers) {
        if (p === session || isFrozen(p)) continue;
        p.account.playmods ??= []; p.account.playmods.push({ id: "gtps3-2", expiresAt: Date.now() + 15000 });
        ctx.dirty = true; ctx.sendCharacterState(p); applySkinColorUpdate(p, false);
        frozen++;
        OnConsoleMessage(p, "Your body has turned to ice. You can't move! (Frozen! mod added, 15 seconds left)");
      }
      OnConsoleMessage(session, `>> Froze ${frozen} player${frozen === 1 ? "" : "s"} for 15 seconds.`);
      return true;
    }
    case "pullall": {
      if (!dev) return deny();
      if (!world) return true;
      let pulled = 0;
      for (const p of world.peers) {
        if (p === session || p.invis) continue;
        p.x = session.x; p.y = session.y;
        broadcastSetPos(world, p.netId, session.x, session.y);
        OnTextOverlay(p, `You were pulled by ${pname(session)}.`);
        pulled++;
      }
      OnConsoleMessage(session, `>> Pulled ${pulled} player${pulled === 1 ? "" : "s"} to your position.`);
      return true;
    }
    case "kickall": {
      if (!world) return true;
      if (!mod && !controlsWorld(ctx, session)) { OnTextOverlay(session, "You cannot kick everybody here. This is not a locked area you control."); return true; }
      const now = Date.now();
      if ((lastKickAll.get(session) ?? 0) + 600000 >= now && !dev) return true;
      lastKickAll.set(session, now);
      let kicked = 0;
      for (const p of [...world.peers]) {
        if (p === session || hasPermission(p.account, "debug")) continue;
        ctx.respawnPlayer(p, false);
        OnConsoleMessage(p, "You were kicked from the world.");
        kicked++;
      }
      OnConsoleMessage(session, `>> Kicked ${kicked} player${kicked === 1 ? "" : "s"} from the world.`);
      return true;
    }
    case "banall": {
      if (!dev) return deny();
      if (!world) return true;
      world.worldBans ??= {};
      for (const p of [...world.peers]) {
        if (p === session || hasPermission(p.account, "debug")) continue;
        world.worldBans[String(p.account.userId)] = Date.now() + 3600000;
        const msg = `${nameOf(session)} world bans ${nameOf(p)} from ${world.name} for one hour!`;
        OnConsoleMessage(p, msg); OnConsoleMessage(session, msg);
        sfx(p, "audio/repair.wav"); ctx.exitToWorldSelect(p);
      }
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "removedrop": {
      if (!dev) return deny();
      if (!world) return true;
      const removed = world.objects.slice();
      world.objects = [];
      for (const drop of removed) {
        const rmPkt = makeItemRemovePacket(drop.uid);
        for (const p of world.peers) p.peer.sendPacket(0, rmPkt, true);
      }
      OnConsoleMessage(session, `>> Removed all ${removed.length} dropped items.`);
      ctx.dirty = true;
      return true;
    }
    case "magic": {
      if (!mod) return deny();
      if (!world) return true;
      OnConsoleMessage(session, "You cast a spell!");
      const casterX = session.x;
      const casterY = session.y;
      for (const viewer of world.peers) {
        for (let i = 0; i < 6; i++) {
          const delay = i * 300;
          for (let quadrant = 0; quadrant < 4; quadrant++) {
            const dirX = quadrant === 1 || quadrant === 2 ? 1 : -1;
            const dirY = quadrant >= 2 ? 1 : -1;
            const px = () => casterX + dirX * 15 * Math.floor(Math.random() * 6);
            const py = () => casterY + dirY * 15 * Math.floor(Math.random() * 6);
            if (Math.random() <= 0.75) viewer.peer.sendPacket(0, makeParticleEffectPacket(2, px(), py(), Math.floor(Math.random() * 6) + 1, delay), true);
            if (Math.random() <= 0.25) viewer.peer.sendPacket(0, makeParticleEffectPacket(3, px(), py(), Math.floor(Math.random() * 16), delay), true);
            viewer.peer.sendPacket(0, makeParticleEffectPacket(1, px(), py(), Math.floor(Math.random() * 4) + 1, delay), true);
          }
          sfx(viewer, "audio/magic.wav");
        }
      }
      return true;
    }
    case "fixworld": {
      if (!mod) return deny();
      if (!world) return true;
      OnConsoleMessage(session, ">> Fixed the world. Expired bans were cleared and the world is no longer nuked.");
      for (const [k, until] of Object.entries(world.worldBans || {})) if (until <= Date.now()) delete world.worldBans![k];
      if (world.ownerUserId && !ctx.findAccountByUserId(world.ownerUserId)) world.ownerUserId = 0;
      world.nuked = false;
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "resetworld": {
      if (!dev) return deny();
      if (!world) return true;
      const sizeX = Number(parts[1]), sizeY = Number(parts[2]);
      const valid = Number.isInteger(sizeX) && Number.isInteger(sizeY) && sizeX >= 1 && sizeY >= 1 && sizeX <= 1000 && sizeY <= 1000;
      if (!valid) { OnConsoleMessage(session, "Usage: /resetworld `$<sizeX> <sizeY>`o - Rebuilds this world at any size."); return true; }
      const key = `${sizeX} ${sizeY}`;
      if (resetConfirm.get(session) !== key) {
        resetConfirm.set(session, key);
        OnConsoleMessage(session, `>> Type \`$/resetworld ${key}\`o again to confirm the reset of the world \`$${world.name}\`o.`);
      } else {
        resetConfirm.delete(session);
        OnTextOverlay(session, "Cleared the world...");
        resetWorld(ctx, session, sizeX, sizeY);
      }
      return true;
    }
    case "banworld": case "unbanworld": {
      if (!mod) return deny();
      if (!world) return true;
      if (!world.nuked) {
        world.nuked = true;
        const msg = `>> ${world.name} was nuked from orbit. It's the only way to be sure. Play nice, everybody!`;
        for (const p of ctx.sessions) { sfx(p, "audio/bigboom.wav"); OnConsoleMessage(p, msg); }
        for (const p of [...world.peers]) if (!hasPermission(p.account, "moderate")) ctx.exitToWorldSelect(p);
      } else {
        world.nuked = false;
        OnConsoleMessage(session, "This world is once again available to everyone!");
      }
      ctx.dirty = true; ctx.savePersistentState();
      return true;
    }
    case "unmute": case "mute":
      if (!mod) return deny();
      OnConsoleMessage(session, `Usage: /${cmd} <player name> - ${cmd === "mute" ? "Silences a player's chat." : "Lets a player chat again."}  This command is not available on this server yet.`);
      return true;
    case "ipcheck":
      if (!mod) return deny();
      OnConsoleMessage(session, "Usage: /ipcheck <player name> - Shows every account sharing that player's IP address.  This command is not available on this server yet.");
      return true;
    case "1hit":
      if (!mod) return deny();
      OnConsoleMessage(session, "Usage: /1hit - Lets you break blocks in one punch.  This command is not available on this server yet.");
      return true;
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
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "You cannot kick here. This is not a locked area you control."); return true; }
    if (self) { OnConsoleMessage(session, "You give yourself a solid boot to the backside. But what did that really accomplish?"); return true; }
  } else if (cmd === "pull") {
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "You cannot pull here. That player is not standing in an area you control."); return true; }
    if (self) { OnConsoleMessage(session, "Ouch!"); return true; }
  } else if (cmd === "ban" || cmd === "worldban") {
    if (!controlsWorld(ctx, session) && !hasPermission(session.account, "moderate")) { OnTextOverlay(session, "You cannot world ban here. This is not a world you control."); return true; }
    if (self) { OnConsoleMessage(session, "You are banned from banning yourself!"); return true; }
  } else return false;
  // Name-prefix lookup within the world, like GTPS3's first-3-letters match.
  const t = inWorldTarget(session, q);
  if (!t) { OnConsoleMessage(session, `There is nobody currently in this world with a name starting with \`$${parts[1]}\`o.`); return true; }
  parts[1] = t.account.name;
  return false;
}

export { stripGtColors, expireMods, canModerate, OnSetPos, broadcastConsoleMessage };
