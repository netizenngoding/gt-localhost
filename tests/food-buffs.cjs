const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gt-food-'));
function load(src){const out=path.join(dir,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
const random=Math.random;
try {
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts');
 const {normalizeAccount}=load('server/database/peer.ts'),{useConsumable,expireMods}=load('server/playmods/service.ts');
 const {activeMods,normalizeMods}=load('server/playmods/model.ts'),{hasEnhancedDigging}=load('server/playmods/equipment.ts');
 const {recordProgress}=load('server/progression/service.ts'),{handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,dir),a=normalizeAccount({userId:1,name:'FoodTest'});
 const s={account:a,netId:1,world:null,x:32,y:32,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.accounts.set('foodtest',a);ctx.sessions.add(s);ctx.joinWorld(s,'FOOD');s.x=32;s.y=32;
 for(const id of [4594,4604,1474,5452,4768,12156]){assert.equal(db.get(id).actionType,8);a.inventory.push({itemId:id,count:2,equipped:false});}
 const eat=id=>useConsumable(ctx,s,id,1,1);const id=()=>activeMods(a).filter(x=>x.group==='food').map(x=>x.id);
 Math.random=()=>0.99;
 eat(4594);assert.deepEqual(id(),['food-tree-growth']);assert.ok(a.playmods[0].expiresAt>Date.now()+1799000);
 const w=s.world,at=(x,y)=>w.tiles[y*w.width+x],t=at(3,1);Object.assign(t,{fg:0,bg:0,flags:0,extra:undefined});Object.assign(at(3,2),{fg:2,bg:0});a.inventory.push({itemId:101,count:2,equipped:false});
 const time=Date.now(),realTimeout=global.setTimeout;let maturityDelay;try{global.setTimeout=(fn,ms)=>{maturityDelay=ms;return {unref(){}}};handleTileChangeRequest(ctx,s,{value:101,punchX:3,punchY:1});}finally{global.setTimeout=realTimeout;}assert.ok(Math.abs(maturityDelay-(68000*.95+200))<2);assert.equal(t.fg,101);assert.ok(Math.abs(t.extra.plantedAtMs-(time-3400))<100);assert.equal(t.extra.kind,'seed');ctx.savePersistentState();assert.equal(new ServerContext(db,dir).worlds.get('FOOD').tiles[w.width+3].extra.plantedAtMs,t.extra.plantedAtMs,'discount survives reload');
 eat(4604);assert.deepEqual(id(),['food-breaking-gems']);assert.equal(normalizeMods([...a.playmods,{id:'food-tree-growth',expiresAt:Date.now()+10000}]).filter(m=>m.id.startsWith('food-')).length,1);
 Object.assign(at(4,1),{fg:2,bg:0,damage:0,extra:undefined});let b=at(4,1);Math.random=()=>0.05;let before=w.objects.filter(o=>o.itemId===112).reduce((n,o)=>n+o.count,0);for(let k=0;k<db.get(2).breakHits;k++)handleTileChangeRequest(ctx,s,{value:18,punchX:4,punchY:1});assert.equal(b.fg,0);let after=w.objects.filter(o=>o.itemId===112).reduce((n,o)=>n+o.count,0);assert.equal(after-before,2,'one guaranteed test food gem and one ordinary random gem');
 eat(1474);assert.deepEqual(id(),['food-xp-eggs']);a.progression.xp=0;Math.random=()=>0.24;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,20);Math.random=()=>0.25;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,30);Math.random=()=>0;recordProgress(ctx,s,undefined,0,10);assert.equal(a.progression.xp,40,'administrative XP has no food bonus');
 eat(5452);assert.deepEqual(id(),['food-xp-gingerbread']);a.progression.xp=0;Math.random=()=>0.09;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,30);Math.random=()=>0.1;recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,40);
 eat(4768);assert.deepEqual(id(),['food-consumable-xp']);a.progression.xp=0;recordProgress(ctx,s,'consumables_used',1,10);assert.equal(a.progression.xp,30);recordProgress(ctx,s,'blocks_placed',1,10);assert.equal(a.progression.xp,40);
 eat(12156);assert.equal(hasEnhancedDigging(a),true);assert.deepEqual(id(),['food-consumable-xp'],'punch biscuit is a separate mod');let saved=new ServerContext(db,dir).accounts.get('foodtest');assert.ok(activeMods(saved).some(m=>m.id==='truffle-punch-damage'));
 a.playmods.find(x=>x.id==='truffle-punch-damage').expiresAt=Date.now()-1;expireMods(ctx);assert.equal(hasEnhancedDigging(a),false);a.playmods.find(x=>x.id==='food-consumable-xp').expiresAt=Date.now()-1;expireMods(ctx);assert.deepEqual(id(),[]);
 console.log('PASS: six consumables, food exclusivity, 5% seed deadline, break gem chance, XP thresholds, admin XP exclusion, damage, expiry and persistence');
}finally{Math.random=random;fs.rmSync(dir,{recursive:true,force:true});}
