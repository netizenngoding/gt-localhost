const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gt-spray-'));
function load(src){const out=path.join(dir,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
const rng=Math.random;
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts');
 const {useConsumable}=load('server/playmods/service.ts'),{handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,dir);
 function player(name,id,x){let a=normalizeAccount({userId:id,name});let s={account:a,netId:id,x,y:32,world:null,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.accounts.set(name.toLowerCase(),a);ctx.sessions.add(s);ctx.joinWorld(s,'TEST');s.x=x;s.y=32;return s;}
 const s=player('A',1,32),other=player('B',2,64),a=s.account,w=s.world;
 for(const id of [228,10672,1062,1778,5764,1488,752]) {assert.equal(db.get(id).actionType,8);a.inventory.push({itemId:id,count:3,equipped:false});}
 const slot=id=>a.inventory.find(i=>i.itemId===id), t=w.tiles[w.width+3];
 const setTree=(age=0)=>Object.assign(t,{fg:101,bg:0,flags:0,extra:{kind:'seed',plantedAtMs:Date.now()-age,fruitCount:2,spliced:false}});
 const spray=id=>handleTileChangeRequest(ctx,s,{value:id,punchX:3,punchY:1});
 setTree();s.peer.packets=[];other.peer.packets=[];let prev=t.extra.plantedAtMs;spray(228);assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('Tree grew to full size!'))));assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('audio/spray.wav'))));assert.ok(!other.peer.packets.some(p=>p.includes(Buffer.from('audio/spray.wav'))),'GTPS3 sound is sent to user only');assert.equal(slot(228).count,2);assert.ok(t.extra.plantedAtMs<=prev-67000);assert.ok(Date.now()-t.extra.plantedAtMs>=68000);assert.ok(s.peer.packets.some(p=>p[4]===5),'tile update');
 ctx.savePersistentState();assert.equal(new ServerContext(db,dir).worlds.get('TEST').tiles[w.width+3].extra.plantedAtMs,t.extra.plantedAtMs,'sprayed age survives reload');spray(228);assert.equal(slot(228).count,2,'already mature is not consumed');
 setTree();w.ownerUserId=999;spray(1062);assert.equal(slot(1062).count,3,'locked tree is not modified or consumed');assert.ok(Date.now()-t.extra.plantedAtMs<1000);w.ownerUserId=0;
 for(const id of [10672,1062,1778]){setTree();spray(id);assert.equal(slot(id).count,2);assert.ok(Date.now()-t.extra.plantedAtMs>=68000);}
 setTree();t.fg=263;s.peer.packets=[];other.peer.packets=[];prev=t.extra.plantedAtMs;spray(5764);assert.equal(slot(5764).count,2);assert.equal(t.extra.plantedAtMs,prev-259200000);assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('Crystal Block Tree aged `$3`` days'))));assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('audio/spray.wav'))));assert.ok(!other.peer.packets.some(p=>p.includes(Buffer.from('OnTextOverlay'))));
 Object.assign(t,{fg:2,extra:undefined});s.peer.packets=[];spray(228);assert.equal(slot(228).count,2,'non-tree not consumed');assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('Use this on a growing tree'))));
 useConsumable(ctx,s,1488,2,1);assert.equal(slot(1488).count,3,'cannot use XP potion on another player');assert.equal(other.account.progression.xp,0);
 const was=s.account.progression;useConsumable(ctx,s,1488,1,1);assert.equal(slot(1488).count,2);assert.ok(was.level>1,'ten thousand XP advances levels');assert.equal(new ServerContext(db,dir).accounts.get('a').progression.level,was.level);
 Math.random=()=>0.2;s.peer.packets=[];useConsumable(ctx,s,752,1,1);assert.equal(slot(752).count,2);assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('HEADS!'))));Math.random=()=>0.8;s.peer.packets=[];useConsumable(ctx,s,752,1,1);assert.ok(s.peer.packets.some(p=>p.includes(Buffer.from('TAILS!'))));
 console.log('PASS: GTPS3 overlays, sound scope, Oriental Spray, mature/invalid/locked safety, self-only XP potion and coin outcomes');
}finally{Math.random=rng;fs.rmSync(dir,{recursive:true,force:true});}
