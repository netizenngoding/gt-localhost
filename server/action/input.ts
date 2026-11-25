import { getWorldLockTile } from "../database/world";
import { makeTextPacket, NET_MESSAGE_GAME_MESSAGE } from "../proton/packet";
import { chatColorOf, displayName, hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { broadcastIconState, chatPortrait, makeConsoleMessagePacket, OnConsoleMessage, OnTalkBubble } from "../onVariant";
import { makeVariantPacket } from "../proton/packet";
import { isIgnored, isMuted } from "./friends";
import { sanitizeChatText } from "../tools/string";
import { canSeeInvisChat } from "../ranks/visibility";
import { dispatchCommand } from "../commands";
import { activeMods } from "../playmods/model";

export function handleInput(
  ctx: ServerContext,
  session: PlayerSession,
  rawText: string
): void {
  const trimmed = rawText.trim().slice(0, 120);
  if (!trimmed) return;

  // Sliding window, scoped to the session: follows the reference's 5/5s
  // chat/command throttle without implying that accounts are auto-banned.
  const now = Date.now();
  const timestamps = (session.chatTimestamps || []).filter(t => now - t < 5000 && now >= t);
  timestamps.push(now);
  session.chatTimestamps = timestamps.slice(-5);
  if (timestamps.length >= 5) {
    OnConsoleMessage(session, "`6>>`4Spam detected! ``Please wait a bit before typing anything else.  Please note, any form of bot/macro/auto-paste will get all your accounts banned, so don't do it!");
    return;
  }

  if (trimmed.startsWith("/")) {
    // C++ reference echoes a command only to its author using action|log.
    // Strip protocol/control and formatting delimiters to prevent log spoofing.
    const echo = sanitizeChatText(trimmed, 120).replace(/[\x00-\x1f\x7f`]/g, "");
    session.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|log\nmsg|${/^\/(msg|r)(\s|$)/i.test(trimmed) ? "CT:[MSG]_ " : ""}\`6${echo}\`\`\n`), true);
    dispatchCommand(ctx, session, trimmed.slice(1));
    return;
  }

  const world = session.world;
  if (!world) return;

  if (world.royalSilence && world.ownerUserId !== session.account.userId && !hasPermission(session.account, "moderate")) {
    const wl = getWorldLockTile(world);
    const isAdmin = wl?.extra?.kind === "lock" && wl.extra.adminIds.includes(session.account.userId);
    if (!isAdmin) {
      OnTalkBubble(session, session.netId, "`4The Royal Owner has silenced peasants in this world!``", 0, true);
      return;
    }
  }

  const clean = sanitizeChatText(trimmed, 120);
  if (!clean) return;
  if (session.brb || session.iconState === 1) {
    session.brb = false;
    broadcastIconState(world, session, 0, true);
  }
  // GTPS3 Source.cpp: 1/4 chance of a zombie prefix and green chat.
  const infected=activeMods(session.account).some(m=>m.id==='gtps3-infected');
  const msg=infected ? `\`2${Math.random()<0.25?'Brraaiinnss...':''}${clean}\`\`` : clean;

  // Ignored or muted senders stay invisible to those viewers (AstroVerse ignore/mute).
  const bubble = makeVariantPacket([
    "OnTalkBubble",
    { type: "u32", value: session.netId >>> 0 },
    // Bubble colour comes from the rank (`w for player = white).
    `${chatColorOf(session.account)}${msg}\`\``,
    { type: "u32", value: 0 },
  ]);
  // GTPS3 console tint (World.h chat): player `$`, mod `^, developer `5.
  const consoleColor = hasPermission(session.account, "debug")
    ? "`5"
    : hasPermission(session.account, "moderate")
      ? "`^"
      : "`$";
  const consolePkt = makeConsoleMessagePacket(
    // displayName() already carries the rank prefix, so the name must not be
    // prefixed a second time before the bracket.
    `CP:0_PL:0_OID:_CT:[W]_ \`6<${displayName(session)}>` + `\`\` ${consoleColor}${msg}\`\``,
    chatPortrait(session, ctx.itemsDb)
  );
  for (const p of world.peers) {
    if (p !== session && (isIgnored(p.account, session.account.userId) || isMuted(p.account, session.account.userId))) continue;
    // Invisible staff chat is staff-only: same rank or higher only.
    if (!canSeeInvisChat(p, session)) continue;
    p.peer.sendPacket(0, bubble, true);
    p.peer.sendPacket(0, consolePkt, true);
  }
}
