const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'consumable-ux-'));
function load(src){const out=path.join(tmp,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try {
 const {normalizeAccount}=load('server/database/peer.ts');
 const {ItemDatabase}=load('server/database/items.ts');
 const {ServerContext}=load('server/database/context.ts');
 const {useConsumable,expireMods}=load('server/playmods/service.ts');
 const {recordProgress}=load('server/progression/service.ts');
 const {handleWrenchPlayer}=load('server/action/wrench.ts');
 const {consumableAudio}=load('server/playmods/consume-audio.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp);
 function player(name,id){const account=normalizeAccount({userId:id,name});const s={account,netId:id,world:null,x:0,y:0,cheats:{noclip:false,speed:false,fly:false},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.sessions.add(s);ctx.accounts.set(name.toLowerCase(),account);return s;}
 const a=player('Alice',1),b=player('Bob',2);ctx.joinWorld(a,'PATCHTEST');ctx.joinWorld(b,'PATCHTEST');a.x=0;a.y=0;b.x=64;b.y=0;
 a.account.inventory.push({itemId:196,count:1,equipped:false});
 a.peer.packets.length=0;b.peer.packets.length=0;
 assert.ok(useConsumable(ctx,a,196,2,0));
 assert.equal(a.account.inventory.find(x=>x.itemId===196)?.count||0,0);
 assert.ok(b.account.playmods.some(m=>m.id==='blue'));
 for(const p of [a,b]){
  assert.equal(p.peer.packets.filter(x=>x.includes(Buffer.from('audio/spray.wav'))).length,1);
  assert.ok(!p.peer.packets.some(x=>x.includes(Buffer.from('audio/eat.wav'))));
 }
 assert.equal(consumableAudio(1634),'audio/spray.wav');
 assert.equal(consumableAudio(196),'audio/spray.wav');
 assert.equal(consumableAudio(874),undefined);
 const reloaded=new ServerContext(db,tmp);assert.ok(reloaded.accounts.get('bob').playmods.some(m=>m.id==='blue'));
 const n=b.account.inventory.length; b.account.playmods[0].expiresAt=Date.now()-1;expireMods(ctx);assert.equal(b.account.playmods.length,0);assert.equal(b.account.inventory.length,n);
 a.account.inventory.push({itemId:98,count:1,equipped:true},{itemId:5480,count:1,equipped:true});
 a.peer.packets.length=0;handleWrenchPlayer(ctx,a,{netid:String(a.netId)});
 const dialog=a.peer.packets.find(x=>x.includes(Buffer.from('OnDialogRequest'))).toString();
 assert.match(dialog,/gui_wrench_achievements/);assert.match(dialog,/target:alist/);assert.match(dialog,/Enhanced Digging/);assert.match(dialog,/Rayman's Fist/);
 a.peer.packets.length=0;b.peer.packets.length=0;recordProgress(ctx,a,'blocks_placed',100);
 for(const p of [a,b]){
   const bubble=p.peer.packets.find(x=>x.includes(Buffer.from('OnTalkBubble')));
   assert.ok(bubble);assert.match(bubble.toString(),/Alice.*earned the achievement.*Builder/);
   const particles=p.peer.packets.filter(x=>x.readUInt32LE(0)===4&&x[4]===17&&x.readFloatLE(40)===48);
   assert.equal(particles.length,1);
   assert.ok(!p.peer.packets.some(x=>x.includes(Buffer.from('audio/achievement.wav'))));
 }
 const old=a.peer.packets.length;recordProgress(ctx,a);assert.equal(a.peer.packets.length,old);
 console.log('PASS: target persistence/expiry, GTPS3 audio mapping, self-wrench effects/count, world achievement bubble and single native effect');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
