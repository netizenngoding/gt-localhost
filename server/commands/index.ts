import { handleProgressionCommand } from "../progression/commands";
import { displayName, hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import { handleAdminCommand } from "./admin_commands";
import { handlePlayerCommand } from "./player_commands";
import { handleWorldCommand } from "./world_commands";
import { handleBroadcastCommand } from "./broadcast";
import { handleRankCommand } from "./ranks_cmd";
import { handleGtps3Admin } from "./gtps3_admin";
import { handleGrowtopiaDevCommand, growtopiaHelpText, HELP_REQUIRED } from "./growtopia_dev";
import { canSeePlayer } from "../ranks/visibility";
import { isHiddenStaff } from "../ranks/staff_hidden";
import { handleSidebarCommand } from "../sidebar/service";
import { handleAuctionCommand } from "../auction/service";

const STAFF_ONLY: Record<string, "moderate" | "debug" | "setRanks" | "grantItems"> = {
  kick: "moderate", pull: "moderate", ban: "moderate", unban: "moderate", worldban: "moderate",
  worldunban: "moderate", uba: "moderate", freeze: "moderate", unfreeze: "moderate", invis: "moderate",
  nick: "moderate", ghost: "moderate", cheats: "moderate",
  setlevel: "debug", givexp: "debug", kits: "debug", kit: "debug", gitem: "debug", clearinv: "debug",
  give: "grantItems", rankreload: "setRanks", setrank: "setRanks",
  hide: "moderate", togglemods: "moderate", warpto: "moderate", summon: "moderate", info: "moderate",
  freezeall: "moderate", pullall: "moderate", kickall: "moderate", banall: "moderate",
  removedrop: "moderate", banworld: "moderate", unbanworld: "moderate", unmute: "moderate", mute: "moderate",
  ipcheck: "moderate", "1hit": "moderate", unequip: "moderate", ridcheck: "moderate",
  fixworld: "moderate", resetworld: "moderate", trashall: "debug", dropall: "debug", setbit: "debug", getpos: "moderate",
  note: "moderate", notes: "moderate", magic: "moderate",
  testmail: "debug", welcomemail: "debug",
};

export function dispatchCommand(
  ctx: ServerContext,
  session: PlayerSession,
  rawWithoutSlash: string
): void {
  const parts = rawWithoutSlash.trim().split(/\s+/);
  const typed = (parts[0] || "").toLowerCase();
  const names = ["help","?","rank","mods","level","achievements","hidestatus","msg","tell","w","r","rgo","trade","sb","bc","broadcast","cb","sdb","radio","go","time","who","me","find","item","search","warp","world","worlds","news","gazette","middle","brb","afk","wave","dance","love","sleep","facepalm","fp","smh","yes","no","omg","idk","shrug","furious","rolleyes","foldarms","fa","stubborn","fold","dab","sassy","dance2","march","grumpy","shy","growid","register","flag","door","weather","convert","youtube","yt","kick","pull","freeze","unfreeze","ban","worldban","unban","worldunban","uba","setlevel","givexp","kits","kit","gitem","clearinv","ghost","cheats","give","ranks","setrank","rankreload","quests","daily","phone","locke","rules","discord","status","stats","hide","togglemods","magic","unequip","trashall","ridcheck","warpto","summon","info","freezeall","pullall","kickall","banall","removedrop","fixworld","resetworld","banworld","unbanworld","unmute","mute","ipcheck","1hit","getpos","note","notes","troll","cheer","wink","shower","mad","lol","laugh","cry","sad","favrm","boot","setweather","renameworld","transferworld","mail","mailbox","dungeon","dungeons","scrolls","league","standings","dailyquest","crazyjim","sendmail","testmail","welcomemail","auction","modui","moderndialog"];
  const aliases: Record<string,string> = {k:"kick",p:"pull",b:"ban",ub:"unban",u:"unban"};
  const candidates=names.filter(n=>n.startsWith(typed));
  const cmd=names.includes(typed) ? typed : aliases[typed] || (candidates.length===1?candidates[0]:typed);
  parts[0]=cmd;
  const argStr = parts.slice(1).join(" ");
  if (!cmd) return;
  // Commands this account may not use behave exactly like unknown commands.
  const required = HELP_REQUIRED[cmd] ?? STAFF_ONLY[cmd];
  if (required && !hasPermission(session.account, required)) {
    OnConsoleMessage(session, "`4Unknown command.`o Enter /? for a list of valid commands.");
    return;
  }
  if (handleRankCommand(ctx, session, cmd, parts, argStr)) return;
  if (cmd === "mods") {
    const staff = Array.from(ctx.sessions).filter(p=>hasPermission(p.account,"moderate") && canSeePlayer(session, p) && !isHiddenStaff(p));
    OnConsoleMessage(session, staff.length ? `Online staff: ${staff.map(displayName).join(", ")}` : "No moderators are online."); return;
  }

  if (cmd === "help" || cmd === "?") {
    OnConsoleMessage(session, growtopiaHelpText(c => { const r = HELP_REQUIRED[c] ?? STAFF_ONLY[c]; return !r || hasPermission(session.account, r); }));
    return;
  }

  if (handleSidebarCommand(ctx, session, cmd, parts)) return;
  if (handleAuctionCommand(ctx, session, cmd, parts)) return;
  if (handleBroadcastCommand(ctx, session, cmd, argStr)) return;
  if (handleGtps3Admin(ctx, session, cmd, parts, argStr)) return;
  if (handlePlayerCommand(ctx, session, cmd, parts, argStr)) return;
  if (handleWorldCommand(ctx, session, cmd, argStr)) return;
  if (handleAdminCommand(ctx, session, cmd, parts, argStr)) return;

  if (handleGrowtopiaDevCommand(ctx, session, cmd, parts)) return;
  OnConsoleMessage(session, "`4Unknown command.`o Enter /? for a list of valid commands.");
}
