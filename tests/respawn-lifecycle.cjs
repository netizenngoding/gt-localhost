const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'respawn-')),out=path.join(dir,'context.cjs'),outMove=path.join(dir,'moving.cjs');
esbuild.buildSync({entryPoints:['server/database/context.ts'],outfile:out,bundle:true,platform:'node'});const {ServerContext}=require(out);
esbuild.buildSync({entryPoints:['server/gamePacket/player_moving.ts'],outfile:outMove,bundle:true,platform:'node'});const {handlePlayerMoving}=require(outMove);
const calls=[],scheduled=[],native=setTimeout;global.setTimeout=(fn,ms)=>{scheduled.push({fn,ms});return {unref(){}}};
try{
 let c=Object.create(ServerContext.prototype);c.sessions=new Set();let peer={sendPacket(_c,p){calls.push(p)}};let w={name:'TEST',width:2,height:2,tiles:[{fg:6},{fg:0},{fg:0},{fg:4}],peers:new Set()},s={peer,world:w,netId:5,x:0,y:0,account:{inventory:[]}};c.sessions.add(s);w.peers.add(s);
 c.itemsDb={get(id){if(id===4)return {id:4,actionType:16,isHazard:true};if(id===358)return {id:358,actionType:6,isHazard:true};return undefined;}};
 c.respawnPlayer(s);assert.ok(calls[0].includes(Buffer.from('OnSetFreezeState')));assert.ok(calls[1].includes(Buffer.from('OnKilled')));assert.deepEqual(scheduled.map(x=>x.ms),[2000,2020]);let n=calls.length;c.respawnPlayer(s);assert.equal(calls.length,n);scheduled[0].fn();assert.ok(calls.some(p=>p.includes(Buffer.from('OnSetPos'))));assert.ok(calls.some(p=>p.includes(Buffer.from('OnSetPearl'))));scheduled[1].fn();assert.equal(s.respawnUntil,0);n=calls.length;c.respawnPlayer(s);s.world=null;scheduled[2].fn();scheduled[3].fn();assert.equal(calls.length,n+2);
 // Verify Lava HP bar depletion: 4 hits (100->80->60->40->20) do NOT kill, 5th hit (0) triggers OnKilled/respawn.
 s.world=w;s.respawnUntil=0;s.hp=100;s.lastHazardHitAt=0;calls.length=0;scheduled.length=0;
 const realNow=Date.now;let fakeNow=10000;Date.now=()=>fakeNow;
 try{
  for(const expectedHp of [80,60,40,20]){
   fakeNow+=500;
   handlePlayerMoving(s,Buffer.alloc(60),{x:0,y:0,flags:0x40},c);
   assert.equal(s.hp,expectedHp);
   assert.ok(calls.some(p=>p.includes(Buffer.from('OnSetPearl'))));
   assert.ok(!calls.some(p=>p.includes(Buffer.from('OnKilled'))),'must not die before HP bar is empty');
  }
  // Test HP regeneration when out of hazard for >=3s
  fakeNow+=3100;
  handlePlayerMoving(s,Buffer.alloc(60),{x:0,y:0,flags:0},c);
  assert.equal(s.hp,40,'regenerates +20 after 3s out of hazard');
  // Deplete remaining 40 HP (40 -> 20 -> 0 -> death)
  fakeNow+=500;
  handlePlayerMoving(s,Buffer.alloc(60),{x:0,y:0,flags:0x40},c);
  assert.equal(s.hp,20);
  assert.ok(!calls.some(p=>p.includes(Buffer.from('OnKilled'))));
  fakeNow+=500;
  handlePlayerMoving(s,Buffer.alloc(60),{x:0,y:0,flags:0x40},c);
  assert.ok(calls.some(p=>p.includes(Buffer.from('OnKilled'))),'dies when HP bar reaches 0');
  assert.equal(s.hp,100,'respawn resets HP to 100');
 }finally{Date.now=realNow;}
 console.log('PASS: respawn freeze/death, delayed position/unfreeze, duplicate and leave guards, lava HP bar depletion and regen');
}finally{global.setTimeout=native;fs.rmSync(dir,{recursive:true,force:true})}
