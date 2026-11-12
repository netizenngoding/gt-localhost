import { chatPortrait } from "../onVariant/OnConsoleMessage";
import { displayName } from "../ranks";
import { worldDestination } from "../database/world-policy";
import { makeVariantPacket } from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { canModifyWorldTile } from "../database/world";
import {
  broadcastConsoleMessage,
  broadcastSetCurrentWeather,
  broadcastTalkBubble,
  OnConsoleMessage,
  OnTalkBubble,
  OnPlayPositioned,
  RequestGazette,
} from "../onVariant";
import { sanitizeChatText } from "../tools/string";
import { convertPlacedLock, openDoorSettingsDialog } from "../action/dialog_return/tile_edit";

export function handleWorldCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  argStr: string
): boolean {
  const world = session.world;

  if (cmd === "warp" || cmd === "world") {
    if (!argStr) {
      OnConsoleMessage(session, "`4Usage: /warp <world_name>``");
      return true;
    }
    const destination = worldDestination(argStr);
    if (destination.kind === "world") OnConsoleMessage(session, `Magically warping to world \`5${destination.name}\`\`...`);
    OnPlayPositioned(session, "audio/door_open.wav");
    ctx.joinWorld(session, argStr);
    return true;
  }

  if (cmd === "worlds") {
    const list = Array.from(ctx.worlds.values())
      .map((w) => `\`w${w.name}\`\` (${w.peers.size})`)
      .join(", ");
    OnConsoleMessage(session, `\`2Loaded Worlds:\`\` ${list}`);
    return true;
  }

  if (cmd === "who") {
    if (!world) return true;
    const names = Array.from(world.peers).map(displayName);
    const summary = `\`wWho's in \`$${world.name}\`\`: ${names.join(", ")}\`\``;
    for (const other of world.peers) {
      if (other !== session) OnTalkBubble(session, other.netId, displayName(other), 1);
    }
    OnConsoleMessage(session, summary);
    return true;
  }

  if (cmd === "me") {
    if (!world) return true;
    if (!argStr) { OnConsoleMessage(session, "Usage: /me <action>"); return true; }
    const msg = sanitizeChatText(argStr, 100);
    const action = `\`6<${displayName(session)} \`#${msg}\`\`\`6>\`\``;
    // C++ variants include player_chat=, but this client displays it literally.
    broadcastTalkBubble(world, session.netId, action, 0);
    broadcastConsoleMessage(world, `CP:0_PL:0_OID:_CT:[W]_ ${action}`, chatPortrait(session, ctx.itemsDb));
    return true;
  }

  if (cmd === "sb" || cmd === "bc") {
    if (!argStr) {
      OnConsoleMessage(session, "`4Usage: /sb <message>``");
      return true;
    }
    const clean = sanitizeChatText(argStr, 120);
    const originWorld = world ? world.name : "LOBBY";
    for (const p of ctx.sessions) {
      OnConsoleMessage(
        p,
        `CP:0_PL:4_OID:_CT:[SB]_ \`5** [\`w${session.account.name}\`5] in [\`$${originWorld}\`5] ** : \`#${clean}\`\``,
        chatPortrait(session, ctx.itemsDb)
      );
      OnPlayPositioned(p, "audio/beep.wav");
    }
    return true;
  }

  const emotes: Record<string, string> = {
    middle:"fuckyou", wave:"wave", dance:"dance", love:"love", sleep:"sleep", facepalm:"fp", fp:"fp",
    smh:"smh", yes:"yes", no:"no", omg:"omg", idk:"idk", shrug:"idk",
    furious:"furious", rolleyes:"rolleyes", foldarms:"fold", fa:"fold", stubborn:"fold",
    fold:"fold", dab:"dab", sassy:"sassy", dance2:"dance2", march:"march", grumpy:"grumpy", shy:"shy"
  };
  if (Object.hasOwn(emotes, cmd)) {
    if (world) {
      const packet = makeVariantPacket(["OnAction", "/" + emotes[cmd]], session.netId);
      for (const p of world.peers) p.peer.sendPacket(0, packet, true);
    }
    return true;
  }

  if (cmd === "time") {
    const formatted = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false, timeZoneName:"short"}).format(new Date());
    OnConsoleMessage(session, `\`2Growtopia Time: ${formatted}.\`\``);
    return true;
  }

  if (cmd === "news" || cmd === "gazette") {
    RequestGazette(session);
    return true;
  }

  if (cmd === "door") {
    if (!world) return true;
    const tx = Math.floor((session.x + 10) / 32);
    const ty = Math.floor((session.y + 15) / 32);
    const tile = world.tiles[ty * world.width + tx];
    if (tile && tile.extra?.kind === "door" && canModifyWorldTile(session, world, tile)) {
      openDoorSettingsDialog(session, tx, ty);
    } else {
      OnConsoleMessage(session, "`4Stand on a door you own to edit its destination!``");
    }
    return true;
  }

  if (cmd === "weather") {
    if (!world) return true;
    if (world.ownerUserId !== 0 && world.ownerUserId !== session.account.userId && session.account.rank !== "developer") {
      OnConsoleMessage(session, "`4Only the World Lock owner can change weather!``");
      return true;
    }
    const wId = Math.max(0, Math.min(85, parseInt(argStr || "0", 10) || 0));
    world.weatherId = wId;
    ctx.dirty = true;
    broadcastSetCurrentWeather(world, wId);
    OnConsoleMessage(session, `\`2Changed world weather to #${wId}!\`\``);
    return true;
  }

  if (cmd === "convert") {
    if (!world) return true;
    const tx = Math.floor((session.x + 10) / 32);
    const ty = Math.floor((session.y + 15) / 32);
    const tile = world.tiles[ty * world.width + tx];
    if (!tile || tile.extra?.kind !== "lock" || tile.extra.ownerUserId !== session.account.userId) {
      OnConsoleMessage(session, "`4Stand on a placed lock you own to cycle its tier!``");
      return true;
    }
    convertPlacedLock(ctx, session, world, tx, ty);
    return true;
  }

  return false;
}
