import {isFrozen,overlapsHazard,tickSessionHazardRegen} from '../action/hazards';
import type { ServerContext } from '../database/context';
import type { PlayerSession } from '../database/peer';
import { canModifyWorldTile, spawnOrMergeWorldDrop } from '../database/world';
import { activeMods, MODS, SIMPLE_FOODS } from './model';
import { consumableAudio } from './consume-audio';
import { GTPS3_CONSUME_RECIPES } from './gtps3-recipes';
import { OnConsoleMessage, applySkinColorUpdate } from '../onVariant';
import { buildTankPacket, makeVariantPacket, makeParticleEffectPacket, makeTileUpdatePacket, makeTextPacket, NET_MESSAGE_GAME_MESSAGE } from '../proton/packet';
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
// Wiki documents the 2% chance and possible blocks, but not per-prize weights.
// Equal weights here are provisional; they must not be presented as original odds.
const POPCORN_PRIZES = [4194,4206,4202,4200,4220,4214,4218,4216,4204,4198] as const;
// GTPS3 World.h to_playmod_time (integer seconds, trailing space retained).
export function gtps3PlaymodTime(seconds:number):string {
 const hour=Math.floor(seconds/3600), minute=Math.floor((seconds%3600)/60), second=seconds%60;
 if(!hour&&!minute&&!second)return 'Removing now ';
 return (hour>0?`${hour} hours`:'')+(minute>0?`${hour>0?', ':''}${minute} mins`:'')+(second>0?`${minute>0?', ':''}${second} secs `:' ');
}
// Hair dyes and eye items handled by tile_change_req in bathtub/mirror
const HAIR_DYE_ITEMS = new Set([3822, 3824, 3826, 3828, 3830]);
const EYE_ITEMS = new Set([5458, 5460, 5462, 5464, 5466, 6760, 6762, 6764, 6766, 6768]);

 export function useConsumable(ctx:ServerContext,s:PlayerSession,id:number,tx:number,ty:number):boolean {
 const def=ctx.itemsDb.get(id);if(def?.actionType!==8)return false;
 if(HAIR_DYE_ITEMS.has(id)||EYE_ITEMS.has(id))return false;
 const world=s.world;
 if(!world || !Number.isInteger(tx) || !Number.isInteger(ty) || tx<0 || ty<0 || tx>=world.width || ty>=world.height)return true;
 if(world.xenonite?.enabled && world.xenonite.powerups===1){bubble(s,"`4Powerups are blocked in this world by the Xenonite Crystal!``");return true;}
 const mod=MODS.find(m=>m.item===id),food=SIMPLE_FOODS.find(m=>m.item===id);
 // GTPS3 ae49cffa, SERVER/World.h case 228/1062/1778/5764/10672.
 // Access is checked before mutating or consuming, unlike buggy server forks.
 const spraySeconds: Record<number,number> = {228:3600, 10672:3600, 1062:30*86400, 1778:86400, 5764:259200};
 if (Object.prototype.hasOwnProperty.call(spraySeconds,id)) {
  const tile=world.tiles[ty*world.width+tx], tree=ctx.itemsDb.get(tile.fg), now=Date.now();
  if(!tree?.isSeed || tile.extra?.kind!=='seed'){bubble(s,"Use this on a growing tree to speed it's growth.");return true;}
  if(!canModifyWorldTile(s,world,tile,tx,ty,'place')) return true;
  const growMs=Math.max(1,tree.growTime || 15)*1000;
  if(now-tile.extra.plantedAtMs>=growMs){bubble(s,"This tree has already bloomed, don't waste your spray on it!");return true;}
  if(!ctx.consumeInventoryItem(s,id,1,true,false)) return true;
  const projected=tile.extra.plantedAtMs-spraySeconds[id]*1000;
  // Keep un-clamped age like GTPS3; packet encoding itself limits visual age.
  tile.extra.plantedAtMs=projected;
  ctx.dirty=true;
  const name=ctx.itemsDb.get(tile.fg-1)?.name || tree.name.replace(/ Seed$/, '');
  const n=spraySeconds[id], unit=n<86400 ? `${n/3600}\`\` hours` : `${n/86400}\`\` days`;
  const label=now-projected<=growMs ? `${name} Tree aged \`$${unit}` : `${name} Tree grew to full size!`;
  s.peer.sendPacket(0,makeVariantPacket(['OnTextOverlay',label],-1),true);
  s.peer.sendPacket(0,makeVariantPacket(['OnPlayPositioned','audio/spray.wav'],s.netId),true);
  const update=makeTileUpdatePacket(tx,ty,tile,now);
  for(const viewer of world.peers)viewer.peer.sendPacket(0,update,true);
  const remaining=growMs-(now-tile.extra.plantedAtMs), expectedStart=tile.extra.plantedAtMs, seedId=tile.fg;
  if(remaining>0 && remaining<=300000){
   const timer=setTimeout(()=>{
    if(tile.fg!==seedId || tile.extra?.kind!=='seed' || tile.extra.plantedAtMs!==expectedStart)return;
    const matured=makeTileUpdatePacket(tx,ty,tile,Date.now());
    for(const viewer of world.peers)viewer.peer.sendPacket(0,matured,true);
   },remaining+200);
   timer.unref();
  }
  recordProgress(ctx,s,'consumables_used',1,1);
  return true;
 }
 // GTPS3 Base.h consume recipes / World.h consume case group. Check both
 // input and output room before any mutation, rather than spending on failure.
 const recipe=GTPS3_CONSUME_RECIPES[id];
 if(recipe){
  const [need,output]=recipe, slot=s.account.inventory.find(v=>v.itemId===id),
   dst=s.account.inventory.find(v=>v.itemId===output), prize=ctx.itemsDb.get(output);
  if(!slot || slot.count<need){bubble(s,`\`4You'll need more ${def.name} than that!\`\``);return true;}
  if(!prize || (dst ? dst.count>=200 : s.account.inventory.length>=s.account.backpackSize)){
   bubble(s,"You don't have enough inventory space!");return true;
  }
  if(!ctx.consumeInventoryItem(s,id,need,true,false))return true;
  if(ctx.giveInventoryItem(s,output,1,true)!==1)throw new Error('Recipe output invariant failed');
  bubble(s,`\`5${def.name} combine to create a\`\` \`2${prize.name}\`\`\`5!\`\``);
  recordProgress(ctx,s,'consumables_used',1,1);
  return true;
 }
 // Direct ports of standalone GTPS3 World.h cases. Refusal never spends item.
 if(id===1828 || id===11286 || id===3870){
  if(s.account.inventory.some(slot=>slot.itemId===id && slot.count>0))
   bubble(s,id===3870 ? "That's like a hundred years old. No." : "Ew, it has raisins! I'm not eating that.");
  return true;
 }
 if(id===1066 || id===1826){
  if(!ctx.consumeInventoryItem(s,id,1,true,false))return true;
  const particle=makeVariantPacket(['OnParticleEffect',{type:'i32',value:id===1066?50:92},{type:'vec2',x:tx*32+16,y:ty*32+16}]);
  for(const viewer of world.peers)viewer.peer.sendPacket(0,particle,true);
  recordProgress(ctx,s,'consumables_used',1,1);
  return true;
 }
 if(id===3400){
  const tile=world.tiles[ty*world.width+tx];
  if(!s.account.inventory.some(slot=>slot.itemId===id && slot.count>0))return true;
  if(tile.fg!==10){bubble(s,'`4This potion is clearly labeled for use only on rocks.``');return true;}
  if(!canModifyWorldTile(s,world,tile,tx,ty,'place'))return true;
  if(!ctx.consumeInventoryItem(s,id,1,true,false))return true;
  tile.fg=392;tile.extra=undefined;tile.damage=0;ctx.dirty=true;
  const particle=makeVariantPacket(['OnParticleEffect',{type:'i32',value:44},{type:'vec2',x:tx*32+16,y:ty*32+16}]);
  const sfx=makeTextPacket(NET_MESSAGE_GAME_MESSAGE,'action|play_sfx\nfile|audio/terraform.wav\ndelayMS|0');
  const update=makeTileUpdatePacket(tx,ty,tile,Date.now());
  for(const viewer of world.peers){viewer.peer.sendPacket(0,particle,true);viewer.peer.sendPacket(0,sfx,true);viewer.peer.sendPacket(0,update,true);}
  recordProgress(ctx,s,'consumables_used',1,1);
  return true;
 }
 // The native OnAction handler recognizes /popcorn and starts animation 23.
 const popcorn = id === 4256, xpPotion = id === 1488, coin = id === 752;
 if(!mod&&!food&&!popcorn&&!xpPotion&&!coin){OnConsoleMessage(s,'This consumable is not implemented yet. Your item was not consumed.');return true;}
 const target=consumableTarget(s,tx,ty),throwable=mod?.action==='throw';
 if(!target&&!throwable){bubble(s,'Must be used on a person.');return true;}
 if(xpPotion && target!==s){bubble(s,'This potion can only be used on yourself.');return true;}
 if(!ctx.consumeInventoryItem(s,id,1,true,false))return true;
 const now=Date.now();
 if(mod && target && mod.seconds>0){
  // Expired effects must go through the same cleanup as the periodic sweep.
  // Silently filtering here can swallow the thaw event and leave the client
  // displaying an obsolete Frozen character state or skin indefinitely.
  expireSessionMods(ctx,target,now);
  target.account.playmods ??= [];
  // GTPS3 antidote removes the listed transformation effects. It operates
  // on the recipient; the C++ consume branch accidentally referenced sender.
  if(id===782){
   const cured=new Set(['gtps3-infected','gtps3-49','gtps3-48','gtps3-71','gtps3-72','gtps3-73','gtps3-4','envious','blue','gtps3-19','halo','gtps3-42']);
   target.account.playmods=target.account.playmods.filter(m=>!cured.has(m.id));
  }
  // GTPS3 form_state removes infection while antidote is active.
  if(id===764 && activeMods(target.account).some(m=>m.id==='gtps3-antidote')){
   ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
  } else {
  // Food buffs and Floating balloons replace/refresh their group; equivalent Lucky sources do not stack.
  // Legacy non-grouped effects retain the existing no-refresh behaviour.
  const wasActive = target.account.playmods.some(m=>m.id===mod.id);
  if(mod.group){
   const equivalentIds=new Set(MODS.filter(d=>d.group===mod.group).map(d=>d.id));
   target.account.playmods=target.account.playmods.filter(m=>!equivalentIds.has(m.id));
  }
  if(mod.group==='floating' || !target.account.playmods.some(m=>m.id===mod.id)){
   target.account.playmods.push({id:mod.id,expiresAt:now+mod.seconds*1000});
   if(!wasActive){
    OnConsoleMessage(target,`${mod.onAdd} (\`$${mod.title}\`\` mod added, \`$${gtps3PlaymodTime(mod.seconds)}\`\`left)`);
   }
   ctx.dirty=true;
   ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
  } else if(id===782) {
   ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
  }
  }
 }
 if(id===782 && target){
  bubble(s,`\`w[${target.account.name} \`wfeels strangely better!]`,world.peers);
  for(const viewer of world.peers)OnConsoleMessage(viewer,`\`7[\`w${target.account.name} \`ofeels strangely better!\`7]`);
 }
 const personAnimation=popcorn || xpPotion || coin || !!food || (!!target && (mod?.action==='' || mod?.action==='drop'));
 const itemEffect=buildTankPacket({type:19,netId:0,count2:personAnimation?5:4,
  targetNetId:personAnimation?target!.netId:s.netId,
  punchX:id,punchY:s.netId,x:personAnimation?s.x+10:tx*32+16,y:personAnimation?s.y+16:ty*32+16});
 const sound=consumableAudio(id);
 const text=coin ? (Math.random()<0.5 ? 'HEADS!' : 'TAILS!') : food?.text || mod?.text;
 if(text&&target)bubble(target,text,world.peers);
 for(const viewer of world.peers){
  viewer.peer.sendPacket(0,itemEffect,true);
  if(popcorn && target)viewer.peer.sendPacket(0,makeVariantPacket(['OnAction','/popcorn'],target.netId),true);
  if(sound&&target)viewer.peer.sendPacket(0,makeVariantPacket(['OnPlayPositioned',sound],target.netId),true);
  if(throwable&&mod.effect)viewer.peer.sendPacket(0,makeParticleEffectPacket(mod.effect,tx*32+16,ty*32+16),true);
 }
 if(popcorn && target && Math.random()<0.02){
  const prize=POPCORN_PRIZES[Math.floor(Math.random()*POPCORN_PRIZES.length)];
  if(ctx.giveInventoryItem(target,prize,1,true)<1){
   spawnOrMergeWorldDrop(world,prize,1,target.x+10,target.y+16,-1);ctx.dirty=true;
  }
  OnConsoleMessage(target,`You found ${ctx.itemsDb.get(prize)?.name || 'a prize'} in the popcorn!`);
 }
 if(xpPotion) recordProgress(ctx,s,undefined,0,10000);
 // The source's "drop" random reward branch needs external max_gems data.
 // It is deliberately NOT fabricated; see consumable audit for that limitation.
 recordProgress(ctx,s,'consumables_used',1,1);
 return true;
}
function expireSessionMods(ctx:ServerContext,s:PlayerSession,now:number):void {
 const expired=(s.account.playmods||[]).filter(m=>m.expiresAt<=now);if(!expired.length)return;
 s.account.playmods=s.account.playmods!.filter(m=>m.expiresAt>now);ctx.dirty=true;
 for(const m of expired){
  const def=MODS.find(d=>d.id===m.id);
  if(def){
   // GTPS3 Source.cpp: expiry sends confirmation sound and the mod suffix.
   s.peer.sendPacket(0,makeTextPacket(NET_MESSAGE_GAME_MESSAGE,'action|play_sfx\nfile|audio/dialog_confirm.wav\ndelayMS|0'),true);
   OnConsoleMessage(s,`${def.onRemove} (\`$${def.title}\`\` mod removed)`);
  }
 }
 ctx.sendCharacterState(s);applySkinColorUpdate(s,false);
 if(expired.some(m=>MODS.find(d=>d.id===m.id && (d.flags & (1<<11))!==0)) && !isFrozen(s) && (!s.pullImmuneUntil || Date.now()>=s.pullImmuneUntil) && overlapsHazard(ctx,s))ctx.respawnPlayer(s,false);
}
export function expireMods(ctx:ServerContext):void {
 const now=Date.now();
 for(const s of ctx.sessions){
  expireSessionMods(ctx,s,now);
  tickSessionHazardRegen(s,now);
 }
}

/** GTPS3 Source.cpp punch infection, with bounded two-axis target selection. */
export function infectByPunch(ctx:ServerContext,attacker:PlayerSession,tx:number,ty:number):void {
 const world=attacker.world,now=Date.now();
 if(!world || !activeMods(attacker.account).some(m=>m.id==='gtps3-infected'))return;
 if(attacker.lastInfectPunchAt && now-attacker.lastInfectPunchAt<1500)return;
 attacker.lastInfectPunchAt=now;
 const target=[...world.peers].filter(p=>p!==attacker && tx*32<p.x+20 && tx*32+32>p.x && ty*32<p.y+30 && ty*32+32>p.y)
  .sort((a,b)=>a.netId-b.netId)[0];
 if(!target || activeMods(target.account).some(m=>m.id==='gtps3-infected'))return;
 if(activeMods(target.account).some(m=>m.id==='gtps3-antidote')){
  const packet=buildTankPacket({type:19,netId:-1,count2:5,targetNetId:target.netId,punchX:782,x:target.x+10,y:target.y+16});
  for(const viewer of world.peers)viewer.peer.sendPacket(0,packet,true);
  return;
 }
 expireSessionMods(ctx,target,now);
 target.account.playmods ??= [];
 target.account.playmods.push({id:'gtps3-infected',expiresAt:now+60000});
 OnConsoleMessage(target,"You've been infected by the g-Virus. Punch others to infect them, too! Braiiiins... (`$Infected!`` mod added, `$1 mins`` left)");
 target.peer.sendPacket(0,makeVariantPacket(['OnAddNotification','interface/large/infected.rttex',`\`4You were infected by ${attacker.account.name}!`]),true);
 ctx.dirty=true;ctx.savePlayersNow();ctx.sendCharacterState(target);applySkinColorUpdate(target,false);
}
