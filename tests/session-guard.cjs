const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),vm=require('vm'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'session-guard-'));
try{
 const out=path.join(dir,'guard.cjs');esbuild.buildSync({entryPoints:['server/security/session-guard.ts'],outfile:out,bundle:true,platform:'node'});const {SessionGuard}=require(out);
 const g=new SessionGuard(),presence=b=>Buffer.from(JSON.stringify({type:'client-presence',v:1,background:b}));
 assert.ok(g.presence(presence(true)));for(const t of [0,3,7,10,11])assert.equal(g.game(t),false);
 assert.ok(g.game(22));assert.ok(g.game(21));assert.ok(!g.text('action|input\ntext|/gitem 2',true));assert.ok(!g.text('action|dialog_return\ndialog_name|store',true));assert.ok(!g.text('action|join_request\nname|FARM',true));assert.ok(g.text('action|quit_to_exit',true));
 assert.ok(!g.presence(Buffer.from('{bad')));assert.ok(!g.presence(Buffer.from(JSON.stringify({type:'client-presence',v:1,background:'false'}))));assert.equal(g.background,true);
 assert.ok(g.presence(presence(false)));let allowed=0;for(let i=0;i<1000;i++)allowed+=g.game(3)?1:0;assert.ok(allowed<=17,'lying about focus must not bypass interaction cap');
 const h=new SessionGuard();for(let i=0;i<4;i++)assert.ok(h.allow('bucket',2,4,1000));assert.ok(!h.allow('bucket',2,4,1000));assert.ok(h.allow('bucket',2,4,1500));assert.ok(!h.allow('bucket',2,4,1500));
 const listeners={},docListeners={},intervals=[],workers=[],events=[],sent=[];let hidden=false,focus=true,now=1000,paused=0,resumed=0,ticks=0;
 class WS{constructor(){this.readyState=1;this.listeners={};}addEventListener(k,f){this.listeners[k]=f}send(x){sent.push(JSON.parse(x))}}
 class Worker{constructor(){workers.push(this)}terminate(){this.dead=true}}
 const env={WebSocket:WS,Worker,Blob:class{},URL:class extends URL{static createObjectURL(){return'blob:test'}static revokeObjectURL(){}},location:{href:'https://test.example/'},console,document:{get hidden(){return hidden},hasFocus:()=>focus,addEventListener(k,f){docListeners[k]=f}},addEventListener(k,f){listeners[k]=f},setInterval(f){intervals.push(f);return intervals.length},clearInterval(){},performance:{now:()=>now},MainLoop:{func(){ticks++},scheduler(){},queue:[],pause(){paused++;this.scheduler=null},resume(){resumed++;this.scheduler=()=>{}},runIter(f){f()}},Module:{ctx:{clear(){},drawArrays(){},drawElements(){}},canvas:{getBoundingClientRect:()=>({left:0,top:0})}},SDL:{events:[{type:'keydown'},{type:'network'},{type:'mousedown'}],keyboardMap:{97:65},DOMButtons:[1,0,0],buttonState:1,downFingers:{},receiveEvent(e){events.push(e);if(e.type==='keyup')this.keyboardMap={};if(e.type==='mouseup'){this.buttonState=0;this.DOMButtons=[0,0,0]}},savedKeydown:{}}};vm.createContext(env);vm.runInContext(fs.readFileSync('public/WebLoaderData/NativeSession.js','utf8'),env);
 const ws=new env.WebSocket('wss://test.example/enet');env.NativeSession.install();assert.equal(sent.at(-1).background,false);const originalDraw=env.Module.ctx.drawArrays;let suppressed=false;env.MainLoop.func=()=>{ticks++;suppressed=env.Module.ctx.drawArrays!==originalDraw};hidden=true;focus=false;docListeners.visibilitychange();assert.equal(paused,1);assert.equal(sent.at(-1).background,true);assert.ok(events.some(e=>e.type==='keyup'));assert.ok(events.some(e=>e.type==='mouseup'));assert.equal(env.SDL.events.length,1);assert.equal(env.SDL.events[0].type,'network');assert.equal(ticks,2);assert.ok(suppressed);assert.equal(env.Module.ctx.drawArrays,originalDraw);
 now+=250;workers[0].onmessage();assert.equal(ticks,3);now+=1;workers[0].onmessage();assert.equal(ticks,3,'bounded update frequency');docListeners.visibilitychange();assert.equal(paused,1,'no duplicate loop');
 hidden=false;focus=true;docListeners.visibilitychange();assert.equal(resumed,1);assert.ok(workers[0].dead);assert.equal(sent.at(-1).background,false);docListeners.visibilitychange();assert.equal(resumed,1);
 assert.ok(!events.some(e=>e.type==='keydown'),'never generates gameplay presses');
 const receiveOut=path.join(dir,'receive.cjs');esbuild.buildSync({entryPoints:['server/eventType/receive.ts'],outfile:receiveOut,bundle:true,platform:'node'});const {onPeerReceive}=require(receiveOut);
 const packets=[],guard=new SessionGuard();guard.background=true;const peer={activity:guard,userData:{world:{}},sendPacket(_c,p){packets.push(p)}};peer.userData.peer=peer;
 const ctx=new Proxy({},{get(){throw Error('background action reached game state')}});
 const tank=Buffer.alloc(60);tank.writeUInt32LE(4);tank[4]=3;onPeerReceive(ctx,peer,0,tank);assert.equal(packets.length,0);
 const text=Buffer.concat([Buffer.from([2,0,0,0]),Buffer.from('action|input\ntext|/gitem 2\0')]);onPeerReceive(ctx,peer,0,text);assert.equal(packets.length,0);
 tank[4]=22;onPeerReceive(ctx,peer,0,tank);assert.equal(packets.length,1);assert.equal(packets[0][4],21);
 console.log('PASS: background action denial, transport ping allowance, bounded foreground actions even with forged focus, strict presence, input release, worker ticks, single loop resume, no synthesized gameplay');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
