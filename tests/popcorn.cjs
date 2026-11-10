const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'popcorn-'));
function load(src){const out=path.join(tmp,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try {
 const {normalizeAccount}=load('server/database/peer.ts');
 const {ItemDatabase}=load('server/database/items.ts');
 const {ServerContext}=load('server/database/context.ts');
 const {useConsumable}=load('server/playmods/service.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp);
 function player(name,id){const account=normalizeAccount({userId:id,name});const s={account,netId:id,world:null,x:0,y:0,cheats:{noclip:false,speed:false,fly:false},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.sessions.add(s);ctx.accounts.set(name.toLowerCase(),account);return s;}
 const a=player('Alice',1),b=player('Bob',2);ctx.joinWorld(a,'TEST');ctx.joinWorld(b,'TEST');a.x=0;a.y=0;b.x=64;b.y=0;
 a.account.inventory.push({itemId:4256,count:2,equipped:false});
 for(const p of [a,b])p.peer.packets.length=0;
 assert.equal(useConsumable(ctx,a,4256,5,0),true);assert.equal(a.account.inventory.find(x=>x.itemId===4256).count,2);
 for(const p of [a,b])p.peer.packets.length=0;
 assert.equal(useConsumable(ctx,a,4256,2,0),true);
 assert.equal(a.account.inventory.find(x=>x.itemId===4256).count,1);
 assert.equal(a.account.progression.counters.consumables_used,1);
 for(const p of [a,b]) {
  const action=p.peer.packets.find(x=>x.includes(Buffer.from('OnAction'))&&x.includes(Buffer.from('/popcorn')));
  assert.ok(action,'each viewer sees the native popcorn animation action');
  assert.equal(action.readInt32LE(8),b.netId,'action is addressed to the target avatar');
  assert.equal(p.peer.packets.filter(x=>x.includes(Buffer.from('/popcorn'))).length,1);
 }
 assert.equal(useConsumable(ctx,a,4256,0,0),true);assert.equal(a.account.inventory.find(x=>x.itemId===4256)?.count||0,0);
 const oldRandom=Math.random; let calls=0; Math.random=()=>++calls===1 ? 0.019 : 0;
 try { a.account.inventory.push({itemId:4256,count:1,equipped:false}); assert.equal(useConsumable(ctx,a,4256,2,0),true); } finally { Math.random=oldRandom; }
 assert.equal(b.account.inventory.find(x=>x.itemId===4194)?.count,1,'2% prize belongs to the consumer');
 // If inventory is full, prize falls into the world rather than disappearing.
 b.account.backpackSize=b.account.inventory.length;const oldRand2=Math.random;calls=0;Math.random=()=>++calls===1 ? 0 : 0.11;
 try {a.account.inventory.push({itemId:4256,count:1,equipped:false});useConsumable(ctx,a,4256,2,0);} finally {Math.random=oldRand2;}
 assert.ok(b.world.objects.some(o=>o.itemId===4206 && o.count===1));
 const before=b.peer.packets.length;assert.equal(useConsumable(ctx,a,4256,0,0),true);assert.equal(b.peer.packets.length,before);
 assert.equal(new ServerContext(db,tmp).accounts.get('alice').progression.counters.consumables_used,4);
 console.log('PASS: popcorn consumes safely, targets the person, broadcasts native OnAction /popcorn and persists progress');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
