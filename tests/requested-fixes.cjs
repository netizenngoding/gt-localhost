const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
function load(file) {
  const code = esbuild.buildSync({entryPoints:[file], bundle:true, platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const m={exports:{}};
  vm.runInNewContext(code,{module:m,exports:m.exports,require,process,Buffer,console,setTimeout,Date,Math:Object.assign(Object.create(Math),{random:()=>0.99})});
  return m.exports;
}
const {handleTileChangeRequest} = load('server/gamePacket/tile_change_req.ts');
const packets=[];
const tile={fg:0,bg:0,flags:0,damage:0};
const world={width:1,height:1,tiles:[tile],ownerUserId:0,peers:new Set()};
const session={netId:1,x:0,y:0,world,account:{userId:1,inventory:[{itemId:6,count:2}]},peer:{sendPacket(c,p){packets.push(p)}}};
world.peers.add(session);
const consumed=[];
const defs=new Map([[6,{id:6,isDoor:true}],[18,{id:18}],[3,{id:3,isSeed:true,growTime:1}]]);
const ctx={itemsDb:{get:id=>defs.get(id)},consumeInventoryItem(...args){consumed.push(args)}};
handleTileChangeRequest(ctx,session,{value:6,punchX:0,punchY:0});
assert.deepEqual(packets.map(p=>p[4]),[3,5]);
assert.equal(consumed.length,1);
assert.equal(consumed[0][3],false);
assert.ok(!packets.some(p=>p.includes(Buffer.from('audio/punch.wav'))));
packets.length=0;
tile.fg=3; tile.extra={kind:'seed',plantedAtMs:Date.now()-5000,fruitCount:1};
// No block/drop definition in this fixture: test the harvest event + tile clearing.
defs.get(3).isSeed=false;
handleTileChangeRequest(ctx,session,{value:18,punchX:0,punchY:0});
assert.equal(packets[0][4],12);
assert.equal(packets[0].readInt32LE(12),-1);
assert.equal(packets[1][4],5);
assert.equal(tile.fg,0);
assert.ok(!packets.some(p=>p.includes(Buffer.from('levelup'))));
const source=fs.readFileSync('public/WebLoaderData/RTLoader.js','utf8');
const start=source.indexOf('function isNativeGameplayInputActive()');
const end=source.indexOf('// ============================================================================\n// 6.',start);
const entities={WorldSpecificGUI:{exists:true,visible:true},OptionsMenu:{exists:true,visible:false},InputMenu:{exists:true,visible:true}};
const listeners={};
const sandbox={isMobileClient:()=>false,Module:{SDL:{textInput:true}},document:{activeElement:null,addEventListener(){}},window:{GameSDK:{ready:true,root:{exists:true,find:n=>entities[n]||{exists:false}}},addEventListener(n,cb){listeners[n]=cb}},activePhysicalToVirtual:{},nativeHotkeyMenuOpen:false};
vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
assert.equal(sandbox.isNativeGameplayInputActive(),true);
entities.OptionsMenu.visible=true;
assert.equal(sandbox.isNativeGameplayInputActive(),false);
entities.OptionsMenu.visible=false;
sandbox.document.activeElement={tagName:'INPUT'};
assert.equal(sandbox.isNativeGameplayInputActive(),false);
sandbox.document.activeElement=null;
sandbox.activePhysicalToVirtual.KeyQ={keyCode:87,key:'w',code:'KeyW'};
sandbox.nativeHotkeyMenuOpen=true;
const event={type:'keyup',code:'KeyQ'};
sandbox.handlePcKeyboardIntercept(event);
assert.equal(event.keyCode,87);
assert.equal(Object.keys(sandbox.activePhysicalToVirtual).length,0);
for(const file of ['server/commands/player_commands.ts','server/commands/index.ts','server/action/wrench.ts','server/action/dialog_return/player_dialogs.ts']) {
 assert.doesNotMatch(fs.readFileSync(file,'utf8'),/cmd === "nick"|\/nick|acct_setnick|nick_new/);
}
console.log('PASS: placement packet sequence, inventory decrement, harvest clear, keyboard focus/release, nickname removal');
// Splicing: a successful splice must not synthesize a progression jingle.
packets.length=0;
tile.fg=3; tile.extra={kind:'seed',plantedAtMs:Date.now(),fruitCount:1};
defs.set(3,{id:3,isSeed:true,growTime:60,name:'Dirt Seed'});
defs.set(5,{id:5,isSeed:true,growTime:60,name:'Rock Seed'});
// Keep fixture timers disabled: >300 seconds avoids the production maturity timer.
defs.set(7,{id:7,isSeed:true,growTime:600,name:'Result Seed'});
defs.set(6,{id:6,name:'Result'});
ctx.itemsDb.findSpliceSeed=()=>7;
session.account.inventory=[{itemId:5,count:2}];
handleTileChangeRequest(ctx,session,{value:5,punchX:0,punchY:0});
assert.equal(tile.fg,7);
assert.equal(tile.extra.spliced,true);
assert.equal(packets.filter(p=>p.includes(Buffer.from('audio/success.wav'))).length,1);
assert.ok(!packets.some(p=>p.includes(Buffer.from('audio/tree_plant.wav'))));
assert.ok(!packets.some(p=>/piano_nice|levelup|achievement/.test(p.toString())));
const encoder=load('server/proton/packet.ts');
for (const [factory,id] of [[encoder.makeAchievementEffectPacket,48],[encoder.makeLevelUpEffectPacket,46]]) {
 const packet=factory(32,64);
 assert.equal(packet[4],17);
 assert.equal(packet.readFloatLE(40),id);
 assert.equal(packet.readUInt32LE(24),0);
 assert.equal(packet.readFloatLE(28),32);
 assert.equal(packet.readFloatLE(32),64);
}
const particle=encoder.makeParticleEffectPacket(48,10,20,1.25,500);
assert.equal(particle.readFloatLE(36),1.25);
assert.equal(particle.readUInt32LE(24),500);
console.log('PASS: splice single success cue; distinct native achievement/level-up encoders and particle offsets');

// SDK strings from threaded WASM must be copied before TextDecoder reads them.
const shared=new Uint8Array(new SharedArrayBuffer(8));
shared.set([116,101,115,116]);
assert.equal(new TextDecoder().decode(shared.slice(0,4)), 'test');
const sdkSource=fs.readFileSync('public/WebLoaderData/GameSDK.js','utf8');
assert.doesNotMatch(sdkSource,/utf8Dec\.decode\(u8\.subarray/);
console.log('PASS: persistent InputMenu does not block keys; shared-memory strings use copied bytes');

// Protocol bytes and rejection branches: no success sound outside successful splicing.
for (const kind of ['invalid-recipe','mature','already-spliced','no-inventory']) {
 packets.length=0; const previousConsumes=consumed.length;
 tile.fg=3; tile.extra={kind:'seed',plantedAtMs:Date.now(),fruitCount:1,spliced:false};
 session.account.inventory=[{itemId:5,count:2}];
 ctx.itemsDb.findSpliceSeed=()=>kind==='invalid-recipe'?null:7;
 if(kind==='mature')tile.extra.plantedAtMs=Date.now()-120000;
 if(kind==='already-spliced')tile.extra.spliced=true;
 if(kind==='no-inventory')session.account.inventory=[];
 handleTileChangeRequest(ctx,session,{value:5,punchX:0,punchY:0});
 assert.ok(!packets.some(p=>p.includes(Buffer.from('audio/success.wav'))),kind);
 assert.equal(consumed.length,previousConsumes,kind);
}
// A fresh seed uses the native placement packet; no extra success sound is sent.
packets.length=0; tile.fg=0;tile.extra=undefined;
world.height=2;world.tiles.push({fg:2,bg:0,flags:0,damage:0});
defs.set(2,{id:2,collisionType:1});defs.get(3).growTime=600;
session.account.inventory=[{itemId:3,count:2}];
handleTileChangeRequest(ctx,session,{value:3,punchX:0,punchY:0});
assert.equal(tile.fg,3);
assert.equal(packets.filter(p=>p.readUInt32LE(0)===4&&p[4]===3).length,1);
assert.ok(!packets.some(p=>/success\.wav|piano_nice|levelup/.test(p.toString())));
console.log('PASS: invalid/mature/repeated/no-inventory cases; ordinary planting unchanged');

packets.length=0;const observerPackets=[];
const observer={peer:{sendPacket(c,p){observerPackets.push(p)}}};
world.peers.add(observer);tile.fg=3;tile.extra={kind:'seed',plantedAtMs:Date.now(),fruitCount:1,spliced:false};
session.account.inventory=[{itemId:5,count:2}];ctx.itemsDb.findSpliceSeed=()=>7;
handleTileChangeRequest(ctx,session,{value:5,punchX:0,punchY:0});
const successes=packets.filter(p=>p.includes(Buffer.from('audio/success.wav')));
assert.equal(successes.length,1);
assert.ok(successes[0].includes(Buffer.from('OnPlayPositioned')));
assert.equal(successes[0].readInt32LE(8),session.netId);
assert.ok(!observerPackets.some(p=>p.includes(Buffer.from('audio/success.wav'))));
console.log('PASS: actor-only success cue, valid positioned callback and avatar net ID');

// Browser run exposed the same shared-memory decoder issue in RTLoader menu hooks.
const rt=fs.readFileSync('public/WebLoaderData/RTLoader.js','utf8');
const rs=rt.indexOf('  function readStdString(sPtr)');
const re=rt.indexOf('\n  }',rs)+4;
const heap=new SharedArrayBuffer(256),u8=new Uint8Array(heap),u32=new Uint32Array(heap);
const decoderCtx={Module:{HEAPU8:u8,HEAPU32:u32},utf8Dec:new TextDecoder()};
vm.createContext(decoderCtx);vm.runInContext(rt.slice(rs,re),decoderCtx);
u8.set(Buffer.from('abc'),16);u8[27]=3;
assert.equal(decoderCtx.readStdString(16),'abc');
u32[8]=64;u32[9]=20;u8[43]=128;u8.set(Buffer.from('abcdefghijklmnopqrst'),64);
assert.equal(decoderCtx.readStdString(32),'abcdefghijklmnopqrst');
console.log('PASS: RTLoader short/long menu strings decode from shared WASM heap');
