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
  const typed = (parts[0] || "").toLowerCase();
  const names = ["help","?","rank","mods","level","achievements","hidestatus","msg","tell","w","trade","sb","bc","time","who","me","find","item","search","warp","world","worlds","news","gazette","middle","brb","afk","wave","dance","love","sleep","facepalm","fp","smh","yes","no","omg","idk","shrug","furious","rolleyes","foldarms","fa","stubborn","fold","dab","sassy","dance2","march","grumpy","shy","growid","register","skin","flag","door","weather","convert","youtube","yt","kick","pull","freeze","unfreeze","ban","worldban","unban","worldunban","uba","setlevel","givexp","kits","kit","gitem","clearinv","ghost","cheats","give","guestrank","mstate","smstate","daily","phone","locke","rules","discord","status","stats"];
  const aliases: Record<string,string> = {k:"kick",p:"pull",b:"ban",ub:"unban",u:"unban"};
  const candidates=names.filter(n=>n.startsWith(typed));
  const cmd=names.includes(typed) ? typed : aliases[typed] || (candidates.length===1?candidates[0]:typed);
  parts[0]=cmd;
  const argStr = parts.slice(1).join(" ");
  if (!cmd) return;
  if (handleProgressionCommand(ctx, session, cmd, parts)) return;
  if (cmd === "rank") { OnConsoleMessage(session, `Your rank: ${RANKS[rankOf(session.account)].label}.`); return; }
  if (cmd === "mods") {
    const staff = Array.from(ctx.sessions).filter(p=>hasPermission(p.account,"moderate"));
    OnConsoleMessage(session, staff.length ? `Online staff: ${staff.map(displayName).join(", ")}` : "No moderators are online."); return;
  }

  if (cmd === "help" || cmd === "?") {
    // Exact GTPS3 World.h:8136 command format
    const publicCommands = "/msg /status /broadcast /sb /cb /sdb /stats /top /ignore /time /who /me /radio /vips /mods /uba /r /go /rgo /pull /kick /ban /wave /dance /love /sleep /facepalm /fp /smh /yes /no /omg /idk /shrug /trade /pb /furious /rolleyes /unaccess /report /rate /foldarms /fa /stubborn /fold /fc /gc /gwarp /roles /warp /fav /home /sethome /gethome /dab /sassy /dance2 /favrm /grumpy /shy /discord /rules";
    const staff = hasPermission(session.account, "moderate") ? " /kick /pull /ban /unban" : "";
    const developer = hasPermission(session.account, "debug") ? " /setlevel /givexp /kits /gitem /clearinv /ghost /cheats /give /guestrank" : "";
    OnConsoleMessage(session, `\`o>> Commands: ${publicCommands}${staff}${developer}\`\``);
    return;
  }

  if (handlePlayerCommand(ctx, session, cmd, parts, argStr)) return;
  if (handleWorldCommand(ctx, session, cmd, argStr)) return;
  if (handleAdminCommand(ctx, session, cmd, parts, argStr)) return;

  OnConsoleMessage(session, "`4Unknown command.`` Enter `$/?`` for a list of valid commands.");
}
