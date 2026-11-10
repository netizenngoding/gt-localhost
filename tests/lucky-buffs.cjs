const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lucky-buffs-'));const rand=Math.random;
function load(src){const out=path.join(tmp,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{activeMods,normalizeMods}=load('server/playmods/model.ts'),{useConsumable}=load('server/playmods/service.ts'),{handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts'),{recordProgress}=load('server/progression/service.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),a=normalizeAccount({userId:1,name:'A'}),s={account:a,netId:1,x:32,y:32,world:null,cheats:{},peer:{sendPacket(){}}};ctx.accounts.set('a',a);ctx.sessions.add(s);ctx.joinWorld(s,'LUCK');s.x=32;s.y=32;
 for(const id of [528,750,1056,4348,4324]){assert.equal(db.get(id).actionType,8);a.inventory.push({itemId:id,count:2,equipped:false})}
 let eat=id=>useConsumable(ctx,s,id,1,1);Math.random=()=>0.99;eat(528);assert.deepEqual(activeMods(a).filter(d=>d.group==='luck').map(d=>d.id),['lucky-528']);eat(750);assert.deepEqual(activeMods(a).filter(d=>d.group==='luck').map(d=>d.id),['lucky-750']);eat(1056);assert.deepEqual(activeMods(a).filter(d=>d.group==='luck').map(d=>d.id),['lucky-1056']);
 let modList=normalizeMods([...a.playmods,{id:'lucky-528',expiresAt:Date.now()+10000}]);assert.equal(modList.filter(m=>m.id.startsWith('lucky-')).length,1);
 let w=s.world,t=w.tiles[w.width+3];const breakDirt=()=>{Object.assign(t,{fg:2,bg:0,flags:0,damage:0,extra:undefined});w.objects=[];for(let i=0;i<db.get(2).breakHits;i++)handleTileChangeRequest(ctx,s,{value:18,punchX:3,punchY:1});assert.equal(t.fg,0);};
 Math.random=()=>0;breakDirt();assert.equal(w.objects.filter(o=>o.itemId===112).reduce((n,o)=>n+o.count,0),5);assert.equal(w.objects.filter(o=>o.itemId===2).reduce((n,o)=>n+o.count,0),2,'one normal block and one extra');
 a.playmods=[];eat(4348);Math.random=()=>0;breakDirt();assert.equal(w.objects.filter(o=>o.itemId===112).reduce((n,o)=>n+o.count,0),2,'double gems');
 eat(4324);a.progression.level=1;a.progression.xp=0;Math.random=()=>0.49;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,20);Math.random=()=>0.5;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,30);
 let reloaded=new ServerContext(db,tmp).accounts.get('a');assert.ok(activeMods(reloaded).some(d=>d.id==='biotronic-xp'));
 console.log('PASS: lucky sources exclusive, bonus blocks/gems, Gemmin Juice, Biotronic XP threshold and persistence');
}finally{Math.random=rand;fs.rmSync(tmp,{recursive:true,force:true})}
