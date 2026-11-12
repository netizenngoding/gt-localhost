import {expireMods} from '../playmods/service';
import {isFrozen} from '../action/hazards';
import {applySkinColorUpdate} from '../onVariant';
import { worldModerate } from '../action/world-moderation';
import { hasPermission, canModerate } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, broadcastNameChanged } from "../onVariant";
import { stripGtColors } from "../tools/string";

export function handleAdminCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[],
  argStr: string
): boolean {
  // Device IDs are client-controlled; guest ranks are online-session-only.
  if (cmd === "guestrank") {
    if (!hasPermission(session.account, "debug") || session.account.isGuest) { OnConsoleMessage(session, "Registered developer permission required."); return true; }
    const target = ctx.findOnlineSessionByName(parts[1] || "");
    const rank = parts[2];
    if (!target || !target.account.isGuest || !["player", "moderator", "developer"].includes(rank)) {
      OnConsoleMessage(session, "Usage: /guestrank <online guest> <player|moderator|developer>"); return true;
    }
    target.account.rank = rank as "player" | "moderator" | "developer";
    target.account.moderator = rank !== "player";
    ctx.sendCharacterState(target); broadcastNameChanged(target);
    OnConsoleMessage(target, `Temporary rank: ${rank}. It expires on disconnect.`);
    OnConsoleMessage(session, `Guest ${target.account.name} temporarily set to ${rank}.`);
    return true;
  }

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

  if (["kick","pull","ban","worldban","unban","worldunban","uba"].includes(cmd)) {
    const world=session.world;if(!world){OnConsoleMessage(session,"Enter a world first.");return true;}
    if (["unban","worldunban","uba"].includes(cmd)) {
      const allowed=world.ownerUserId===session.account.userId || hasPermission(session.account,"moderate") || world.tiles.some(t=>[242,1796,7188,11550].includes(t.fg) && t.extra?.kind==='lock' && t.extra.adminIds.includes(session.account.userId));
      if(!allowed){OnConsoleMessage(session,"You cannot manage this world.");return true;}
      const query=(parts[1]||'').toLowerCase();
      if (!query && cmd==='uba') { world.worldBans={};ctx.dirty=true;ctx.savePersistentState();OnConsoleMessage(session,"You've unbanned everybody from this world.");return true; }
      const exact=ctx.accounts.get(query), matches=[...ctx.accounts.values()].filter(a=>a.name.toLowerCase().startsWith(query));
      const acct=exact || (query && matches.length===1 ? matches[0] : undefined);if(!acct){OnConsoleMessage(session,"Player not found.");return true;}
      if(world.worldBans)delete world.worldBans[String(acct.userId)];ctx.dirty=true;ctx.savePersistentState();OnConsoleMessage(session,`${acct.name} is no longer world banned.`);return true;
    }
    const target=ctx.findOnlineSessionByName(parts[1]||'');
    if(!target||target.world!==world){OnConsoleMessage(session,"Player is not in this world.");return true;}
    worldModerate(ctx,session,target,cmd==='pull'?'pull':cmd==='kick'?'kick':'worldban');return true;
  }
  if (cmd === "freeze" || cmd === "unfreeze") {
    if(!hasPermission(session.account,"moderate")){OnConsoleMessage(session,"Moderator permission required.");return true;}
    const target=ctx.findOnlineSessionByName(parts[1]||"");
    if(!target || target.world!==session.world || !canModerate(session.account,target.account)){OnConsoleMessage(session,"Player not found or protected.");return true;}
    if(cmd==="freeze"){
      if(isFrozen(target)){OnConsoleMessage(session,"Player is frozen already.");return true;}
      target.account.playmods??=[];target.account.playmods.push({id:"gtps3-2",expiresAt:Date.now()+15000});ctx.dirty=true;
      ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
      OnConsoleMessage(target,"Your body has turned to ice. You can't move! (`$Frozen!`` mod added, `$15 seconds`` left)");
    }else{
      for(const mod of target.account.playmods||[])if(["gtps3-2","gtps3-3","gtps3-49"].includes(mod.id))mod.expiresAt=Date.now()-1;
      expireMods(ctx);
    }
    return true;
  }
  if (cmd === "give") {
    if(!hasPermission(session.account,"grantItems")){OnConsoleMessage(session,"Developer permission required.");return true;}
    const target=ctx.findOnlineSessionByName(parts[1]||'');if(!target){OnConsoleMessage(session,"Player not found.");return true;}
    const id=parseInt(parts[2]||'0',10), qty=Math.max(1,Math.min(200,parseInt(parts[3]||'1',10)||1)), def=ctx.itemsDb.get(id);
    if(!def||def.name.startsWith('null_')){OnConsoleMessage(session,"Invalid item ID.");return true;}
    const added=ctx.giveInventoryItem(target,id,qty,true);OnConsoleMessage(session,`Gave ${added}x ${stripGtColors(def.name)} to ${target.account.name}.`);return true;
  }

  return false;
}
