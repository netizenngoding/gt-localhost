const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'controls-reach-'));
function load(src){const out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out)}
const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts'),{handleTileChangeRequest,handleTileActivateRequest}=load('server/gamePacket/tile_change_req.ts');
const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),packets=[];
const s={account:normalizeAccount({userId:1001,name:'ReachTest',isGuest:false,inventory:[{itemId:2,count:200,equipped:false},{itemId:98,count:1,equipped:true},{itemId:18,count:1,equipped:false},{itemId:32,count:1,equipped:false}]}),peer:{sendPacket(c,p){packets.push(p)},sendDisconnect(){throw Error('unexpected disconnect')}},netId:1,x:0,y:0,world:null,cheats:{},mstate:255,smstate:255};
ctx.sessions.add(s);ctx.joinWorld(s,'REACHTEST');const w=s.world;s.x=32;s.y=32;
for(const rank of ['player','moderator','developer']){
 s.account.rank=rank;packets.length=0;ctx.sendCharacterState(s);const state=packets.find(p=>p.readUInt32LE(0)===4&&p[4]===20);assert.ok(state);
 assert.equal(state[6],rank==='player'?128:250);assert.equal(state[7],rank==='player'?128:250);
 const helper=buildCharacterStateForSession(s,db);assert.equal(helper.punchRangeTiles,rank==='player'?2:124);assert.equal(helper.buildRangeTiles,rank==='player'?2:124);
 const tx=25,ty=10,t=w.tiles[ty*w.width+tx];Object.assign(t,{fg:0,bg:0,flags:0,extra:undefined,damage:0});
 handleTileChangeRequest(ctx,s,{value:2,punchX:tx,punchY:ty});assert.equal(t.fg,rank==='player'?0:2,'far place '+rank);
 Object.assign(t,{fg:2,bg:0,damage:0,lastHitMs:0});handleTileChangeRequest(ctx,s,{value:18,punchX:tx,punchY:ty});assert.equal(t.damage,rank==='player'?0:1,'far punch '+rank);
 assert.equal(s.world,w);
}
// Pickaxe is not a hidden range grant, including forged client role flags.
s.account.rank='player';let t=w.tiles[10*w.width+10];Object.assign(t,{fg:2,bg:0,damage:0,lastHitMs:0});handleTileChangeRequest(ctx,s,{value:18,punchX:10,punchY:10});assert.equal(t.damage,0);
s.account.rank='developer';const door=w.tiles.findIndex(t=>t.fg===6);handleTileChangeRequest(ctx,s,{value:18,punchX:door%w.width,punchY:Math.floor(door/w.width)});assert.equal(s.world,w);handleTileActivateRequest(ctx,s,{punchX:door%w.width,punchY:Math.floor(door/w.width)});assert.equal(s.world,w);
// Execute the exact native selection helper with shuffled slots irrelevant to it.
const src=fs.readFileSync('public/WebLoaderData/RTLoader.js','utf8'),start=src.indexOf('var consumedToolToggleKeys'),end=src.indexOf('function handlePcKeyboardIntercept',start),heap=new Uint32Array(120000),app=1000,logic=4000;heap[393364>>2]=app;heap[(app+1800)>>2]=logic;heap[(logic+108)>>2]=8000;heap[(logic+140)>>2]=9000;heap[(logic+288)>>2]=18;const calls=[];
const env={Module:{HEAPU32:heap,wasmTable:{get(i){assert.equal(i,1724);return(l,id)=>{assert.equal(l,logic);calls.push(id);heap[(l+288)>>2]=id}}}}};vm.createContext(env);vm.runInContext(src.slice(start,end),env);assert.equal(env.toggleNativeFistWrench(),true);assert.equal(heap[(logic+288)>>2],32);env.toggleNativeFistWrench();assert.equal(heap[(logic+288)>>2],18);heap[(logic+288)>>2]=2;env.toggleNativeFistWrench();assert.equal(heap[(logic+288)>>2],32);assert.deepEqual(calls,[32,18,32]);heap[(logic+140)>>2]=0;assert.equal(env.toggleNativeFistWrench(),false);
assert.ok(src.includes('if (!e.repeat) toggleNativeFistWrench()'));assert.ok(src.indexOf('if (!isNativeGameplayInputActive())')<src.indexOf('if (matched.id === "toggle_wrench")'));assert.ok(src.includes('consumedToolToggleKeys[code]'));
ctx.leaveCurrentWorld(s,false);fs.rmSync(tmp,{recursive:true,force:true});console.log('PASS: native ID toggle, range bytes, Pickaxe no bonus, staff far punch/place, forged flags denied, remote door safety');
