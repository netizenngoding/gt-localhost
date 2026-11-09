import { hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import {
  applySkinColorUpdate,
  broadcastTextOverlay,
  OnConsoleMessage,
  OnPlayPositioned,
  OnSetBux,
  OnTextOverlay,
} from "../onVariant";
import { rgbHexToGtSkinColor, sanitizeChatText, stripGtColors } from "../tools/string";
import { openItemFinderDialog } from "../action/dialog_return/find_item";
import { openCheatsMenu } from "../action/dialog_return/player_dialogs";
import { showGrowIdApplyModal } from "../action/growid";

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
    OnConsoleMessage(session, "`4This command is operator-only.``"); return true;
  }
  if (cmd === "find" || cmd === "item" || cmd === "search") {
    openItemFinderDialog(ctx, session, argStr);
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
      OnConsoleMessage(session, `\`4Starter kit cooldown: \`w${leftMin}m\`4 remaining.\`\``);
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
    OnConsoleMessage(session, "`2Starter kit + 1,000 Gems claimed!``");
    return true;
  }

  if (cmd === "gitem") {
    const id = parseInt(parts[1] || "0", 10);
    const qty = Math.max(1, Math.min(200, parseInt(parts[2] || "1", 10) || 1));
    const def = ctx.itemsDb.get(id);
    if (!def || def.name.startsWith("null_")) {
      OnConsoleMessage(session, "`4Usage: /gitem <item_id> [1-200]``");
      return true;
    }
    const added = ctx.giveInventoryItem(session, id, qty, true);
    OnConsoleMessage(
      session,
      added > 0
        ? `\`2Received \`w${added}x ${stripGtColors(def.name)}\`2 (#${def.id})!\`\``
        : "`4Backpack full or stack already at 200!``"
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
        ? "`2Inventory cleared (worn clothes, Fist & Wrench kept)!``"
        : "`2Inventory cleared!``"
    );
    return true;
  }

  if (cmd === "skin") {
    const m = argStr.trim().match(/^#?([0-9A-Fa-f]{6})$/);
    if (!m) {
      OnConsoleMessage(session, "`4Usage: /skin <RRGGBB>``");
      return true;
    }
    session.account.skinColor = rgbHexToGtSkinColor(m[1]);
    ctx.savePlayersNow();
    applySkinColorUpdate(session, session.world, true);
    OnConsoleMessage(session, "`2Skin color updated!``");
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
    session.cheats.noclip = !session.cheats.noclip;
    ctx.sendCharacterState(session);
    OnConsoleMessage(
      session,
      session.cheats.noclip
        ? "You can now walk through blocks (`2Ghost ON``)!"
        : "Ghost mode disabled (`4OFF``)."
    );
    return true;
  }

  if (cmd === "cheats") {
    openCheatsMenu(session);
    return true;
  }

  if (cmd === "msg" || cmd === "tell" || cmd === "w") {
    const targetName = parts[1] || "";
    const msgBody = sanitizeChatText(parts.slice(2).join(" "), 120);
    if (!targetName || !msgBody) {
      OnConsoleMessage(session, "`4Usage: /msg <player> <message>``");
      return true;
    }
    const target = ctx.findOnlineSessionByName(targetName);
    if (!target) {
      OnConsoleMessage(session, "`4Player is not online!``");
      return true;
    }
    OnConsoleMessage(
      target,
      `CP:0_PL:4_OID:_CT:[MSG]_ \`c>> From (\`w${session.account.name}\`c) in [\`$${session.world?.name || "LOBBY"}\`c] > \`$${msgBody}\`\``
    );
    OnPlayPositioned(target, "audio/beep.wav");
    OnConsoleMessage(session, `\`c>> Sent to (\`w${target.account.name}\`c): \`$${msgBody}\`\``);
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

  return false;
}
