const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gameplay-actions-'));
function load(src){const out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),a=normalizeAccount({userId:1,name:'Actions'}),s={account:a,peer:{sendPacket(){}},netId:1,x:0,y:0,world:null,cheats:{},mstate:0,smstate:0};ctx.accounts.set('actions',a);ctx.sessions.add(s);ctx.joinWorld(s,'ACTIONS');s.x=32;s.y=32;
 const w=s.world,t=w.tiles[w.width+3];Object.assign(t,{fg:0,bg:0,flags:0,extra:undefined});a.inventory.push({itemId:2,count:5,equipped:false});
 const use=id=>handleTileChangeRequest(ctx,s,{value:id,punchX:3,punchY:1});
 use(2);assert.equal(t.fg,2);assert.equal(a.progression.counters.blocks_placed,1);use(2);assert.equal(a.progression.counters.blocks_placed,1,'occupied placement rejected');
 a.inventory.push({itemId:98,count:1,equipped:true});const hits=Math.max(1,db.get(2).breakHits-1);
 for(let i=0;i<hits-1;i++){use(18);assert.equal(t.fg,2);assert.ok(!a.progression.counters.blocks_broken);}
 use(18);assert.equal(t.fg,0);assert.equal(a.progression.counters.blocks_broken,1);assert.equal(a.progression.xp,1);
 Object.assign(t,{fg:8,bg:0,damage:0});use(18);assert.equal(t.fg,8);assert.equal(a.progression.counters.blocks_broken,1);
 Object.assign(t,{fg:0,bg:0,extra:{kind:'lock',ownerUserId:999,adminIds:[],settings:0},flags:0});w.ownerUserId=999;use(2);assert.equal(t.fg,0);assert.equal(a.progression.counters.blocks_placed,1);
 w.ownerUserId=0;t.extra=undefined;a.inventory.push({itemId:2480,count:1,equipped:false});use(2480);assert.equal(t.fg,0);assert.equal(a.inventory.find(i=>i.itemId===2480).count,1,'unsupported consumable not destroyed/placed');
 a.inventory.push({itemId:196,count:1,equipped:false});handleTileChangeRequest(ctx,s,{value:196,punchX:1,punchY:1});assert.equal(a.progression.counters.consumables_used,1);assert.equal(a.playmods[0].id,'blue');
 ctx.savePlayersNow();const reloaded=new ServerContext(db,tmp).accounts.get('actions');assert.equal(reloaded.playmods[0].id,'blue');assert.equal(reloaded.progression.counters.blocks_broken,1);
 console.log('PASS: committed placement only, enhanced-digging break threshold, no XP from unfinished/bedrock/locked requests, unsupported consumable fail-closed, native-path self consumable and restart persistence');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
