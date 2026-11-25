import { hasPermission } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import { broadcastSetCurrentWeather } from "../onVariant/OnSetCurrentWeather";
import { worldModerate } from "../action/world-moderation";
import { runWorldEdit } from "./world_edit";

/** Command list for /help, in Growtopia order. The `$ argument highlight is closed with `o. */
const GROWTOPIA_HELP_ITEMS = [
  "/msg",
  "/status",
  "/broadcast",
  "/sb",
  "/cb",
  "/sdb",
  "/stats",
  "/top",
  "/ignore",
  "/time",
  "/who",
  "/me",
  "/radio",
  "/mods",
  "/uba",
  "/r",
  "/go",
  "/rgo",
  "/pull",
  "/kick",
  "/ban",
  "/wave",
  "/dance",
  "/love",
  "/sleep",
  "/facepalm",
  "/fp",
  "/smh",
  "/yes",
  "/no",
  "/renderworld",
  "/omg",
  "/idk",
  "/shrug",
  "/trade",
  "/pb",
  "/furious",
  "/rolleyes",
  "/unaccess",
  "/report",
  "/rate",
  "/foldarms",
  "/fa",
  "/stubborn",
  "/fold",
  "/fc",
  "/secureaccount",
  "/gc",
  "/gwarp",
  "/guild",
  "/roles",
  "/warp",
  "/warpto",
  "/curse",
  "/tape",
  "/tapecurse",
  "/info",
  "/infoex",
  "/remove",
  "/find",
  "/nick",
  "/ipcheck",
  "/ridcheck",
  "/invis",
  "/magic",
  "/ghost",
  "/renameworld",
  "/banworld",
  "/boot",
  "/transferworld",
  "/give",
  "/age",
  "/selfage",
  "/edit",
  "/unsafeedit",
  "/setbit",
  "/setweather",
  "/resetworld `$<sizeX> <sizeY>`o",
  "/dropall",
  "/modbackpack",
  "/exportworld",
  "/importworld",
  "/relocateworld",
  "/fav",
  "/home",
  "/sethome",
  "/gethome",
  "/dab",
  "/sassy",
  "/dance2",
  "/favrm",
  "/grumpy",
  "/shy",
];

/** Permission needed to see a /help command and to run it. Commands not listed here are public. */
export const HELP_REQUIRED: Record<string, "moderate" | "debug" | "grantItems"> = {
  curse: "moderate", tape: "moderate", tapecurse: "moderate", boot: "moderate", banworld: "moderate",
  ipcheck: "moderate", ridcheck: "moderate", info: "moderate", warpto: "moderate", pull: "moderate", kick: "moderate", ban: "moderate", uba: "moderate",
  edit: "debug", unsafeedit: "debug", setbit: "debug", setweather: "debug", resetworld: "debug", dropall: "debug",
  modbackpack: "debug", exportworld: "debug", importworld: "debug", relocateworld: "debug", infoex: "debug", remove: "debug",
  transferworld: "debug", renameworld: "debug", age: "debug", selfage: "moderate", gwarp: "debug", roles: "debug", renderworld: "debug",
  give: "grantItems",
};

const GROWTOPIA_HELP_COMMANDS = new Set(GROWTOPIA_HELP_ITEMS.map(item => item.match(/^\/(\S+)/)![1]));

/** /help text listing only the commands the caller can see. */
export function growtopiaHelpText(visible: (cmd: string) => boolean): string {
  const items = GROWTOPIA_HELP_ITEMS.filter(item => visible(item.match(/^\/(\S+)/)![1]));
  return ">> Commands: " + items.join(" ");
}

const EDIT_USAGE = "Edit usage: /edit add 3 lava, or /edit replace 3 dirt or /edit addobject 3 <optional objectname> or /edit clear 5 (or `pclearobject`o for floating stuff).  Use /unsafeedit to work on locked areas too.";

const WORLD_ADMIN_LOCK_IDS = [242, 1796, 7188, 11550];

/** Owner, lock admin, or developer may run world-level commands. */
function controlsWorld(session: PlayerSession): boolean {
  const w = session.world;
  if (!w) return false;
  if (hasPermission(session.account, "debug") || w.ownerUserId === session.account.userId) return true;
  return w.tiles.some(t => WORLD_ADMIN_LOCK_IDS.includes(t.fg) && t.extra?.kind === "lock" && t.extra.adminIds.includes(session.account.userId));
}

/** Handles Growtopia dev commands that are not handled elsewhere. Returns true if handled. */
export function handleGrowtopiaDevCommand(ctx: ServerContext, session: PlayerSession, cmd: string, parts: string[]): boolean {
  const world = session.world;
  switch (cmd) {
    case "boot": {
      if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
      if (!controlsWorld(session) && !hasPermission(session.account, "moderate")) { OnConsoleMessage(session, "You cannot manage this world."); return true; }
      const target = ctx.findOnlineSessionByName(parts[1] || "");
      if (!target || target.world !== world) { OnConsoleMessage(session, "Usage: /boot `$<player name>`o - Kicks a player out of this world."); return true; }
      worldModerate(ctx, session, target, "kick");
      return true;
    }
    case "setweather": {
      if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
      if (!controlsWorld(session)) { OnConsoleMessage(session, "You cannot manage this world."); return true; }
      const id = Number(parts[1]);
      if (!Number.isSafeInteger(id) || id < 0 || id > 85) { OnConsoleMessage(session, "Usage: /setweather `$<0-85>`o - Changes the weather in this world."); return true; }
      broadcastSetCurrentWeather(world, id);
      ctx.dirty = true;
      OnConsoleMessage(session, `>> Weather changed to #${id}.`);
      return true;
    }
    case "renameworld": {
      if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
      if (!controlsWorld(session)) { OnConsoleMessage(session, "You cannot manage this world."); return true; }
      const name = (parts[1] || "").toUpperCase();
      if (!/^[A-Z0-9]{1,23}$/.test(name)) { OnConsoleMessage(session, "Usage: /renameworld `$<name>`o - Renames this world. Use 1-23 letters or numbers."); return true; }
      if (ctx.worlds.has(name)) { OnConsoleMessage(session, "A world with that name already exists."); return true; }
      ctx.worlds.delete(world.name.toUpperCase());
      world.name = name;
      ctx.worlds.set(name, world);
      ctx.dirty = true;
      OnConsoleMessage(session, `>> World renamed to ${name}.`);
      return true;
    }
    case "transferworld": {
      if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
      if (!controlsWorld(session)) { OnConsoleMessage(session, "You cannot manage this world."); return true; }
      const query = (parts[1] || "").toLowerCase();
      const acct = ctx.accounts.get(query) || ctx.findOnlineSessionByName(query)?.account;
      if (!acct) { OnConsoleMessage(session, "Usage: /transferworld `$<player name>`o - Gives this world to another player."); return true; }
      world.ownerUserId = acct.userId;
      ctx.dirty = true;
      OnConsoleMessage(session, `>> ${world.name} is now owned by ${acct.name}.`);
      return true;
    }
    case "edit":
    case "unsafeedit": {
      if (!world) { OnConsoleMessage(session, "Enter a world first."); return true; }
      if (!controlsWorld(session)) { OnConsoleMessage(session, "You cannot manage this world."); return true; }
      return runWorldEdit(ctx, session, cmd, parts, EDIT_USAGE);
    }
    case "dropall": {
      session.account.inventory = session.account.inventory.filter(s => s.itemId === 18 || s.itemId === 32 || s.equipped);
      ctx.sendInventory(session);
      ctx.savePlayersNow();
      OnConsoleMessage(session, ">> Removed all items.  You po again.");
      return true;
    }
    case "setbit": {
      const flags = ["nolocks", "immune", "norank", "noevents", "nogo"];
      if (!flags.includes((parts[1] || "").toLowerCase())) { OnConsoleMessage(session, "Bad flag.  Example: /setbit `$<nolocks, immune, norank, noevents, nogo>`o"); return true; }
      OnConsoleMessage(session, ">> /setbit is not available on this server yet.");
      return true;
    }
    default:
      break;
  }
  if (GROWTOPIA_HELP_COMMANDS.has(cmd)) {
    OnConsoleMessage(session, `>> /${cmd} is not available on this server yet.`);
    return true;
  }
  return false;
}


