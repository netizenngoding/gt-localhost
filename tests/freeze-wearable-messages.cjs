const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'freeze-msg-'));function load(src){let out=path.join(tmp,src.replaceAll('/','_')+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts');
 const {toggleWearableItem}=load('server/gamePacket/item_activate.ts'),{handlePlayerMoving}=load('server/gamePacket/player_moving.ts'),{useConsumable,gtps3PlaymodTime}=load('server/playmods/service.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp);
 function create(id){let s={account:normalizeAccount({userId:id,name:`Player${id}`}),netId:id,world:null,x:64,y:64,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(Buffer.from(p))}}};ctx.sessions.add(s);ctx.accounts.set(s.account.name.toLowerCase(),s.account);ctx.joinWorld(s,'TEST');s.x=id*32;s.y=32;return s}
 let a=create(1),b=create(2);a.account.inventory.push({itemId:1368,count:1,equipped:false});b.peer.packets=[];useConsumable(ctx,a,1368,2,1);
 assert.ok(buildCharacterStateForSession(b,db).stateFlags&(1<<11));
 assert.ok(b.peer.packets.some(p=>p.includes(Buffer.from('mod added'))&&p.includes(Buffer.from('2 secs'))));
 b.peer.packets=[];a.peer.packets=[];for(let i=0;i<12;i++)handlePlayerMoving(b,Buffer.alloc(60),{x:64,y:32+i*3});
 assert.equal(b.y,65);assert.ok(!b.peer.packets.some(p=>p.includes(Buffer.from('OnSetPos'))));assert.equal(a.peer.packets.length,12);
 assert.equal(gtps3PlaymodTime(0),'Removing now ');assert.equal(gtps3PlaymodTime(2),'2 secs ');assert.equal(gtps3PlaymodTime(60),'1 mins ');assert.equal(gtps3PlaymodTime(3600),'1 hours ');assert.equal(gtps3PlaymodTime(3662),'1 hours, 1 mins, 2 secs ');
 a.account.inventory.push({itemId:496,count:1,equipped:false},{itemId:3894,count:1,equipped:false});a.peer.packets=[];toggleWearableItem(ctx,a,496);assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('You move faster.'))&&p.includes(Buffer.from('mod added'))));
 a.peer.packets=[];toggleWearableItem(ctx,a,3894);assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('mod removed'))));assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('mod added'))));
 a.peer.packets=[];toggleWearableItem(ctx,a,3894);assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('mod removed'))));
 console.log('PASS: frozen falling packets relayed without OnSetPos loop, native state bit, GTPS3 duration text, source-table equip/swap/remove console messages');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
