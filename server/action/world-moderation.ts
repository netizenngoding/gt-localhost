import {hasPermission,canModerate} from '../ranks';
import {makeParticleEffectPacket} from '../proton/packet';
import type {PlayerSession} from '../database/peer';
import type {WorldInstance} from '../database/world';
import type {ServerContext} from '../database/context';
import {OnConsoleMessage,broadcastConsoleMessage,OnPlayPositioned,broadcastSetPos,broadcastPositionedSfx,OnTextOverlay} from '../onVariant';
export function canWorldAct(s:PlayerSession,t:PlayerSession,w:WorldInstance):boolean {
 if(t.world!==w || s.world!==w)return false;
 // The world owner may even pull/kick themselves (AstroVerse parity).
 if(s===t)return w.ownerUserId===s.account.userId;
 if(w.ownerUserId===s.account.userId)return true;
 if(hasPermission(s.account,'moderate'))return canModerate(s.account,t.account);
 if(hasPermission(t.account,'moderate'))return false;
 const lock=w.tiles.find(x=>[242,1796,7188,11550].includes(x.fg)&&x.extra?.kind==='lock');
 return !!lock && lock.extra?.kind==='lock' && lock.extra.adminIds.includes(s.account.userId) && t.account.userId!==w.ownerUserId && !lock.extra.adminIds.includes(t.account.userId);
}
export function worldModerate(ctx:ServerContext,s:PlayerSession,t:PlayerSession,kind:'kick'|'pull'|'worldban'):void {
 const w=s.world;
 if(kind==='worldban' && s===t){OnConsoleMessage(s,'You cannot world ban yourself.');return;}
 if(kind==='worldban' && hasPermission(t.account,'moderate')){OnConsoleMessage(s,'Ranked players cannot be world banned.');return;}
 if(!w||!canWorldAct(s,t,w)){OnConsoleMessage(s,'You cannot do that to this player.');return;}
 if(kind==='pull'){
  // Instant pull: no tween. A short movement lock stops the target's old
  // in-flight position packets from overwriting the teleport.
  t.pullGeneration=(t.pullGeneration||0)+1;
  const net=t.netId;
  const ox=t.x, oy=t.y;
  t.pullUntil=Date.now()+250;t.pullImmuneUntil=Date.now()+1500;
  // Exact player-move particle packet (0x11) as used by GT's own
  // SendParticleEffect: 4-byte channel prefix + 56-byte PlayerMoving.
  // Effect id 1 = white 4-lobe spark, fixed at body center, small size.
  const sendSpark=(x:number,y:number)=>{
    const pkt=makeParticleEffectPacket(1,x+16,y+16,1,0);
    const raw=Buffer.concat([Buffer.from([4,0,0,0]),pkt.subarray(4)]);
    for(const p of w.peers)p.peer.sendPacket(0,raw,true);
  };
  sendSpark(ox,oy);
  sendSpark(s.x,s.y);
  t.x=s.x;t.y=s.y;
  broadcastSetPos(w,net,t.x,t.y);
  OnTextOverlay(t,`You were pulled by ${s.account.name}.`);
  broadcastConsoleMessage(w,`${s.account.name} pulls ${t.account.name}!`);
  broadcastPositionedSfx(w,net,'audio/teleport.wav');
 }
 else if(kind==='kick'){broadcastConsoleMessage(w,`${s.account.name} kicks ${t.account.name}!`);ctx.respawnPlayer(t,false);OnPlayPositioned(t,'audio/teleport.wav');}
 else {w.worldBans??={};w.worldBans[String(t.account.userId)]=Date.now()+3600000;ctx.dirty=true;ctx.savePersistentState();broadcastConsoleMessage(w,`${s.account.name} world bans ${t.account.name} for one hour.`);ctx.exitToWorldSelect(t);OnConsoleMessage(t,`You are banned from ${w.name} for one hour.`);OnPlayPositioned(s,'audio/repair.wav');}
}
