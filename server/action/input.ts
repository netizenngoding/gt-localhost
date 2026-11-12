import { makeTextPacket, NET_MESSAGE_GAME_MESSAGE } from "../proton/packet";
import { displayName } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { broadcastConsoleMessage, broadcastIconState, broadcastTalkBubble, chatPortrait } from "../onVariant";
import { sanitizeChatText } from "../tools/string";
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
    session.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, "action|log\nmsg|`6>>`4Spam detected! ``Please wait a bit before typing anything else.\n"), true);
    return;
  }

  if (trimmed.startsWith("/")) {
    // C++ reference echoes a command only to its author using action|log.
    // Strip protocol/control and formatting delimiters to prevent log spoofing.
    const echo = sanitizeChatText(trimmed, 120).replace(/[\x00-\x1f\x7f`]/g, "");
    session.peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, `action|log\nmsg|\`6${echo}\`\`\n`), true);
    dispatchCommand(ctx, session, trimmed.slice(1));
    return;
  }

  const world = session.world;
  if (!world) return;

  const clean = sanitizeChatText(trimmed, 120);
  if (!clean) return;
  if (session.brb || session.iconState === 1) {
    session.brb = false;
    broadcastIconState(world, session, 0, true);
  }
  // GTPS3 Source.cpp: 1/4 chance of a zombie prefix and green chat.
  const infected=activeMods(session.account).some(m=>m.id==='gtps3-infected');
  const msg=infected ? `\`2${Math.random()<0.25?'Brraaiinnss...':''}${clean}\`\`` : clean;

  // This pinned client renders C++ protocol prefixes literally in bubbles.
  broadcastTalkBubble(world, session.netId, msg, 0, false);
  broadcastConsoleMessage(
    world,
    `CP:0_PL:0_OID:_CT:[W]_ \`6<${displayName(session)}\`6>\`\` \`$${msg}\`\``,
    chatPortrait(session, ctx.itemsDb)
  );
}
