import { handleProgressionCommand } from "../progression/commands";
import { displayName, rankOf, RANKS, hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import { handleAdminCommand } from "./admin_commands";
import { handlePlayerCommand } from "./player_commands";
import { handleWorldCommand } from "./world_commands";

export function dispatchCommand(
  ctx: ServerContext,
  session: PlayerSession,
  rawWithoutSlash: string
): void {
  const parts = rawWithoutSlash.trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const argStr = parts.slice(1).join(" ");
  if (!cmd) return;
  if (handleProgressionCommand(ctx, session, cmd, parts)) return;
  if (cmd === "rank") { OnConsoleMessage(session, `Your rank: ${RANKS[rankOf(session.account)].label}.`); return; }
  if (cmd === "mods") {
    const staff = Array.from(ctx.sessions).filter(p=>hasPermission(p.account,"moderate"));
    OnConsoleMessage(session, staff.length ? `Online staff: ${staff.map(displayName).join(", ")}` : "No moderators are online."); return;
  }

  if (cmd === "help" || cmd === "?") {
    const publicCommands = "/help /? /level /achievements /hidestatus /msg /tell /w /sb /bc /time /who /me /find /item /search /warp /world /news /gazette /middle /wave /dance /love /sleep /facepalm /fp /smh /yes /no /omg /idk /shrug /furious /rolleyes /foldarms /fa /stubborn /fold /dab /sassy /dance2 /march /grumpy /shy /growid /register /skin /flag /worlds /rank /mods /door /weather /convert /youtube /yt";
    const staff = hasPermission(session.account, "moderate") ? " /kick /pull /ban /unban" : "";
    const developer = hasPermission(session.account, "debug") ? " /setlevel /givexp /kits /gitem /clearinv /ghost /cheats /give" : "";
    OnConsoleMessage(session, `\`o>> Commands: ${publicCommands}${staff}${developer}\`\``);
    return;
  }

  if (handlePlayerCommand(ctx, session, cmd, parts, argStr)) return;
  if (handleWorldCommand(ctx, session, cmd, argStr)) return;
  if (handleAdminCommand(ctx, session, cmd, parts, argStr)) return;

  OnConsoleMessage(session, "`4Unknown command.`` Enter `$/?`` for a list of valid commands.");
}
