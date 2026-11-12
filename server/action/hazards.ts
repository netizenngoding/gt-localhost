import type {ServerContext} from '../database/context';
import type {PlayerSession} from '../database/peer';
import {activeMods} from '../playmods/model';
import {makeVariantPacket} from '../proton/packet';

// Verified against upstream.wasm NetAvatar hazard handlers & RenderNameAndBar (Func #1802):
// - Func #1209 (OnLavaCollide, actionType 16): sets state flag 0x40, subtracts 10 (if hand=250 or back=4812) else 20 from avatar[356] (HP 0..100).
// - Func #1429 (OnPainCollide, actionType 25): sets state flag 0x10000, subtracts 20 from avatar[356].
// - Func #1798/#1800 (OnAcidCollide, actionType 136): sets state flag 0x10000000/0x40010000, subtracts 20 from avatar[356].
// - Func #975 (OnSpikeCollide, actionType 6): sets state flag 0x100 and sends action|respawn_spike (instant kill).
// - Func #5021 (OnSetPearl): clamps param1 to 0..100 and stores into avatar[356].
export const TANK_FLAG_LAVA_HIT = 0x40;
export const TANK_FLAG_SPIKE_HIT = 0x100;
export const TANK_FLAG_PAIN_HIT = 0x10000;
export const TANK_FLAG_ACID_HIT = 0x50000000;

export const MAX_HAZARD_HP = 100;
export const HAZARD_HIT_COOLDOWN_MS = 350;
export const HAZARD_REGEN_DELAY_MS = 3000;
export const HAZARD_REGEN_INTERVAL_MS = 800;
export const HAZARD_REGEN_STEP = 20;

export type HazardKind = 'spike' | 'lava' | 'pain' | 'acid';

export function isFrozen(s:PlayerSession):boolean {return activeMods(s.account).some(m=>(m.flags & (1<<11))!==0);}
/** Conservative full-tile overlap: used after thaw; normal collision is client-driven. */
export function overlapsHazard(ctx:ServerContext,s:PlayerSession):boolean {
 const w=s.world;if(!w)return false;
 const x0=Math.max(0,Math.floor((s.x+2)/32)),x1=Math.min(w.width-1,Math.floor((s.x+18)/32));
 const y0=Math.max(0,Math.floor((s.y+2)/32)),y1=Math.min(w.height-1,Math.floor((s.y+28)/32));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(ctx.itemsDb.get(w.tiles[y*w.width+x].fg)?.isHazard)return true;
 return false;
}

/** Check both torso and foot contact; exact hitboxes vary by item. */
export function centerOnHazard(ctx:ServerContext,s:PlayerSession):boolean {
 const w=s.world;if(!w)return false;const x=Math.floor((s.x+10)/32);
 for(const y of [Math.floor((s.y+15)/32),Math.floor((s.y+33)/32)])
  if(x>=0&&y>=0&&x<w.width&&y<w.height&&ctx.itemsDb.get(w.tiles[y*w.width+x]?.fg)?.isHazard)return true;
 return false;
}

/** Sparse native movement updates can omit the instant a lava bounce occurs.
 * Probe the feet along a short horizontal step starting on the ground. This
 * intentionally does not infer contact over teleports or across large gaps. */
export function crossedGroundHazard(ctx:ServerContext,s:PlayerSession,oldX:number,oldY:number):boolean {
 const w=s.world;if(!w)return false;
 const dx=s.x-oldX,dy=s.y-oldY;
 if(Math.abs(dx)>80 || Math.abs(dx)<1 || dy>20 || dy < -90) return false;
 const foot=oldY+33, row=Math.floor(foot/32);
 if(foot-row*32>5 || row<0 || row>=w.height) return false;
 const a=oldX+10,b=s.x+10,lo=Math.floor(Math.min(a,b)/32),hi=Math.floor(Math.max(a,b)/32);
 for(let x=Math.max(0,lo);x<=Math.min(w.width-1,hi);x++){
  const item=ctx.itemsDb.get(w.tiles[row*w.width+x]?.fg);
  // Lava is action type 16 (item 4); Pain is 25; Acid is 136.
  if(item?.id===4 || item?.actionType===16 || item?.actionType===25 || item?.actionType===136)return true;
 }
 return false;
}

function classifyHazardItem(actionType?:number):HazardKind {
 if(actionType===6)return 'spike';
 if(actionType===25)return 'pain';
 if(actionType===136)return 'acid';
 return 'lava';
}

export function hazardKindAt(ctx:ServerContext,s:PlayerSession,oldX?:number,oldY?:number):HazardKind|null {
 const w=s.world;if(!w)return null;
 const cx=Math.floor((s.x+10)/32);
 for(const y of [Math.floor((s.y+15)/32),Math.floor((s.y+33)/32)]){
  if(cx>=0&&y>=0&&cx<w.width&&y<w.height){
   const item=ctx.itemsDb.get(w.tiles[y*w.width+cx]?.fg);
   if(item?.isHazard)return classifyHazardItem(item.actionType);
  }
 }
 if(oldX!==undefined && oldY!==undefined){
  const dx=s.x-oldX,dy=s.y-oldY;
  if(Math.abs(dx)<=80 && Math.abs(dx)>=1 && dy<=20 && dy>=-90){
   const foot=oldY+33, row=Math.floor(foot/32);
   if(foot-row*32<=5 && row>=0 && row<w.height){
    const a=oldX+10,b=s.x+10,lo=Math.floor(Math.min(a,b)/32),hi=Math.floor(Math.max(a,b)/32);
    for(let x=Math.max(0,lo);x<=Math.min(w.width-1,hi);x++){
     const item=ctx.itemsDb.get(w.tiles[row*w.width+x]?.fg);
     if(item?.id===4 || item?.actionType===16 || item?.actionType===25 || item?.actionType===136){
      return classifyHazardItem(item.actionType);
     }
    }
   }
  }
 }
 return null;
}

/** Func #1209: Fire Hose (250) or back item 4812 halves lava burn damage from 20 to 10 (unless Xenonite blocks heat resist). */
export function hasLavaResistance(s:PlayerSession):boolean {
 const xeno=s.world?.xenonite?.enabled ? s.world.xenonite : undefined;
 if(xeno && xeno.heatResist===2)return false;
 const inv=s.account?.inventory;
 if(!Array.isArray(inv))return false;
 return inv.some(slot=>slot && slot.equipped && slot.count>0 && (slot.itemId===250 || slot.itemId===4812));
}

export function broadcastSetPearl(s:PlayerSession,hp:number):void {
 const clamped=Math.max(0,Math.min(MAX_HAZARD_HP,Math.round(hp)));
 const pkt=makeVariantPacket(['OnSetPearl',{type:'i32',value:clamped}],s.netId);
 const peers=s.world?.peers;
 if(peers && peers.size>0){
  for(const p of peers)p.peer.sendPacket(0,pkt,true);
 }else if(s.peer){
  s.peer.sendPacket(0,pkt,true);
 }
}

export function applyHazardHit(ctx:ServerContext,s:PlayerSession,kind:HazardKind,now=Date.now()):boolean {
 if(kind==='lava' && s.world?.xenonite?.enabled && s.world.xenonite.heatResist===1)return false;
 if(kind==='spike'){
  ctx.respawnPlayer(s,true);
  return true;
 }
 if(s.lastHazardHitAt && now-s.lastHazardHitAt<HAZARD_HIT_COOLDOWN_MS)return false;
 const damage=kind==='lava' && hasLavaResistance(s) ? 10 : 20;
 const currentHp=typeof s.hp==='number' ? s.hp : MAX_HAZARD_HP;
 const nextHp=Math.max(0,currentHp-damage);
 s.hp=nextHp;
 s.lastHazardHitAt=now;
 s.lastHazardRegenAt=now;
 broadcastSetPearl(s,nextHp);
 if(nextHp<=0){
  ctx.respawnPlayer(s,false);
  return true;
 }
 return false;
}

export function tickSessionHazardRegen(s:PlayerSession,now=Date.now()):void {
 if(!s.world || (s.respawnUntil && now<s.respawnUntil))return;
 const hp=typeof s.hp==='number' ? s.hp : MAX_HAZARD_HP;
 if(hp<=0 || hp>=MAX_HAZARD_HP)return;
 const lastHit=s.lastHazardHitAt || 0;
 if(now-lastHit<HAZARD_REGEN_DELAY_MS)return;
 const lastRegen=s.lastHazardRegenAt || 0;
 if(now-lastRegen<HAZARD_REGEN_INTERVAL_MS)return;
 const nextHp=Math.min(MAX_HAZARD_HP,hp+HAZARD_REGEN_STEP);
 s.hp=nextHp;
 s.lastHazardRegenAt=now;
 broadcastSetPearl(s,nextHp);
}

export function processMovementHazard(
 ctx:ServerContext,
 s:PlayerSession,
 flags:number,
 oldX:number,
 oldY:number,
 now=Date.now()
):boolean {
 if(isFrozen(s) || (s.pullImmuneUntil && now<s.pullImmuneUntil))return false;
 if((flags & TANK_FLAG_SPIKE_HIT)!==0)return applyHazardHit(ctx,s,'spike',now);
 if((flags & TANK_FLAG_ACID_HIT)!==0)return applyHazardHit(ctx,s,'acid',now);
 if((flags & TANK_FLAG_PAIN_HIT)!==0)return applyHazardHit(ctx,s,'pain',now);
 if((flags & TANK_FLAG_LAVA_HIT)!==0)return applyHazardHit(ctx,s,'lava',now);
 const tileKind=hazardKindAt(ctx,s,oldX,oldY);
 if(tileKind)return applyHazardHit(ctx,s,tileKind,now);
 return false;
}
