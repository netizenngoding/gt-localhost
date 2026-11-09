import { hasPermission, canModerate } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import { stripGtColors } from "../tools/string";

export function handleAdminCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[],
  argStr: string
): boolean {
  if (["mstate", "smstate"].includes(cmd) && !hasPermission(session.account, "debug")) {
    OnConsoleMessage(session, "Developer permission required."); return true;
  }
  if (cmd === "mstate") {
    session.mstate = Math.max(0, Math.min(255, parseInt(argStr || "0", 10) || 0));
    OnConsoleMessage(session, `\`2mstate set to \`w${session.mstate}\`\``);
    return true;
  }

  if (cmd === "smstate") {
    session.smstate = Math.max(0, Math.min(255, parseInt(argStr || "0", 10) || 0));
    OnConsoleMessage(session, `\`2smstate set to \`w${session.smstate}\`\``);
    return true;
  }

  if (cmd === "give" || cmd === "kick" || cmd === "pull" || cmd === "ban" || cmd === "unban") {
    if (!hasPermission(session.account, cmd === "give" ? "grantItems" : "moderate")) {
      OnConsoleMessage(session, "`4Moderators only!``");
      return true;
    }

    if (cmd === "unban") {
      const targetKey = (parts[1] || "").toLowerCase();
      const acct = ctx.accounts.get(targetKey);
      if (!acct) {
        OnConsoleMessage(session, "`4Account not found!``");
        return true;
      }
      if (!canModerate(session.account, acct)) { OnConsoleMessage(session, "Cannot moderate this rank."); return true; }
      acct.banned = false;
      ctx.savePlayersNow();
      OnConsoleMessage(session, `\`2Unbanned \`w${acct.name}\`2!\`\``);
      return true;
    }

    const target = ctx.findOnlineSessionByName(parts[1] || "");
    if (!target) {
      OnConsoleMessage(session, "`4Player not found!``");
      return true;
    }

    if (cmd === "give") {
      const id = parseInt(parts[2] || "0", 10);
      const qty = Math.max(1, Math.min(200, parseInt(parts[3] || "1", 10) || 1));
      const def = ctx.itemsDb.get(id);
      if (!def || def.name.startsWith("null_")) {
        OnConsoleMessage(session, "`4Invalid item ID!``");
        return true;
      }
      ctx.giveInventoryItem(target, id, qty, true);
      OnConsoleMessage(session, `\`2Gave \`w${qty}x ${stripGtColors(def.name)}\`2 to \`w${target.account.name}\`2!\`\``);
      OnConsoleMessage(target, `\`2\`w${session.account.name}\`2 gave you \`w${qty}x ${stripGtColors(def.name)}\`2!\`\``);
      return true;
    }

    if (!canModerate(session.account, target.account)) { OnConsoleMessage(session, "Cannot moderate this rank."); return true; }

    if (cmd === "kick") {
      target.peer.sendDisconnect();
      OnConsoleMessage(session, `\`2Kicked \`w${target.account.name}\`2!\`\``);
    } else if (cmd === "pull" && session.world) {
      ctx.moveToWorld(target, session.world, session.x, session.y);
      OnConsoleMessage(session, `\`2Pulled \`w${target.account.name}\`2!\`\``);
    } else if (cmd === "ban") {
      target.account.banned = true;
      ctx.savePlayersNow();
      target.peer.sendDisconnect();
      OnConsoleMessage(session, `\`2Banned \`w${target.account.name}\`2!\`\``);
    }
    return true;
  }

  return false;
}
