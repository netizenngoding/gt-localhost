const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gt-corrective-'));function load(src){const out=path.join(tmp,src.replaceAll('/','_')+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts');
 const {MODS,SIMPLE_FOODS,effectiveSkin}=load('server/playmods/model.ts'),{useConsumable,expireMods}=load('server/playmods/service.ts');
 const {handlePlayerMoving}=load('server/gamePacket/player_moving.ts'),{handleWrenchPlayer}=load('server/action/wrench.ts'),{handlePlayerDialogsReturn}=load('server/action/dialog_return/player_dialogs.ts');
 const {recordProgress}=load('server/progression/service.ts'),{parseTankPacket}=load('server/proton/packet.ts'),{handleProgressionCommand}=load('server/progression/commands.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp);function session(id,name){const s={account:normalizeAccount({userId:id,name}),netId:id,world:null,x:0,y:0,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.sessions.add(s);ctx.accounts.set(name.toLowerCase(),s.account);ctx.joinWorld(s,'TEST');s.x=id*32;s.y=32;return s;}
 const a=session(1,'Actor'),b=session(2,'Target'),c=session(3,'OtherWorld');ctx.joinWorld(c,'OTHER');
 const give=id=>{a.account.inventory=a.account.inventory.filter(i=>i.itemId!==id);a.account.inventory.push({itemId:id,count:3,equipped:false});};
 for(const def of [...MODS,...SIMPLE_FOODS]){
  assert.equal(db.get(def.item).actionType,8);give(def.item);b.account.playmods=[];a.account.playmods=[];a.peer.packets=[];b.peer.packets=[];c.peer.packets=[];
  useConsumable(ctx,a,def.item,2,1);assert.equal(a.account.inventory.find(i=>i.itemId===def.item).count,2,`consumed ${def.item}`);
  assert.equal(a.account.playmods.length,0,'not applied to actor');
  if(def.seconds){assert.equal(b.account.playmods[0].id,def.id);assert.ok(Math.abs(b.account.playmods[0].expiresAt-Date.now()-def.seconds*1000)<1000);const expiry=b.account.playmods[0].expiresAt;useConsumable(ctx,a,def.item,2,1);if(def.group)assert.ok(b.account.playmods[0].expiresAt>=expiry,'food replaces or refreshes');else assert.equal(b.account.playmods[0].expiresAt,expiry,'non-food not refreshed');}
  assert.ok(b.peer.packets.some(p=>p[4]===19));assert.ok(!c.peer.packets.length,'no cross-world effects');
 }
 give(196);b.account.playmods=[];const before=a.account.inventory.find(i=>i.itemId===196).count;useConsumable(ctx,a,196,2,10);assert.equal(a.account.inventory.find(i=>i.itemId===196).count,before,'Y-axis miss does not consume');
 give(1368);useConsumable(ctx,a,1368,2,1);const bx=b.x,by=b.y;b.peer.packets=[];handlePlayerMoving(b,Buffer.alloc(60),{x:bx,y:by+10});assert.equal(b.y,by+10,'freeze keeps gravity position');assert.ok(!b.peer.packets.some(p=>p.includes(Buffer.from('OnSetPos'))),'no freeze correction loop');
 b.account.playmods=[{id:'blue',expiresAt:Date.now()+10000},{id:'envious',expiresAt:Date.now()+10000}];assert.equal(effectiveSkin(b.account),4278190335,'first skin mod wins');b.account.playmods[0].expiresAt=Date.now()-1;expireMods(ctx);assert.equal(effectiveSkin(b.account),1627349247);
 a.peer.packets=[];b.peer.packets=[];c.peer.packets=[];recordProgress(ctx,a,'blocks_placed',100);assert.ok(b.peer.packets.some(p=>p.includes(Buffer.from('OnTalkBubble'))));assert.ok(b.peer.packets.some(p=>p[4]===17&&parseTankPacket(p).speedY===48));assert.ok(!a.peer.packets.some(p=>p.includes(Buffer.from('OnAddNotification'))));assert.equal(c.peer.packets.length,0);
 assert.equal(handleProgressionCommand(ctx,a,'playmods',['playmods']),false);
 a.peer.packets=[];handleWrenchPlayer(ctx,a,{netid:String(a.netId)});const dialog=a.peer.packets.find(p=>p.includes(Buffer.from('OnDialogRequest'))).toString();assert.ok(dialog.includes('add_custom_button|notebook_edit|image:interface/large/gui_wrench_notebook.rttex'));assert.ok(dialog.includes('end_dialog|popup||Continue|'));assert.ok(!dialog.includes('Active Playmods'));assert.ok(!dialog.includes('Item Finder'));
 handlePlayerDialogsReturn(ctx,a,'notebook_edit',{buttonClicked:'save',personal_note:'Saved|bad\nline'});ctx.savePlayersNow();const reloaded=new ServerContext(db,tmp).accounts.get('actor');assert.equal(reloaded.personalNote,'Saved bad line');
 console.log(`PASS: ${MODS.length} effect and ${SIMPLE_FOODS.length} food dispatches; other-player targeting; Y miss; group refresh and other effects no refresh; frozen midair fall; skin priority/expiry; native achievement bubble/effect48 world scope; removed command; native wrench commands; sanitized notebook persistence`);
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
