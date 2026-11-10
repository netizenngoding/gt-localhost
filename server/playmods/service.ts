import type { ServerContext } from '../database/context';
import type { PlayerSession } from '../database/peer';
import { MODS, SIMPLE_FOODS } from './model';
import { OnConsoleMessage, applySkinColorUpdate } from '../onVariant';
import { buildTankPacket, makeVariantPacket, makeParticleEffectPacket } from '../proton/packet';
import { recordProgress } from '../progression/service';

function bubble(s:PlayerSession, text:string, viewers:Iterable<PlayerSession>=[s]):void {
 const packet=makeVariantPacket(['OnTalkBubble',{type:'i32',value:s.netId},text,{type:'i32',value:0},{type:'i32',value:0}]);
 for(const viewer of viewers)viewer.peer.sendPacket(0,packet,true);
}
/** Tile hit testing on both axes. GTPS3 get_clicked_on incorrectly ignores Y;
 * do not copy that bug (it permits affecting people on other floors).
 */
export function consumableTarget(s:PlayerSession,tx:number,ty:number):PlayerSession|undefined {
 return [...(s.world?.peers || [])].filter(p=>
  tx*32<p.x+20 && tx*32+32>p.x && ty*32<p.y+30 && ty*32+32>p.y
 ).sort((a,b)=>Math.hypot(a.x+10-tx*32-16,a.y+15-ty*32-16)-Math.hypot(b.x+10-tx*32-16,b.y+15-ty*32-16) || a.netId-b.netId)[0];
}
export function useConsumable(ctx:ServerContext,s:PlayerSession,id:number,tx:number,ty:number):boolean {
 const def=ctx.itemsDb.get(id);if(def?.actionType!==8)return false;
 const world=s.world;
 if(!world || !Number.isInteger(tx) || !Number.isInteger(ty) || tx<0 || ty<0 || tx>=world.width || ty>=world.height)return true;
 const mod=MODS.find(m=>m.item===id),food=SIMPLE_FOODS.find(m=>m.item===id);
 if(!mod&&!food){OnConsoleMessage(s,'This consumable is not implemented yet. Your item was not consumed.');return true;}
 const target=consumableTarget(s,tx,ty),throwable=mod?.action==='throw';
 if(!target&&!throwable){bubble(s,'Must be used on a person.');return true;}
 if(!ctx.consumeInventoryItem(s,id,1,true,false))return true;
 const now=Date.now();
 if(mod && target && mod.seconds>0){
  target.account.playmods=(target.account.playmods||[]).filter(m=>m.expiresAt>now);
  // GTPS3 does not refresh an existing mod on repeated use.
  if(!target.account.playmods.some(m=>m.id===mod.id)){
   target.account.playmods.push({id:mod.id,expiresAt:now+mod.seconds*1000});
   OnConsoleMessage(target,`${mod.onAdd} (\`$${mod.title}\`\` mod added, \`$${mod.seconds}s\`\` left)`);
   ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
  }
 }
 const personAnimation=!!food || (!!target && (mod?.action==='' || mod?.action==='drop'));
 const itemEffect=buildTankPacket({type:19,netId:0,count2:personAnimation?5:4,
  targetNetId:personAnimation?target!.netId:s.netId,
  punchX:id,punchY:s.netId,x:personAnimation?s.x+10:tx*32+16,y:personAnimation?s.y+16:ty*32+16});
 const sound=food?'eat.wav':mod?.sound;
 const text=food?.text || mod?.text;
 if(text&&target)bubble(target,text,world.peers);
 for(const viewer of world.peers){
  viewer.peer.sendPacket(0,itemEffect,true);
  if(sound&&target)viewer.peer.sendPacket(0,makeVariantPacket(['OnPlayPositioned',`audio/${sound}`],target.netId),true);
  if(throwable&&mod.effect)viewer.peer.sendPacket(0,makeParticleEffectPacket(mod.effect,tx*32+16,ty*32+16),true);
 }
 // The source's "drop" random reward branch needs external max_gems data.
 // It is deliberately NOT fabricated; see consumable audit for that limitation.
 recordProgress(ctx,s,'consumables_used',1,1);
 return true;
}
export function expireMods(ctx:ServerContext):void {
 const now=Date.now();
 for(const s of ctx.sessions){
  const expired=(s.account.playmods||[]).filter(m=>m.expiresAt<=now);if(!expired.length)continue;
  s.account.playmods=s.account.playmods!.filter(m=>m.expiresAt>now);ctx.dirty=true;
  for(const m of expired){const def=MODS.find(d=>d.id===m.id);if(def?.onRemove)OnConsoleMessage(s,def.onRemove);}
  ctx.sendCharacterState(s);applySkinColorUpdate(s,false);
 }
}
