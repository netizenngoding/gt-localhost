const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gt-punch-'));function load(src){let out=path.join(tmp,src.replaceAll('/','_')+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try{
 const {GTPS3_PUNCH_EFFECTS}=load('server/playmods/gtps3-punch.generated.ts'),{normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts'),{ItemDatabase}=load('server/database/items.ts');
 const {makeSetCharacterStatePacket}=load('server/proton/packet.ts'),{ServerContext}=load('server/database/context.ts'),{toggleWearableItem}=load('server/gamePacket/item_activate.ts'),{expireMods}=load('server/playmods/service.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),a=normalizeAccount({userId:1,name:'Actor'}),b=normalizeAccount({userId:2,name:'Observer'});
 function s(account,id){let s={account,netId:id,world:null,x:32,y:32,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(Buffer.from(p))}}};ctx.sessions.add(s);ctx.accounts.set(account.name.toLowerCase(),account);ctx.joinWorld(s,'TEST');return s}
 let actor=s(a,1),other=s(b,2),n=0;
 assert.equal(Object.keys(GTPS3_PUNCH_EFFECTS).length,391);
 for(const [item,value] of Object.entries(GTPS3_PUNCH_EFFECTS)){
  const id=+item,def=db.get(id);if(!def?.isClothing)continue;n++;a.inventory=[{itemId:id,count:1,equipped:true}];
  let state=buildCharacterStateForSession(actor,db);assert.equal(state.punchEffect,value,`item ${id}`);const p=makeSetCharacterStatePacket(state);assert.equal(p[5],value,`wire effect item ${id}`);
  a.inventory[0].count=0;assert.equal(buildCharacterStateForSession(actor,db).punchEffect,0,`zero item ${id}`);
 }
 assert.equal(n,351);assert.equal(GTPS3_PUNCH_EFFECTS[5480],80);
 a.inventory=[{itemId:138,count:1,equipped:false},{itemId:5480,count:1,equipped:false}];other.peer.packets=[];toggleWearableItem(ctx,actor,138);assert.equal(buildCharacterStateForSession(actor,db).punchEffect,1);assert.ok(other.peer.packets.some(p=>p[4]===20&&p[5]===1));
 toggleWearableItem(ctx,actor,5480);assert.equal(buildCharacterStateForSession(actor,db).punchEffect,80,'hand priority');toggleWearableItem(ctx,actor,5480);assert.equal(buildCharacterStateForSession(actor,db).punchEffect,1,'face restored');
 a.inventory=[{itemId:98,count:1,equipped:false},{itemId:4590,count:1,equipped:false}];actor.peer.packets=[];toggleWearableItem(ctx,actor,98);assert.ok(actor.peer.packets.some(p=>p.includes(Buffer.from('Enhanced Digging'))&&p.includes(Buffer.from('mod added'))));toggleWearableItem(ctx,actor,4590);assert.ok(actor.peer.packets.some(p=>p.includes(Buffer.from('Dragoscarf'))&&p.includes(Buffer.from('mod added'))));toggleWearableItem(ctx,actor,98);assert.ok(actor.peer.packets.some(p=>p.includes(Buffer.from('Smash time is over.'))&&p.includes(Buffer.from('mod removed'))));
 a.playmods=[{id:'gtps3-2',expiresAt:Date.now()-1}];actor.peer.packets=[];expireMods(ctx);assert.ok(actor.peer.packets.some(p=>p.includes(Buffer.from("You've thawed out. (`$Frozen`` mod removed)"))));assert.ok(actor.peer.packets.some(p=>p.includes(Buffer.from('audio/dialog_confirm.wav'))));
 console.log(`PASS: ${n} wearable source mappings, all effect bytes, slot priority, broadcast, equip messages, Frozen mod removed and audio`);
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
