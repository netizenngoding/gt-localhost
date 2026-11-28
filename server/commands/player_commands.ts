import { loadavg } from "node:os";
import { requestTrade } from '../action/trade';
import { chatPortrait } from "../onVariant/OnConsoleMessage";
import { displayName, hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import { buildCharacterStateForSession, type PlayerSession } from "../database/peer";
import { makeSetCharacterStatePacket } from "../proton/packet";
import {
  applySkinColorUpdate,
  broadcastIconState,
  broadcastSetClothing,
  broadcastTextOverlay,
  OnConsoleMessage,
  OnDialogRequest,
  OnPlayPositioned,
  OnSetBux,
  OnTextOverlay,
} from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { handleRenderWorldCommand } from "../world/render_world";
import { rgbHexToGtSkinColor, sanitizeChatText, stripGtColors } from "../tools/string";
import { openItemFinderDialog } from "../action/dialog_return/find_item";
import { openCheatsMenu, openBackpackMenu } from "../action/dialog_return/player_dialogs";
import { progression } from "../progression/service";
import { togglePermanentMod } from "../playmods/service";
import { isHiddenStaff } from "../ranks/staff_hidden";
import { showGrowIdApplyModal } from "../action/growid";
import { sendLoginEventMessages } from "../action/enter_game";

const KIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STARTER_KIT: Array<[number, number]> = [
  [242, 5],   // World Lock
  [1796, 1],  // Diamond Lock
  [48, 1],    // Angel Wings
  [2, 200],   // Dirt
  [3, 50],    // Dirt Seed
];

export function handlePlayerCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[],
  argStr: string
): boolean {
  if (["gitem", "kit", "kits", "clearinv", "cheats", "ghost"].includes(cmd) && !hasPermission(session.account, "debug")) {
    OnConsoleMessage(session, `You need developer rank or higher to use /${cmd}.`); return true;
  }
  if (cmd === "find" || cmd === "item" || cmd === "search") {
    openItemFinderDialog(ctx, session, argStr);
    return true;
  }

  if (cmd === "trade") {
    const target=ctx.findOnlineSessionByName(parts[1]||'');
    if(!target || target.world!==session.world || !session.world)OnConsoleMessage(session,"That player is not in this world.");
    else requestTrade(ctx,session,target.netId);
    return true;
  }

  if (cmd === "growid" || cmd === "register") {
    if (!session.account.isGuest) {
      OnConsoleMessage(
        session,
        `\`2Your account is already upgraded to GrowID \`w${session.account.growId || session.account.name}\`2!\`\``
      );
    } else {
      showGrowIdApplyModal(session);
    }
    return true;
  }

  if (cmd === "kits" || cmd === "kit") {
    const now = Date.now();
    const acct = session.account;
    if (acct.lastKitClaim && now - acct.lastKitClaim < KIT_COOLDOWN_MS) {
      const leftMin = Math.ceil((KIT_COOLDOWN_MS - (now - acct.lastKitClaim)) / 60000);
      OnConsoleMessage(session, `Starter kit cooldown: ${leftMin}m remaining.`);
      return true;
    }
    for (const [id, qty] of STARTER_KIT) {
      ctx.giveInventoryItem(session, id, qty, true);
    }
    acct.gems += 1000;
    acct.lastKitClaim = now;
    ctx.savePlayersNow();
    OnSetBux(session);
    OnPlayPositioned(session, "audio/object_collect.wav");
    OnConsoleMessage(session, ">> Starter kit and 1,000 Gems claimed!");
    return true;
  }

  if (cmd === "gitem") {
    const id = parseInt(parts[1] || "0", 10);
    const qty = Math.max(1, Math.min(200, parseInt(parts[2] || "1", 10) || 1));
    const def = ctx.itemsDb.get(id);
    if (!def || def.name.startsWith("null_")) {
      OnConsoleMessage(session, "Usage: /gitem <item id> [1-200] - Gives you an item.");
      return true;
    }
    const added = ctx.giveInventoryItem(session, id, qty, true);
    OnConsoleMessage(
      session,
      added > 0
        ? `>> Received ${added}x ${stripGtColors(def.name)} (#${def.id}).`
        : ">> Backpack is full or that stack is already at 200."
    );
    return true;
  }

  if (cmd === "clearinv") {
    const keptEquipped = new Set<number>();
    session.account.inventory = session.account.inventory.filter((s) => {
      if (s.itemId === 18 || s.itemId === 32 || s.equipped) {
        if (s.equipped) keptEquipped.add(s.itemId);
        return true;
      }
      return false;
    });
    for (const baseId of [18, 32]) {
      if (!session.account.inventory.some((s) => s.itemId === baseId)) {
        session.account.inventory.push({ itemId: baseId, count: 1, equipped: false });
      }
    }
    ctx.savePlayersNow();
    ctx.sendInventory(session, true);
    OnConsoleMessage(
      session,
      keptEquipped.size > 0
        ? ">> Inventory cleared. Worn clothes, Fist and Wrench were kept."
        : ">> Inventory cleared."
    );
    return true;
  }

  if (cmd === "flag") {
    const cc = argStr.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(cc)) {
      OnConsoleMessage(session, "`4Usage: /flag <country_code> (e.g. /flag ID or /flag US)``");
      return true;
    }
    session.account.flag = cc.toLowerCase();
    ctx.savePlayersNow();
    if (session.world) {
      broadcastTextOverlay(
        session.world,
        `action|MagnoliaAppIWantANewFlag\nIWantTheFlagToBe|${cc}\nnetID|${session.netId}`
      );
    }
    OnConsoleMessage(session, `\`2Flag updated to \`w${cc}\`\`!`);
    return true;
  }

  if (cmd === "ghost") {
    // GTPS3 `/ghost` is the "Ghost in the Shell" playmod: state bit 0 plus the
    // -2450 shimmer skin. It is not a noclip cheat.
    const active = (session.account.playmods || []).some(
      (m) => m.id === "ghost-in-the-shell" && m.expiresAt > Date.now()
    );
    togglePermanentMod(ctx, session, "ghost-in-the-shell", !active);
    ctx.dirty = true;
    ctx.savePlayersNow();
    applySkinColorUpdate(session, false);
    ctx.sendCharacterState(session);
    if (session.world) {
      if (session.invis) {
        // Invisible accounts must never receive a full outfit broadcast: that
        // packet re-registers the body (purple ghost head included). Push the
        // cleared state mask instead so the avatar stays hidden.
        const statePkt = makeSetCharacterStatePacket(buildCharacterStateForSession(session, ctx.itemsDb));
        for (const p of session.world.peers) {
          if (p === session) continue;
          p.peer.sendPacket(0, statePkt, true);
        }
      } else {
        broadcastSetClothing(session.world, session, ctx.itemsDb, false);
      }
    }
    return true;
  }

  if (cmd === "cheats") {
    openCheatsMenu(session);
    return true;
  }

  if (cmd === "msg" || cmd === "tell" || cmd === "w" || cmd === "r") {
    // Mirrors GTPS3 World.h: /msg and /r share one handler; /r targets the last sender.
    const USAGE_MSG = "Usage: /msg <`$full or first part of a name``> <`$your message``> - This will send a private message to someone anywhere in the universe.  If you don't include a message, you can just see if he/she is online or not.";
    const USAGE_R = "Usage: /r <`$your message``> - This will send a private message to the last person who sent you a message. Use /msg to talk to somebody new!";
    let username: string;
    let msgBody: string;
    if (cmd === "r") {
      username = session.lastMsg || "";
      if (!argStr || !username) {
        OnConsoleMessage(session, USAGE_R);
        return true;
      }
      msgBody = sanitizeChatText(argStr, 120);
    } else {
      username = parts[1] || "";
      if (!username) {
        OnConsoleMessage(session, USAGE_MSG);
        return true;
      }
      msgBody = sanitizeChatText(parts.slice(2).join(" "), 120);
    }
    const lower = username.toLowerCase();
    const online = [...ctx.sessions];
    // GTPS3: exact name first, then a prefix match that needs at least 5 letters.
    // Hidden staff stay unreachable unless the sender is staff too.
    const reachable = hasPermission(session.account, "moderate")
      ? online
      : online.filter((p) => !isHiddenStaff(p));
    let target = reachable.find((p) => p.account.name.toLowerCase() === lower);
    if (!target && username.length >= 5) target = reachable.find((p) => p.account.name.toLowerCase().startsWith(lower));
    if (!target) {
      OnConsoleMessage(
        session,
        username.length < 5
          ? `\`6>> \`$${username}\`\` is not online right now (you need to enter at least 5 letters if you meant a longer name!).\`\``
          : `\`6>> No one online who has a name starting with \`$${username}\`\`.\`\``
      );
      return true;
    }
    const tname = target.account.name;
    if (!msgBody) {
      OnConsoleMessage(session, `\`6>> \`$${tname}\`\` is online now.\`\``);
      return true;
    }
    if (hasPermission(target.account, "moderate")) {
      OnConsoleMessage(session, `CT:[MSG]_\`6>> (Sent to \`$${tname}\`\`)\`\` (\`4Note: \`\`Message a mod \`4ONLY ONCE\`\` about an issue. Mods don't fix scams or replace items, they punish players who break the \`5/rules\`\`.  For issues related to account recovery or purchasing, contact support at \`5http://privategt.com\`\`)`);
    } else {
      OnConsoleMessage(session, `CT:[MSG]_\`6>> (Sent to \`$${tname}\`\`)\`\``);
    }
    target.lastMsg = session.account.name;
    target.lastMsgWorld = session.world?.name || "";
    OnConsoleMessage(
      target,
      `CP:0_PL:0_OID:_CT:[MSG]_>> \`c>> from (\`\`\`c\`w${session.account.name}\`\`\`\`\`c) in [\`$${session.world?.name || "EXIT"}\`\`] > \`\`\`$${msgBody}\`\``,
      chatPortrait(session, ctx.itemsDb)
    );
    OnPlayPositioned(target, "audio/pay_time.wav");
    return true;
  }

  if (cmd === "youtube" || cmd === "yt") {
    const rawArg = argStr.trim();
    let targetUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    if (rawArg) {
      if (/^https?:\/\//i.test(rawArg)) {
        targetUrl = rawArg;
      } else if (/^[A-Za-z0-9_-]{11}$/.test(rawArg)) {
        targetUrl = `https://www.youtube.com/watch?v=${rawArg}`;
      } else {
        targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rawArg)}`;
      }
    }
    OnTextOverlay(session, "`wOpening YouTube...``");
    ctx.sendCustomVariant(session, "OnSendPlayerToYoutube", targetUrl);
    OnConsoleMessage(session, `\`2Opening YouTube: \`w${targetUrl}\`\`...`);
    return true;
  }

  if (cmd === "brb" || cmd === "afk") {
    const world = session.world;
    if (!world) return true;
    const next = !session.brb;
    session.brb = next;
    broadcastIconState(world, session, next ? 2 : 0, true);
    OnConsoleMessage(session, next ? "`2BRB mode enabled.``" : "`2BRB mode disabled.``");
    return true;
  }

  if (cmd === "daily") {
    const now = Date.now();
    const acct = session.account;
    const cooldown = 24 * 60 * 60 * 1000;
    if (acct.lastDailyReward && now - acct.lastDailyReward < cooldown) {
      const leftHours = Math.ceil((cooldown - (now - acct.lastDailyReward)) / 3600000);
      OnConsoleMessage(session, `\`4Crazy Jim's Daily Quest: Come back in \`w${leftHours} hours\`4!\`\``);
      return true;
    }
    const rewardGems = 500;
    acct.gems = (acct.gems || 0) + rewardGems;
    acct.lastDailyReward = now;
    ctx.savePlayersNow();
    OnSetBux(session);
    OnPlayPositioned(session, "audio/level_up.wav");
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wCrazy Jim's Daily Quest``", 18)
      .addTextbox("`2Congratulations! You completed today's quest!``")
      .addTextbox(`Reward: \`2+${rewardGems} Gems\`\`!`)
      .addQuickExit()
      .endDialog("daily_reward", "Close", "");
    OnDialogRequest(session, dlg);
    OnConsoleMessage(session, `\`2[Daily Quest] Received \`w+${rewardGems} Gems\`2! Come back tomorrow for more.\`\``);
    return true;
  }

  if (cmd === "phone") {
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wTelephone Services``", 638)
      .addTextbox("`wWho would you like to call?``")
      .addButton("call_police", "`4Emergency (911)``")
      .addButton("call_locke", "`5Locke's Traveling Wagon``")
      .addButton("call_daily", "`2Crazy Jim's Daily Quests``")
      .addQuickExit()
      .endDialog("phone_dialog", "Hang Up", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  if (cmd === "locke") {
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wLocke's Traveling Wagon``", 1796)
      .addTextbox("`wWelcome to Locke's Traveling Wagon! Locke offers rare goods from distant lands.``")
      .addTextbox("`2Today's Special: \`wUltra Gem Pack\`\` (1 Diamond Lock for 100,000 Gems)!")
      .addButton("locke_trade", "`wTrade 1 DL for 100,000 Gems``")
      .addQuickExit()
      .endDialog("locke_dialog", "Close", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  if (cmd === "rules") {
    // Exact GTPS3 World.h:8152
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wHelp & Rules``", 18)
      .addSpacer("small")
      .addTextbox("`w`2World or Accounts`` may be deleted after long periods of inactivity if a world is not visited regularly. `2Item function and prices are subject to change`` at anytime and without warning as we are constantly trying to balance different aspects of the game.``")
      .addSpacer("small")
      .addTextbox("`wProtect your worlds and the items by using Doors, Locks, and Blocks wisely, `2never share your login credentials`` with anyone, and be aware of `2fake system messages and phishing websites``.``")
      .addSpacer("small")
      .addTextbox("`w`2Inappropriate behavior`` (profanity, racist, sexist or sexual content, abusive behavior, and bullying); any form of scam game such as Drop Game, Dirt Game, etc.; `2buying, selling, or trading GTPS accounts, items, or worlds`` for real money; `2purchase fraud``; and usage of `2third party software``, including, but not limited to, client-side manipulation, auto-clickers, speed hacks, clock manipulation, bots, macroing, and auto-farming, will be sanctioned and may result in a permanent suspension.``")
      .addSpacer("small")
      .addTextbox("`wTo report a world, type `2/report`` and exit the world immediately. To report a player, `2wrench and report`` them, or contact us directly. For any issues and questions you may have, please visit our discord server``")
      .addSpacer("small")
      .addQuickExit()
      .endDialog("rules_dialog", "OK", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  if (cmd === "renderworld") {
    handleRenderWorldCommand(session);
    return true;
  }

  if (cmd === "discord") {
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wDiscord``", 10568)
      .addSpacer("small")
      .addTextbox("`oVisit the Magnolia Discord page?``")
      .addSpacer("small")
      .addUrlButton("comment", "`wLaunch``", "https://discord.gg/magnolia", "Open Discord?", "noflags")
      .addQuickExit()
      .endDialog("discord_dialog", "", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  if (cmd === "status" || cmd === "stats") {
    const uptime = Math.floor(process.uptime());
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    const uptimeText = `${days > 0 ? `${days} days, ` : ""}${hours} hours, ${mins} mins, ${secs} secs`;
    OnConsoleMessage(session, `Server 1 - S1 Uptime: ${uptimeText}`);

    // Full server internals are staff-only. Players/VIPs only need uptime.
    if (hasPermission(session.account, "moderate")) {
      const activeWorlds = new Set([...ctx.sessions].map(s => s.world?.name).filter(Boolean)).size;
      const load = loadavg().map(n => n.toFixed(2)).join(" ");
      const rssMb = Math.round(process.memoryUsage().rss / 1048576);
      const now = new Date();
      const nextEvent = new Date(now);
      nextEvent.setHours(24, 0, 0, 0);
      const untilEvent = Math.max(0, nextEvent.getTime() - now.getTime());
      const eventMins = Math.floor(untilEvent / 60000);
      const eventSecs = Math.floor((untilEvent % 60000) / 1000);
      const cpuHits = [...ctx.worlds.values()]
        .sort((a, b) => b.peers.size - a.peers.size || b.objects.length - a.objects.length)
        .slice(0, 10)
        .map(w => `${w.name.toUpperCase()} used 1 (0)`)
        .join(" ");

      OnConsoleMessage(session, `Total players: ${ctx.accounts.size} local players on now: ${ctx.sessions.size} - Active worlds: ${ctx.worlds.size}`);
      OnConsoleMessage(session, `UserCountMapWrlds: ${activeWorlds}`);
      OnConsoleMessage(session, `Total NPCs: 0 Ghosts: 0 HGhosts: 0`);
      OnConsoleMessage(session, `Ratings buffered: 0 Worldmaints queued: 0 User maints queued: 0`);
      OnConsoleMessage(session, `World Balancing is Enabled - Local World Balancing is Enabled`);
      OnConsoleMessage(session, `Server Load: ${load} Mem data: ${rssMb}MB Clients: ${ctx.sessions.size} - Next event in ${eventMins} mins, ${eventSecs} secs`);
      OnConsoleMessage(session, `Game latency: 1 Total loop latency: 1`);
      OnConsoleMessage(session, `Biggest game latency since last /stats: 1 Biggest loop latency: 1 ms, avg: 1`);
      OnConsoleMessage(session, `Biggest CPU hits: ${cpuHits || "None"}`);
      OnConsoleMessage(session, `OnlineManager stats: Users tracked: ${ctx.accounts.size} Update Speed MS:10000 Users per check: 6000 Current last user: 0 Passcounter: ${ctx.nextUserId} Last row count:${ctx.sessions.size}`);
      OnConsoleMessage(session, `Worlds loaded since last check: 0 Worlds unloaded: 0 Saves: 0 Saves ignored: 0`);
      OnConsoleMessage(session, `World stats: Ghosts: 0 HGhosts: 0 Total NPCS: 0`);
      sendLoginEventMessages(session);
    }
    return true;
  }

  if (cmd === "home" || cmd === "gethome") {
    const home = session.account.homeWorld;
    if (!home) {
      OnConsoleMessage(session, "`4You don't have a home world yet. Enter one and type `2/sethome``4.``");
      return true;
    }
    if (cmd === "gethome") {
      OnConsoleMessage(session, `\`2Your home world is \`w${home}\`2.\`\``);
      return true;
    }
    OnConsoleMessage(session, `Magically warping to your home world \`5${home}\`\`...`);
    OnPlayPositioned(session, "audio/door_open.wav");
    ctx.joinWorld(session, home);
    return true;
  }

  if (cmd === "sethome") {
    const world = session.world;
    if (!world) {
      OnConsoleMessage(session, "`4Enter a world first.``");
      return true;
    }
    session.account.homeWorld = world.name;
    ctx.dirty = true;
    ctx.savePlayersNow();
    OnConsoleMessage(session, `\`2Your home world is now \`w${world.name}\`2.\`\``);
    return true;
  }

  if (cmd === "rgo") {
    // GTPS3: go to the world the last /msg was sent from.
    const dest = session.lastMsgWorld || "";
    if (dest && session.world && dest === session.world.name) {
      OnConsoleMessage(session, "You magically appear at the world you were already in.  Great job!");
      return true;
    }
    if (!dest) {
      OnTextOverlay(session, "Unable to track down the location of the last broadcast!");
      return true;
    }
    OnTextOverlay(session, `Moving to where \`w/${session.lastMsg}\`\` sent that last \`5/msg\`\` from... (\`2${dest}\`\`) ...`);
    OnPlayPositioned(session, "audio/object_spawn.wav");
    ctx.joinWorld(session, dest);
    return true;
  }

  if (cmd === "mods") {
    const staff = [...ctx.sessions].filter((p) => hasPermission(p.account, "moderate")).map((p) => displayName(p));
    OnConsoleMessage(
      session,
      staff.length ? `\`2Online staff:\`\` ${staff.join(", ")}` : "There are no staff members online right now."
    );
    return true;
  }

  if (cmd === "backpack" || cmd === "bp") {
    openBackpackMenu(ctx, session);
    return true;
  }

  if (cmd === "quests") {
    const p = progression(session.account);
    const placed = p.counters.blocks_placed || 0;
    const harvested = p.counters.trees_harvested || 0;
    const broken = p.counters.blocks_broken || 0;
    const dlg = [
      "add_label_with_icon|big|`wRole Quests``|left|982|",
      "add_spacer|small|",
      "add_textbox|`9Punch, Build, Grow, and more to track your Role Progress!``|left|",
      "add_spacer|small|",
      `add_smalltext|- Builder (Blocks Placed): \`w${placed}\`\`|left|`,
      `add_smalltext|- Farmer (Trees Harvested): \`w${harvested}\`\`|left|`,
      `add_smalltext|- Breaker (Blocks Broken): \`w${broken}\`\`|left|`,
      `add_smalltext|- Level: \`w${p.level}\`\`|left|`,
      "end_dialog|rolequestspage||Back|",
      "add_quick_exit|",
    ].join("\n");
    OnDialogRequest(session, dlg);
    return true;
  }

  return false;
}
