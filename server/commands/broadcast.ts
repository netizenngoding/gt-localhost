// Broadcast system ported 1:1 from GTPS3 World.h (/sb /bc /cb /sdb /go /radio, SDB dialog return).
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { gtps3PlaymodTime } from "../playmods/service";
import { displayName, hasPermission } from "../ranks";
import { progression } from "../progression/service";
import { makeVariantPacket, makeTextPacket, NET_MESSAGE_GAME_MESSAGE } from "../proton/packet";
import { OnConsoleMessage, OnDialogRequest, OnSetBux, OnTalkBubble, OnTextOverlay } from "../onVariant";
import { sanitizeChatText } from "../tools/string";

const MEGAPHONE_ID = "gtps3-megaphone";
const MEGAPHONE_COOLDOWN_MS = 300_000;
const GROWTOKEN = 1486;

// GTPS3 globals lastsbworld / lastsdbworld.
let lastSbWorld = "";
let lastSdbWorld = "";

const setGems = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const isStaff = (s: PlayerSession): boolean => hasPermission(s.account, "moderate") || hasPermission(s.account, "debug");

function sendSfx(s: PlayerSession, file: string): void {
  s.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|play_sfx\nfile|${file}\ndelayMS|0`), true);
}

/** Seconds left on the megaphone cooldown (0 when the player may broadcast). */
function megaphoneLeft(s: PlayerSession): number {
  const mod = (s.account.playmods || []).find((m) => m.id === MEGAPHONE_ID && m.expiresAt > Date.now());
  return mod ? Math.max(0, Math.ceil((mod.expiresAt - Date.now()) / 1000)) : 0;
}

function addMegaphone(ctx: ServerContext, s: PlayerSession): void {
  s.account.playmods ??= [];
  s.account.playmods = s.account.playmods.filter((m) => m.id !== MEGAPHONE_ID);
  s.account.playmods.push({ id: MEGAPHONE_ID, expiresAt: Date.now() + MEGAPHONE_COOLDOWN_MS });
  ctx.dirty = true;
  sendSfx(s, "audio/dialog_confirm.wav");
  OnConsoleMessage(s, "Broadcasting to ALL! (`$Megaphone!`` mod added)");
}

function cooldownMessage(s: PlayerSession): void {
  s.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|log\nmsg|>> (${gtps3PlaymodTime(megaphoneLeft(s))}before you can broadcast again)\n`), true);
}

function sendUsageLog(s: PlayerSession, msg: string): void {
  s.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|log\nmsg|${msg}\n`), true);
}

function broadcastTo(ctx: ServerContext, packetFor: (s: PlayerSession) => void, limit = Infinity): void {
  let sent = 0;
  for (const p of ctx.sessions) {
    if (p.radio) continue;
    if (sent > limit) continue; // GTPS3: `sentto > 100` is checked before incrementing
    sent++;
    packetFor(p);
  }
}

const SDB_DIALOG =
  "set_default_color|`o\nadd_label_with_icon|big|`2Super Duper Broadcast|left|660|\nadd_textbox|Super Duper Broadcasts pop up a box with your message on every player's screen. The box even includes a button to visit your world! It costs 100 Growtokens to send.|left|\nadd_spacer|small|\nadd_smalltext|Enter up to 3 lines of text!|left|\nadd_text_input|sdb_1|||128|\nadd_text_input|sdb_2|||128|\nadd_text_input|sdb_3|||128||\nadd_spacer|small|\nend_dialog|sdbsend|Cancel|Send|";

export function handleBroadcastCommand(ctx: ServerContext, session: PlayerSession, cmd: string, argStr: string): boolean {
  if (cmd === "broadcast" || cmd === "bc" || cmd === "sb") {
    const isSb = cmd === "sb";
    if (!argStr) {
      if (isSb) {
        const online = ctx.sessions.size;
        sendUsageLog(session, `>> This lets you send a message to ${setGems(online)}\`\` random users online and make an annoying beep noise.  Costs \`$${setGems(online * 5)} Gems\`\` to use. Example:\`\` \`w/sb Hey guys, come to my world!`);
      } else {
        sendUsageLog(session, ">> This lets you send a message to `5100`` random users online.  Costs `$500 Gems`` to use.  Example:`` `w/broadcast Hey guys, come to my world!");
      }
      return true;
    }
    if (progression(session.account).level < 20) {
      OnConsoleMessage(session, " >> You must be level 20 to broadcast!");
      return true;
    }
    if (megaphoneLeft(session) > 0) {
      cooldownMessage(session);
      return true;
    }
    const cost = isSb ? ctx.sessions.size * 5 : 500;
    if ((session.account.gems || 0) < cost) {
      OnConsoleMessage(session, `>> You don't have \`$${setGems(cost)} Gems\`\`, you can't broadcast a message!`);
      return true;
    }
    session.account.gems -= cost;
    OnSetBux(session);
    addMegaphone(ctx, session);
    OnConsoleMessage(
      session,
      `\`#${isSb ? "Super-" : ""}Broadcast sent. Used \`$${setGems(cost)} Gems\`\`. (\`$${setGems(session.account.gems)}\`\` left)\`\` (5 mins before you can broadcast again)`
    );
    const text = sanitizeChatText(argStr, 120);
    const jammed = false; // no world jammers in this server
    const worldName = session.world?.name || "EXIT";
    if (!jammed && session.world) lastSbWorld = session.world.name;
    const color = isStaff(session) ? "`^" : "`$";
    const where = jammed ? "`4JAMMED!``" : worldName;
    const who = displayName(session); // already ends with "``"
    const line = isSb
      ? `CP:_PL:0_OID:_CT:[SB]_ \`5** from (\`0${who}\`\`\`5) in [\`\`\`$${where}\`\`\`5] ** : \`\`${color}${text}\`\``
      : `CP:_PL:0_OID:_CT:[BC]_ \`p** from (\`0${who}\`\`\`p) in [\`\`\`$${where}\`\`\`p] ** : \`\`${color}${text}\`\``;
    broadcastTo(ctx, (p) => OnConsoleMessage(p, line), isSb ? Infinity : 100);
    ctx.dirty = true;
    return true;
  }

  if (cmd === "cb") {
    OnConsoleMessage(session, "`5/cb`` allows you to broadcast to a specific # of people.  Usage: `5/cb <people to hit> <message>``.  It will max out at the current people online.  `5/cb <person count>`` with no other parms will show the cost to send to that many people.");
    return true;
  }

  if (cmd === "sdb") {
    OnDialogRequest(session, SDB_DIALOG);
    return true;
  }

  if (cmd === "radio") {
    session.radio = !session.radio;
    OnConsoleMessage(
      session,
      session.radio ? "Radio disabled, `4you now won't see`` public broadcasts." : "Radio enabled, `2you can now see`` public broadcasts."
    );
    return true;
  }

  if (cmd === "go") {
    if (!lastSbWorld || (session.world && lastSbWorld === session.world.name)) {
      OnTextOverlay(session, "Unable to track down the location of the last broadcast!");
      return true;
    }
    OnTextOverlay(session, `Moving to location of the last broadcast (\`2${lastSbWorld}\`\`) ...`);
    sendSfx(session, "audio/object_spawn.wav");
    ctx.joinWorld(session, lastSbWorld);
    return true;
  }

  return false;
}

/** Handles the sdbsend / sdbrespond dialog returns. Returns true when consumed. */
export function handleSdbDialogReturn(ctx: ServerContext, session: PlayerSession, dlg: string, kv: Record<string, string>): boolean {
  if (dlg === "sdbrespond") {
    if (lastSdbWorld) ctx.joinWorld(session, lastSdbWorld);
    return true;
  }
  if (dlg !== "sdbsend") return false;
  const lines = [1, 2, 3].map((i) => sanitizeChatText(kv[`sdb_${i}`] || "", 128).replace(/[\n\r]/g, " "));
  if (!lines.some((l) => l)) {
    OnTalkBubble(session, session.netId, "`5[`2I'm not wasting Growtokens on an empty broadcast!``]``", 0);
    return true;
  }
  if (megaphoneLeft(session) > 0) {
    cooldownMessage(session);
    return true;
  }
  if (!session.world) return true;
  if (!ctx.consumeInventoryItem(session, GROWTOKEN, 100)) return true;
  addMegaphone(ctx, session);
  const jammed = false;
  const who = displayName(session);
  const pkt = makeVariantPacket([
    "OnSDBroadcast",
    `${who}\n${jammed ? "`4JAMMED!``" : session.world.name}\n${lines[0]}\n${lines[1]}\n${lines[2]}`,
    { type: "i32", value: jammed ? 0 : 1 },
  ]);
  if (!jammed) {
    lastSdbWorld = session.world.name;
    lastSbWorld = session.world.name;
  }
  for (const p of ctx.sessions) {
    if (p.radio || !p.world) continue;
    p.peer.sendPacket(0, pkt, true);
  }
  return true;
}

