const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gt-virus-'));const rand=Math.random;
function load(src){const o=path.join(dir,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:o,bundle:true,platform:'node'});return require(o)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts'),{useConsumable,expireMods}=load('server/playmods/service.ts'),{handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts'),{handleInput}=load('server/action/input.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,dir);
 function player(name,id,x){const a=normalizeAccount({userId:id,name}),s={account:a,netId:id,x,y:32,world:null,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.accounts.set(name.toLowerCase(),a);ctx.sessions.add(s);ctx.joinWorld(s,'VIRUS');s.x=x;s.y=32;return s}
 const a=player('A',1,32),b=player('B',2,64),c=player('C',3,96);for(const id of [764,782,196])a.account.inventory.push({itemId:id,count:5,equipped:false});
 const infected=s=>s.account.playmods.some(m=>m.id==='gtps3-infected'),antidote=s=>s.account.playmods.some(m=>m.id==='gtps3-antidote');
 useConsumable(ctx,a,764,1,1);assert.ok(infected(a));let state=buildCharacterStateForSession(a,db);assert.ok(state.stateFlags&(1<<16));assert.equal(state.moveSpeed,150);
 handleTileChangeRequest(ctx,a,{value:18,punchX:2,punchY:1});assert.ok(infected(b),'punch transmits to player on selected tile');assert.ok(!infected(c));assert.ok(b.peer.packets.some(p=>p.includes(Buffer.from('OnAddNotification'))));
 useConsumable(ctx,a,196,2,1);assert.ok(b.account.playmods.some(m=>m.id==='blue'));useConsumable(ctx,a,782,2,1);assert.ok(!infected(b)&&antidote(b));assert.ok(!b.account.playmods.some(m=>m.id==='blue'),'GTPS3 antidote cures supported transformation mods');
 a.lastInfectPunchAt=0;handleTileChangeRequest(ctx,a,{value:18,punchX:2,punchY:1});assert.ok(!infected(b),'immunity blocks punch');
 useConsumable(ctx,a,764,2,1);assert.ok(!infected(b),'GTPS3 antidote remains effective against direct use');
 Math.random=()=>0;a.peer.packets=[];b.peer.packets=[];handleInput(ctx,a,'hello');assert.ok(b.peer.packets.some(p=>p.includes(Buffer.from('Brraaiinnss...hello'))));
 assert.ok(new ServerContext(db,dir).accounts.get('b').playmods.some(m=>m.id==='gtps3-antidote'));
 for(const m of a.account.playmods)m.expiresAt=Date.now()-1;expireMods(ctx);assert.ok(!infected(a));assert.equal(buildCharacterStateForSession(a,db).moveSpeed,250);
 console.log('PASS: GTPS3 virus, punch infection, antidote, chat, state, expiry and persistence');
}finally{Math.random=rand;fs.rmSync(dir,{recursive:true,force:true})}
