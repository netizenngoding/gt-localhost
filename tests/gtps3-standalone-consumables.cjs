const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gtps3-consume-'));
function load(src){const o=path.join(dir,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:o,bundle:true,platform:'node'});return require(o)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{useConsumable}=load('server/playmods/service.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,dir);
 function player(name,id){const a=normalizeAccount({userId:id,name}),s={account:a,netId:id,x:32,y:32,world:null,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.accounts.set(name.toLowerCase(),a);ctx.sessions.add(s);ctx.joinWorld(s,'TEST');s.x=s.y=32;return s}
 const a=player('A',1),b=player('B',2),w=a.world,t=w.tiles[w.width+3];
 for(const id of [3400,1066,1826,1828,11286,3870])a.account.inventory.push({itemId:id,count:2,equipped:false});
 const count=id=>a.account.inventory.find(v=>v.itemId===id)?.count||0;
 const apply=id=>useConsumable(ctx,a,id,3,1),clear=()=>{a.peer.packets=[];b.peer.packets=[]};
 Object.assign(t,{fg:2,extra:undefined});clear();apply(3400);assert.equal(count(3400),2);assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('only on rocks'))));
 t.fg=10;w.ownerUserId=999;apply(3400);assert.equal(t.fg,10);assert.equal(count(3400),2);w.ownerUserId=0;
 clear();apply(3400);assert.equal(t.fg,392);assert.equal(count(3400),1);
 for(const p of [a,b]){assert.ok(p.peer.packets.some(x=>x.includes(Buffer.from('OnParticleEffect'))));assert.ok(p.peer.packets.some(x=>x.includes(Buffer.from('audio/terraform.wav'))));assert.ok(p.peer.packets.some(x=>x[4]===5));}
 ctx.savePersistentState();assert.equal(new ServerContext(db,dir).worlds.get('TEST').tiles[w.width+3].fg,392);
 for(const id of [1066,1826]){clear();apply(id);assert.equal(count(id),1);for(const p of [a,b])assert.ok(p.peer.packets.some(x=>x.includes(Buffer.from('OnParticleEffect'))));}
 for(const id of [1828,11286,3870]){clear();apply(id);assert.equal(count(id),2);assert.ok(a.peer.packets.some(x=>x.includes(Buffer.from(id===3870?"That's like a hundred years old":"Ew, it has raisins"))));}
 console.log('PASS: GTPS3 rock potion, particle cases, refusals, lock safety and persisted tile');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
