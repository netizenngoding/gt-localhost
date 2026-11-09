const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bubble-parity-'));
function load(src){const out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{handleInput}=load('server/action/input.ts'),{handleTileChangeRequest,handleTileActivateRequest}=load('server/gamePacket/tile_change_req.ts');
const ctx=new ServerContext(new ItemDatabase(),tmp);
function session(name,id){const account=normalizeAccount({userId:id,name,rank:'player',inventory:[{itemId:18,count:1},{itemId:32,count:1},{itemId:14,count:5}]});const peer={packets:[],sendPacket(_c,p){this.packets.push(p)},sendDisconnect(){}};const s={peer,account,netId:0,world:null,x:0,y:0,facingLeft:false,mstate:0,smstate:0,cheats:{noclip:false,speed:false,fly:false},pendingEditTile:null,pendingTradeOffer:null,lastItemSearchQuery:''};ctx.sessions.add(s);return s}
function variants(s){return s.peer.packets.filter(p=>p.length>=61&&p[4]===1).map(p=>{let pos=60,count=p[pos++],v=[];for(let i=0;i<count;i++){const ix=p[pos++],t=p[pos++];if(t===2){let len=p.readUInt32LE(pos);pos+=4;v[ix]=p.toString('utf8',pos,pos+len);pos+=len}else if(t===5||t===9){v[ix]=p.readUInt32LE(pos);pos+=4}else if(t===1){v[ix]=p.readFloatLE(pos);pos+=4}else if(t===3){pos+=8}else if(t===4){pos+=12}else throw Error('type '+t)}return {net:p.readInt32LE(8),v}})}
const all=(s,k)=>variants(s).filter(p=>p.v[0]===k),reset=(...ss)=>ss.forEach(s=>{s.peer.packets.length=0;s.chatTimestamps=[]});
const a=session('Alpha',100),b=session('Beta',101),c=session('Else',102);
ctx.joinWorld(a,'TEST');reset(a);ctx.joinWorld(b,'TEST');
assert.ok(all(a,'OnTalkBubble').some(p=>p.v[1]===b.netId&&p.v[2].includes('entered')&&p.v[3]===1));
assert.ok(all(b,'OnTalkBubble').some(p=>p.v[1]===a.netId&&p.v[2].includes('Alpha')&&p.v[3]===1));
assert.ok(!all(b,'OnTalkBubble').some(p=>p.v[1]===b.netId&&p.v[2].includes('entered')));
ctx.joinWorld(c,'OTHER');reset(a,b,c);const world=a.world,idx=world.tiles.findIndex(t=>t.fg===8);const tx=idx%world.width,ty=Math.floor(idx/world.width);a.x=tx*32;a.y=ty*32;
handleTileChangeRequest(ctx,a,{value:18,punchX:tx,punchY:ty});let bubbles=all(a,'OnTalkBubble');assert.equal(bubbles.length,1);assert.deepEqual(bubbles[0].v,['OnTalkBubble',a.netId,"It's too strong to break.",0,1]);assert.equal(all(b,'OnTalkBubble').length,0);assert.equal(all(c,'OnTalkBubble').length,0);
reset(a,b,c);handleInput(ctx,a,'Hello friends');for(const s of [a,b])assert.ok(all(s,'OnTalkBubble').some(p=>p.v[1]===a.netId&&p.v[2]==='Hello friends'));assert.equal(all(c,'OnTalkBubble').length,0);
reset(a,b,c);handleInput(ctx,a,'/who');assert.ok(all(a,'OnTalkBubble').some(p=>p.v[1]===b.netId&&p.v[3]===1));assert.equal(all(b,'OnTalkBubble').length,0);assert.ok(all(a,'OnConsoleMessage').some(p=>p.v[1].includes('Alpha')&&p.v[1].includes('Beta')));
reset(a,b,c);handleInput(ctx,a,'/me smiles');for(const s of [a,b])assert.ok(all(s,'OnTalkBubble').some(p=>!p.v[2].includes('player_chat=')&&p.v[2].includes('smiles')));assert.equal(all(c,'OnTalkBubble').length,0);
reset(a,b,c);handleInput(ctx,a,'/facepalm');for(const s of [a,b])assert.ok(all(s,'OnAction').some(p=>p.net===a.netId&&p.v[1]==='/fp'));assert.equal(all(c,'OnAction').length,0);
reset(a,b);handleInput(ctx,a,'/help');const help=all(a,'OnConsoleMessage')[0].v[1];assert.ok(help.includes('/wave')&&help.includes('/time'));assert.ok(!help.includes('/gitem'));handleInput(ctx,a,'/clearinv');assert.ok(all(a,'OnConsoleMessage').some(p=>p.v[1].includes('operator-only')));assert.ok(a.account.inventory.some(x=>x.itemId===14));
// Command echo and errors are private. /middle uses the existing client action.
reset(a,b,c);handleInput(ctx,a,'/middle');
const echoPackets=a.peer.packets.filter(p=>p.readUInt32LE(0)===3).map(p=>p.subarray(4).toString('utf8'));
assert.ok(echoPackets.some(t=>t.includes('action|log\nmsg|')&&t.includes('/middle')));
assert.equal(b.peer.packets.filter(p=>p.readUInt32LE(0)===3).length,0);
for(const s of [a,b])assert.ok(all(s,'OnAction').some(p=>p.net===a.netId&&p.v[1]==='/fuckyou'));
assert.equal(all(c,'OnAction').length,0);
reset(a,b);handleInput(ctx,a,'/nothere');assert.ok(a.peer.packets.some(p=>p.readUInt32LE(0)===3&&p.includes(Buffer.from('/nothere'))));
assert.ok(all(a,'OnConsoleMessage').some(p=>p.v[1]==="`4Unknown command.`` Enter `$/?`` for a list of valid commands."));
assert.equal(b.peer.packets.length,0);
reset(a,b,c);handleInput(ctx,a,'/msg Beta hi there');assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('/msg Beta hi there'))));assert.ok(all(b,'OnConsoleMessage').some(p=>p.v[1].includes('hi there')));assert.equal(c.peer.packets.length,0);
// Fifth chat in five seconds is blocked only for the sender, without executing.
reset(a,b);for(let i=0;i<5;i++)handleInput(ctx,a,'/wave');assert.equal(all(b,'OnAction').length,4);assert.ok(a.peer.packets.some(p=>p.includes(Buffer.from('Spam detected!'))));reset(a,b);
// Do not overwrite an existing background, nor let distant clients set checkpoint.
reset(a,b);world.tiles[idx]={fg:0,bg:2,parentIndex:0,flags:0};handleTileChangeRequest(ctx,a,{value:14,punchX:tx,punchY:ty});assert.equal(world.tiles[idx].bg,2);world.tiles[0]={fg:23,bg:0,parentIndex:0,flags:0};a.account.spawnWorld=undefined;handleTileActivateRequest(ctx,a,{punchX:0,punchY:0});assert.equal(a.account.spawnWorld,undefined);
console.log('PASS: join bubble recipients, private bedrock, public chat/me, private who, emote protocol, help permissions, background and activation guards');fs.rmSync(tmp,{recursive:true,force:true});
