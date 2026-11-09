const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'join-outfit-'));
function load(src){let out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out)}
const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{buildSetClothingPacket}=load('server/onVariant/OnSetClothing.ts');
const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),wait=ms=>new Promise(r=>setTimeout(r,ms));
function player(n,id){const account=normalizeAccount({userId:id,name:n,inventory:[{itemId:18,count:1,equipped:false},{itemId:32,count:1,equipped:false},{itemId:44,count:1,equipped:true},{itemId:36,count:1,equipped:true}]});const peer={packets:[],sendPacket(_c,p){this.packets.push(p)}};const session={peer,account,netId:0,world:null,x:0,y:0,facingLeft:false,mstate:0,smstate:0,cheats:{noclip:false,speed:false,fly:false},pendingEditTile:null,pendingTradeOffer:null,lastItemSearchQuery:''};ctx.sessions.add(session);return session;}
const clothes=(p,id)=>p.peer.packets.filter(q=>q.includes(Buffer.from('OnSetClothing'))&&q.readInt32LE(8)===id);
(async()=>{
 const a=player('First',100),b=player('Second',101);ctx.joinWorld(a,'TEST');await wait(250);a.peer.packets.length=0;ctx.joinWorld(b,'TEST');
 assert.equal(clothes(a,b.netId).length,1);assert.equal(clothes(b,a.netId).length,1);
 await wait(250);assert.ok(clothes(a,b.netId).length>=2);assert.ok(clothes(b,a.netId).length>=2);
 // Change the outfit before the later retry; it must send current, not stale, state.
 b.account.inventory.find(s=>s.itemId===44).equipped=false;
 await wait(1100);assert.ok(clothes(a,b.netId).some(p=>p.equals(buildSetClothingPacket(b,db,false))),'retry must use current outfit');
 await wait(1800);assert.ok(clothes(a,b.netId).length>=4,'longer retries reach slow peers');
 ctx.leaveCurrentWorld(b,false);let count=clothes(a,b.netId).length;await wait(1200);assert.equal(clothes(a,b.netId).length,count,'no packets after player leaves');
 console.log('PASS: two-way spawn sync, slow-client retries, current equipment, and leave guard');fs.rmSync(tmp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1});
