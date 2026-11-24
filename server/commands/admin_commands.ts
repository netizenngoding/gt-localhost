import {expireMods} from '../playmods/service';
import {isFrozen} from '../action/hazards';
import {applySkinColorUpdate} from '../onVariant';
import { worldModerate } from '../action/world-moderation';
import { hasPermission, canModerate } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { makeVariantPacket } from "../proton/packet";
import { OnConsoleMessage, broadcastNameChanged } from "../onVariant";
import { stripGtColors } from "../tools/string";

export function handleAdminCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[],
  argStr: string
): boolean {
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

  if (cmd === "nick") {
    if (!hasPermission(session.account, "moderate")) { OnConsoleMessage(session, "Moderator permission required."); return true; }
    const newNick = argStr.replace(/[|\r\n\0]/g, "").trim();
    if (!newNick || newNick.toLowerCase() === session.account.name.toLowerCase()) {
      session.account.nickname = undefined;
      OnConsoleMessage(session, `Your name changed back to ${session.account.name}`);
    } else {
      session.account.nickname = newNick.slice(0, 24);
      OnConsoleMessage(session, `Your name changed to ${session.account.nickname}`);
    }
    ctx.dirty = true;
    ctx.savePlayersNow();
    broadcastNameChanged(session);
    return true;
  }

  if (cmd === "invis") {
    if (!hasPermission(session.account, "moderate")) { OnConsoleMessage(session, "Moderator permission required."); return true; }
    const nextInvis = !session.invis;
    session.invis = nextInvis;
    OnConsoleMessage(session, nextInvis ? "`oYou are now ninja, invisible at all." : "`oYou are once again visible to mortals.");
    const pkt = makeVariantPacket(["OnInvis", { type: "i32", value: nextInvis ? 1 : 0 }], session.netId);
    if (session.world) {
      for (const p of session.world.peers) p.peer.sendPacket(0, pkt, true);
    } else {
      session.peer.sendPacket(0, pkt, true);
    }
    return true;
  }

  return false;
}
