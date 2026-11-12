import { randomBytes } from 'node:crypto';
import type { ServerContext } from '../database/context';
import type { PlayerSession } from '../database/peer';
import type { InventorySlot } from '../proton/packet';
import { OnConsoleMessage, OnDialogRequest, OnPlayPositioned } from '../onVariant';
import { makeVariantPacket, makeModifyInventoryPacket, buildTankPacket, PACKET_ITEM_EFFECT } from '../proton/packet';
import { DialogBuilder } from '../tools/create_dialog';

type Side={session:PlayerSession,open:boolean,accepted:boolean,offer:Map<number,number>};
type Trade={a:Side,b:Side,confirmToken?:string,confirmed?:Set<PlayerSession>};
const trades=new WeakMap<PlayerSession,Trade>();
const variant=(s:PlayerSession,v:any[])=>s.peer.sendPacket(0,makeVariantPacket(v),true);
function side(t:Trade,s:PlayerSession){return t.a.session===s?t.a:t.b;}
function other(t:Trade,s:PlayerSession){return t.a.session===s?t.b:t.a;}
function valid(ctx:ServerContext,t:Trade):boolean{return ctx.sessions.has(t.a.session)&&ctx.sessions.has(t.b.session)&&!!t.a.session.world&&t.a.session.world===t.b.session.world&&trades.get(t.a.session)===t&&trades.get(t.b.session)===t;}
function refresh(t:Trade,reset=false){for(const to of [t.a,t.b])if(to.open)for(const from of [t.a,t.b]){
 const list=[...from.offer].map(([id,n])=>`add_slot|${id}|${n}\n`).join('')+`locked|0\n${reset?'reset_locks|1\n':''}accepted|${from.accepted?1:0}\n`;
 const label=from===to?'`oYour offer.``':`\`o${from.session.account.name}'s offer.\`\``;
 variant(to.session,['OnTradeStatus',{type:'i32',value:from.session.netId},'',label,list]);
}}
export function cancelTrade(s:PlayerSession,reason='Trade cancelled.'):void {const t=trades.get(s);if(!t)return;for(const x of [t.a,t.b]){trades.delete(x.session);if(x.open)variant(x.session,['OnForceTradeEnd']);if(reason)OnConsoleMessage(x.session,reason);}}
export function requestTrade(ctx:ServerContext,s:PlayerSession,id:number):void {
 const p=[...(s.world?.peers||[])].find(x=>x.netId===id);if(!p||p===s||p.account===s.account||!ctx.sessions.has(p)){OnConsoleMessage(s,'Player not found.');return;}
 const current=trades.get(s);
 if(current&&valid(ctx,current)&&other(current,s).session===p){const own=side(current,s);if(!own.open){own.open=true;variant(s,['OnStartTrade',p.account.name,{type:'i32',value:p.netId}]);}refresh(current);return;}
 if(current||trades.get(p)){OnConsoleMessage(s,'One player is already trading.');return;}
 const t:Trade={a:{session:s,open:true,accepted:false,offer:new Map()},b:{session:p,open:false,accepted:false,offer:new Map()}};
 trades.set(s,t);trades.set(p,t);variant(s,['OnStartTrade',p.account.name,{type:'i32',value:p.netId}]);OnConsoleMessage(p,'`#TRADE ALERT:`` '+s.account.name+' wants to trade! Wrench them and choose Trade to accept.');OnPlayPositioned(p,'audio/cash_register.wav');
}
function allowed(ctx:ServerContext,s:PlayerSession,id:number){const def=ctx.itemsDb.get(id),slot=s.account.inventory.find(i=>i.itemId===id);return !!def&&!def.name.startsWith('null_')&&!(def.flags&0x8000)&&![6,18,32,112,1424].includes(id)&&!!slot&&!slot.equipped&&slot.count>0;}
export function addTradeItem(ctx:ServerContext,s:PlayerSession,id:number,n:number):void {
 const t=trades.get(s);if(!t||!valid(ctx,t)||t.confirmToken||!side(t,s).open)return;
 if(!Number.isSafeInteger(n)||n<1||n>200||!allowed(ctx,s,id)){OnConsoleMessage(s,'Cannot trade that item or amount.');return;}
 const own=side(t,s),slot=s.account.inventory.find(i=>i.itemId===id)!;
 if(!own.offer.has(id)&&own.offer.size>=4){OnConsoleMessage(s,'Only four different items fit.');return;}
 if((own.offer.get(id)||0)+n>slot.count){OnConsoleMessage(s,'Not enough items.');return;}
 own.offer.set(id,(own.offer.get(id)||0)+n);t.a.accepted=t.b.accepted=false;refresh(t,true);
}
function exchanged(ctx:ServerContext,inv:InventorySlot[],give:Map<number,number>,receive:Map<number,number>,capacity:number):InventorySlot[]|null {
 const next=inv.map(x=>({...x}));
 for(const [id,n] of give){const i=next.findIndex(x=>x.itemId===id);if(i<0||next[i].count<n||next[i].equipped)return null;next[i].count-=n;if(!next[i].count)next.splice(i,1);}
 for(const [id,n] of receive){const max=Math.min(200,Math.max(1,ctx.itemsDb.get(id)?.maxAmount||200));const slot=next.find(x=>x.itemId===id);if(slot){if(slot.count+n>max)return null;slot.count+=n;}else{if(next.length>=capacity||n>max)return null;next.push({itemId:id,count:n,equipped:false});}}
 return next;
}
function accept(ctx:ServerContext,s:PlayerSession,raw:string,status:string){
 const t=trades.get(s);if(!t||!valid(ctx,t)||!side(t,s).open||!other(t,s).open)return;
 const seen=new Map<number,number>();let malformed=false;
 for(const line of raw.replace(/\0+$/g, "").split(/\r?\n/)){if(!line.startsWith('item|'))continue;const m=/^item\|(\d+)\|(\d+)\s*$/.exec(line);if(!m){malformed=true;break;}const id=Number(m[1]),n=Number(m[2]);if(seen.has(id)||!Number.isSafeInteger(id)||!Number.isSafeInteger(n))malformed=true;seen.set(id,n);}
 const offered=other(t,s).offer;
 if(status==='1' && (malformed || (seen.size>0 && (seen.size!==offered.size || [...offered].some(([id,n])=>seen.get(id)!==n))))) {OnConsoleMessage(s,'Offer changed. Please check it again.');refresh(t);return;}
 side(t,s).accepted=status==='1';refresh(t);if(!t.a.accepted||!t.b.accepted)return;
 beginConfirmation(ctx,t);
}
function beginConfirmation(ctx:ServerContext,t:Trade):void {
 t.confirmToken=randomBytes(12).toString('hex');t.confirmed=new Set();
 for(const x of [t.a,t.b]){
  variant(x.session,['OnForceTradeEnd']);x.open=false;
  const d=new DialogBuilder().setDefaultColor('`o').addLabelWithIcon('big','`wTrade Confirmation``',1366).addTextbox("`4You'll give:``");
  if(!x.offer.size)d.addTextbox('Nothing');
  for(const [id,n] of x.offer)d.addLabelWithIcon('small',`${n} x ${ctx.itemsDb.get(id)?.name.replace(/[`|\r\n]/g,'')||id}`,id);
  const incoming=other(t,x.session).offer;d.addTextbox("`2You'll get:``");
  if(!incoming.size)d.addTextbox('`4Nothing! Double-check this trade.``');
  for(const [id,n] of incoming)d.addLabelWithIcon('small',`${n} x ${ctx.itemsDb.get(id)?.name.replace(/[`|\r\n]/g,'')||id}`,id);
  d.addButton(`confirm_${t.confirmToken}`,'`2Do The Trade!``').addButton('cancel','`4Cancel``').addQuickExit();
  OnDialogRequest(x.session,d.endDialog('trade_confirm','',''));
 }
}
export function confirmTrade(ctx:ServerContext,s:PlayerSession,btn:string):void {
 const t=trades.get(s);if(!t||!valid(ctx,t)||!t.confirmToken)return;
 if(btn==='cancel'||!btn){cancelTrade(s);return;}
 if(btn!==`confirm_${t.confirmToken}`)return;
 t.confirmed!.add(s);if(t.confirmed!.size<2){OnConsoleMessage(s,'Trade confirmed; waiting for the other player.');return;}
 complete(ctx,t,s);
}
function complete(ctx:ServerContext,t:Trade,s:PlayerSession):void {
 const a=t.a.session,b=t.b.session;
 for(const x of [t.a,t.b])for(const [id] of x.offer)if(!allowed(ctx,x.session,id)){cancelTrade(s,'Trade cancelled: an item is unavailable.');return;}
 const nextA=exchanged(ctx,a.account.inventory,t.a.offer,t.b.offer,a.account.backpackSize),nextB=exchanged(ctx,b.account.inventory,t.b.offer,t.a.offer,b.account.backpackSize);
 if(!nextA||!nextB){t.a.accepted=t.b.accepted=false;OnConsoleMessage(a,'Trade failed: items missing or inventory full.');OnConsoleMessage(b,'Trade failed: items missing or inventory full.');refresh(t);return;}
 const oldA=a.account.inventory,oldB=b.account.inventory;a.account.inventory=nextA;b.account.inventory=nextB;
 try{ctx.savePlayersNow()}catch(e){a.account.inventory=oldA;b.account.inventory=oldB;t.a.accepted=t.b.accepted=false;cancelTrade(s,'Trade failed to save; nothing exchanged.');return;}
 // Remove both sides first: simultaneous same-item swaps may otherwise overflow client stacks.
 for(const giver of [t.a,t.b])for(const [id,n] of giver.offer)giver.session.peer.sendPacket(0,makeModifyInventoryPacket(id,0,n),true);
 for(const [giver,receiver] of [[t.a,t.b],[t.b,t.a]] as const)for(const [id,n] of giver.offer)receiver.session.peer.sendPacket(0,makeModifyInventoryPacket(id,n,0),true);
 // GTPS3 World.h 13948: type 19 subtype 3, receiving netID in
 // netId and giving netID in targetNetId; one visual per offered item.
 let delay=0;
 for(const [giver,receiver] of [[t.a,t.b],[t.b,t.a]] as const)for(const [id] of giver.offer){
   delay+=450;
   const effect=buildTankPacket({type:PACKET_ITEM_EFFECT,count2:3,netId:receiver.session.netId,targetNetId:giver.session.netId,value:delay,punchX:id,punchY:id});
   for(const viewer of a.world?.peers || [])viewer.peer.sendPacket(0,effect,true);
   for(const player of [a,b])OnPlayPositioned(player,'audio/change_clothes.wav',delay);
 }
 cancelTrade(s,'Trade complete.');
}
export function tradeAction(ctx:ServerContext,s:PlayerSession,action:string,kv:Record<string,string>,raw:string):boolean {
 if(!['trade_started','mod_trade','rem_trade','trade_accept','trade_cancel','trade_lock','trade_check_price'].includes(action))return false;
 const t=trades.get(s);if(!t||!valid(ctx,t)){if(t)cancelTrade(s);return true;}
 if(action==='trade_started'){refresh(t);return true;}
 if(action==='trade_cancel'){if(!t.confirmToken)cancelTrade(s);return true;}
 if(t.confirmToken)return true;
 if(action==='mod_trade'){
  const id=Number((kv.itemID || '').replace(/\|$/, '')),slot=s.account.inventory.find(x=>x.itemId===id);
  if(!allowed(ctx,s,id)||!slot){OnConsoleMessage(s,'Cannot trade that item.');return true;}
  if(slot.count===1)addTradeItem(ctx,s,id,1);else {const def=ctx.itemsDb.get(id)!;const d=new DialogBuilder().addLabelWithIcon('big',def.name.replace(/[`|\r\n]/g,''),id).addTextbox(`How many to offer? You have ${slot.count}.`).addTextInput('count','','1',3).embedData('itemID',id).addQuickExit();OnDialogRequest(s,d.endDialog('trade_add','Cancel','OK'));}return true;
 }
 if(action==='rem_trade'){const own=side(t,s);own.offer.delete(Number((kv.itemID || '').replace(/\|$/, '')));t.a.accepted=t.b.accepted=false;refresh(t,true);return true;}
 if(action==='trade_accept'){accept(ctx,s,raw,kv.status);return true;}
 return true;
}
