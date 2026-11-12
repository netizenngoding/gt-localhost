import {makeParticleEffectPacket} from '../proton/packet';
import {hasPermission,canModerate} from '../ranks';
import type {PlayerSession} from '../database/peer';
import type {WorldInstance} from '../database/world';
import type {ServerContext} from '../database/context';
import {OnConsoleMessage,broadcastConsoleMessage,OnPlayPositioned,broadcastSetPos,broadcastPositionedSfx,OnTextOverlay} from '../onVariant';
export function canWorldAct(s:PlayerSession,t:PlayerSession,w:WorldInstance):boolean {
 if(s===t || t.world!==w || s.world!==w)return false;
 if(w.ownerUserId===s.account.userId)return true;
 if(hasPermission(s.account,'moderate'))return canModerate(s.account,t.account);
 if(hasPermission(t.account,'moderate'))return false;
 const lock=w.tiles.find(x=>[242,1796,7188,11550].includes(x.fg)&&x.extra?.kind==='lock');
 return !!lock && lock.extra?.kind==='lock' && lock.extra.adminIds.includes(s.account.userId) && t.account.userId!==w.ownerUserId && !lock.extra.adminIds.includes(t.account.userId);
}
export function worldModerate(ctx:ServerContext,s:PlayerSession,t:PlayerSession,kind:'kick'|'pull'|'worldban'):void {
 const w=s.world;if(kind==='worldban' && hasPermission(t.account,'moderate')){OnConsoleMessage(s,'`4Ranked players cannot be world banned.``');return;}
 if(!w||!canWorldAct(s,t,w)){OnConsoleMessage(s,'`4You cannot do that to this player.``');return;}
 if(kind==='pull'){
  // Smooth forced movement; keep the same world and netID. Generation guards
  // prevent old timers from moving someone after a later pull or world change.
  const generation=t.pullGeneration=(t.pullGeneration||0)+1, startX=t.x,startY=t.y,endX=s.x,endY=s.y, net=t.netId;
  t.pullUntil=Date.now()+480;t.pullImmuneUntil=Date.now()+1800;
  // Native effect 20 was inspected in the sandbox: a small white smoke puff.
  // Group a few puffs so the brief effect remains visible at both endpoints.
  const puff=(x:number,y:number)=>{for(const [dx,dy] of [[-5,0],[0,-4],[5,0],[0,4]]){const pkt=makeParticleEffectPacket(20,x+10+dx,y+15+dy);for(const p of w.peers)p.peer.sendPacket(0,pkt,true);}};
  puff(startX,startY);OnTextOverlay(t,`You were pulled by ${s.account.name}`);
  broadcastConsoleMessage(w,s.account.name+' `5pulls`` '+t.account.name+'!');
  broadcastPositionedSfx(w,net,'audio/teleport.wav');
  for(let step=1;step<=8;step++) setTimeout(()=>{
    if(t.world!==w||t.netId!==net||t.pullGeneration!==generation||!ctx.sessions.has(t))return;
    const ratio=step/8,eased=1-(1-ratio)*(1-ratio);t.x=startX+(endX-startX)*eased;t.y=startY+(endY-startY)*eased;
    broadcastSetPos(w,net,t.x,t.y);if(step===8){t.pullUntil=0;puff(endX,endY);}
  },step*60).unref();
 }
 else if(kind==='kick'){broadcastConsoleMessage(w,`${s.account.name} kicks ${t.account.name}!`);ctx.respawnPlayer(t,false);OnPlayPositioned(t,'audio/teleport.wav');}
 else {w.worldBans??={};w.worldBans[String(t.account.userId)]=Date.now()+3600000;ctx.dirty=true;ctx.savePersistentState();broadcastConsoleMessage(w,`${s.account.name} world bans ${t.account.name} for one hour.`);ctx.exitToWorldSelect(t);OnConsoleMessage(t,`You are banned from ${w.name} for one hour.`);OnPlayPositioned(s,'audio/repair.wav');}
}
