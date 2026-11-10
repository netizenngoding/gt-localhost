const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bubble-parity-'));
function load(src){const out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{handleInput}=load('server/action/input.ts'),{handleTileChangeRequest,handleTileActivateRequest}=load('server/gamePacket/tile_change_req.ts');
const ctx=new ServerContext(new ItemDatabase(),tmp);
function session(name,id){const account=normalizeAccount({userId:id,name,rank:'player',inventory:[{itemId:18,count:1},{itemId:32,count:1},{itemId:14,count:5}]});const peer={packets:[],sendPacket(_c,p){this.packets.push(p)},sendDisconnect(){}};const s={peer,account,netId:0,world:null,x:0,y:0,facingLeft:false,mstate:0,smstate:0,cheats:{noclip:false,speed:false,fly:false},pendingEditTile:null,pendingTradeOffer:null,lastItemSearchQuery:''};ctx.sessions.add(s);return s}
function variants(s){return s.peer.packets.filter(p=>p.length>=61&&p[4]===1).map(p=>{let pos=60,count=p[pos++],v=[];for(let i=0;i<count;i++){const ix=p[pos++],t=p[pos++];if(t===2){let len=p.readUInt32LE(pos);pos+=4;v[ix]=p.toString('utf8',pos,pos+len);pos+=len}else if(t===5||t===9){v[ix]=p.readUInt32LE(pos);pos+=4}else if(t===1){v[ix]=p.readFloatLE(pos);pos+=4}else if(t===3){pos+=8}else if(t===4){pos+=12}else throw Error('type '+t)}return {net:p.readInt32LE(8),v}})}
const all=(s,k)=>variants(s).filter(p=>p.v[0]===k),reset=(...ss)=>ss.forEach(s=>{s.peer.packets.length=0;s.chatTimestamps=[]});
const a=session('Alpha',100),b=session('Beta',101),c=session('Else',102);
a.account.inventory.push({itemId:66,count:1,equipped:true},{itemId:232,count:1,equipped:true});b.account.inventory.push({itemId:354,count:1,equipped:true});
ctx.joinWorld(a,'TEST');ctx.joinWorld(b,'TEST');ctx.joinWorld(c,'OTHER');
const heads=s=>all(s,'OnConsoleMessage').filter(x=>x.v[2]).map(x=>JSON.parse(x.v[2]));
for(const text of ['hello','/me waves']){reset(a,b,c);handleInput(ctx,a,text);for(const s of [a,b]){const h=heads(s);assert.equal(h.length,1);assert.equal(h[0].clothes[0],66);assert.equal(h[0].clothes[4],232);assert.ok(all(s,'OnTalkBubble').every(x=>!x.v.some(v=>typeof v==='string'&&v.includes('`o`o`o'))));}assert.equal(heads(c).length,0);}
reset(a,b,c);handleInput(ctx,a,'/msg Beta private');assert.equal(heads(b)[0].clothes[0],66);assert.equal(heads(a)[0].clothes[0],354);assert.equal(heads(c).length,0);assert.equal(all(b,'OnTalkBubble').length,0);
reset(a,b,c);handleInput(ctx,a,'/sb broadcast');for(const s of [a,b,c])assert.equal(heads(s)[0].clothes[4],232);
for(const s of [a,b,c])ctx.leaveCurrentWorld(s,false);fs.rmSync(tmp,{recursive:true,force:true});console.log('PASS: world/me outfits, no bubble markers, private sender/recipient portraits, no PM leakage, cross-world broadcast portraits');
