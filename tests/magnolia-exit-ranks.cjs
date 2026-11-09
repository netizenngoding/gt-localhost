const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),esbuild=require('esbuild');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'magnolia-test-'));
function load(file){const out=path.join(root,path.basename(file)+'.cjs');esbuild.buildSync({entryPoints:[file],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out);}
const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts');
const policy=load('server/database/world-policy.ts'),rank=load('server/ranks/index.ts'),{RankService}=load('server/ranks/service.ts');
const {handleTileActivateRequest,handleTileChangeRequest}=load('server/gamePacket/tile_change_req.ts');
const {handleJoinRequest}=load('server/action/join_request.ts');
const {handleAdminCommand}=load('server/commands/admin_commands.ts');
const {handlePlayerDialogsReturn}=load('server/action/dialog_return/player_dialogs.ts');
const {buildSpawnText}=load('server/onVariant/OnSpawn.ts');
for(const n of ['EXIT',' exit ',''])assert.equal(policy.worldDestination(n).kind,'exit');
for(const n of ['ADMIN','SYSTEM','RTSOFT','ERROR','GROWGANOTH','LEGENDARYMOUNTAIN','A_B','A B','A|B','../START','A'.repeat(25)])assert.equal(policy.worldDestination(n).kind,'invalid',n);
assert.equal(policy.worldDestination('farm123').name,'FARM123');assert.equal(policy.worldDestination('EXITABC').kind,'world');
fs.mkdirSync(path.join(root,'data_store'));fs.writeFileSync(path.join(root,'data_store/ranks.json'),JSON.stringify({schemaVersion:1,assignments:{'1001':'developer','1002':'moderator'}}));
const ranks=new RankService(root),account=normalizeAccount({userId:1001,name:'DevTest',isGuest:false,rank:'player'});ranks.apply(account);assert.equal(account.rank,'developer');
const mod=normalizeAccount({userId:1002,name:'ModTest',isGuest:false});ranks.apply(mod);
const plain=normalizeAccount({userId:1003,name:'PlayerTest',isGuest:false,rank:'developer',moderator:true});ranks.apply(plain);assert.equal(plain.rank,'player');assert.equal(plain.moderator,false);
const guest=normalizeAccount({userId:1001,name:'Guest_123',isGuest:true});ranks.apply(guest);assert.equal(guest.rank,'player');
assert.ok(rank.hasPermission(mod,'moderate'));assert.ok(!rank.hasPermission(mod,'grantItems'));assert.ok(rank.hasPermission(account,'grantItems'));assert.ok(!rank.canModerate(mod,account));assert.ok(!rank.canModerate(mod,mod));
assert.deepEqual(rank.protocolFlags(account),{mstate:1,smstate:1});assert.deepEqual(rank.protocolFlags(mod),{mstate:1,smstate:0});assert.deepEqual(rank.protocolFlags(plain),{mstate:0,smstate:0});
const legacyRoot=path.join(root,'legacy');fs.mkdirSync(path.join(legacyRoot,'data_store'),{recursive:true});fs.writeFileSync(path.join(legacyRoot,'data_store/worlds.json'),JSON.stringify([{name:'EXIT'}]));
const db=new ItemDatabase();const legacy=new ServerContext(db,legacyRoot);assert.ok(!legacy.worlds.has('EXIT'));assert.ok(fs.existsSync(path.join(legacyRoot,'data_store/worlds.json.pre-world-policy.bak')));
const ctx=new ServerContext(db,root),packets=[];
const peer={sendPacket(c,p){packets.push(p)},sendDisconnect(){}};
const s={peer,account,netId:1,world:null,x:0,y:0,facingLeft:false,mstate:0,smstate:0,cheats:{noclip:false,speed:false,fly:false},pendingEditTile:null,pendingTradeOffer:null,lastItemSearchQuery:''};ctx.accounts.set('devtest',account);ctx.sessions.add(s);
assert.ok(buildSpawnText(s,true).includes('name|`6@DevTest``'));
s.account=mod;assert.ok(buildSpawnText(s,true).includes('name|`#@ModTest``'));
s.account=plain;assert.ok(!buildSpawnText(s,true).includes('@'));
handleAdminCommand(ctx,s,'mstate',['mstate','255'],'255');assert.equal(s.mstate,0);
handlePlayerDialogsReturn(ctx,s,'cheats_menu',{buttonClicked:'cheat_toggle_noclip'});assert.equal(s.cheats.noclip,false);
s.account=account;
assert.throws(()=>ctx.getOrCreateWorld('EXIT'));assert.throws(()=>ctx.getOrCreateWorld('SYSTEM'));
ctx.joinWorld(s,'START');let world=s.world;let i=world.tiles.findIndex(t=>t.fg===6);const tx=i%world.width,ty=Math.floor(i/world.width);
// The original bug: destination="EXIT" was processed before checking Main Door ID.
packets.length=0;handleTileActivateRequest(ctx,s,{punchX:tx,punchY:ty});assert.equal(s.world,null);assert.ok(!world.peers.has(s));assert.ok(!ctx.worlds.has('EXIT'));assert.ok(packets.some(p=>p.includes(Buffer.from('OnRequestWorldSelectMenu'))));
ctx.joinWorld(s,'START');world=s.world;world.tiles[i].extra.destination='OTHERWORLD';packets.length=0;
handleTileChangeRequest(ctx,s,{value:18,punchX:tx,punchY:ty});assert.equal(s.world,world);assert.ok(!packets.some(p=>p.includes(Buffer.from('OnRequestWorldSelectMenu'))));handleTileActivateRequest(ctx,s,{punchX:tx,punchY:ty});assert.equal(s.world,null);assert.ok(!ctx.worlds.has('OTHERWORLD'));
ctx.joinWorld(s,'START');world=s.world;ctx.joinWorld(s,'ADMIN');assert.equal(s.world,world);assert.ok(!ctx.worlds.has('ADMIN'));
handleJoinRequest(ctx,s,{name:'EXIT'});assert.equal(s.world,null);assert.ok(!world.peers.has(s));
ctx.joinWorld(s,'START');s.x=0;s.y=0;handleTileActivateRequest(ctx,s,{punchX:tx,punchY:ty});assert.ok(s.world); // remote activation denied
// Adjacent, remote, and boundary centers are not inside the door.
for (const [x,y] of [[tx*32-11,ty*32],[tx*32+22,ty*32],[tx*32,ty*32-16],[tx*32,ty*32+17],[0,0]]) {s.x=x;s.y=y;handleTileActivateRequest(ctx,s,{punchX:tx,punchY:ty});assert.equal(s.world,world);}
s.x=tx*32-10;s.y=ty*32-15;handleTileActivateRequest(ctx,s,{punchX:tx,punchY:ty});assert.equal(s.world,null);
// Brand assets are RTPACK/RTTXTR images installed into the native VFS by a deterministic local module.
const writes=new Map();const sandbox={SERVER_CONFIG:{serverName:'Example Server',skipIntro:true},atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/BrandingAssets.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/UIAssets.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/ServerBranding.js','utf8'),sandbox);
const fakeFS={ignorePermissions:false,writeFile(p,b){writes.set(p,Buffer.from(b))},unlink(){}};sandbox.ServerBranding.install(fakeFS);
assert.equal(writes.size,20);for(const [name,b] of writes){assert.equal(b.subarray(0,6).toString(),'RTPACK');const raw=require('zlib').inflateSync(b.subarray(32));if(name.endsWith('.rtfont')){assert.equal(raw.subarray(0,6).toString(),'RTFONT');continue;}assert.equal(raw.subarray(0,6).toString(),'RTTXTR');assert.equal(raw.length,124+raw.readUInt32LE(8)*raw.readUInt32LE(12)*4);}assert.equal(fakeFS.ignorePermissions,false);
assert.ok(fs.readFileSync('public/index.html','utf8').includes('/server-config.js'));
setTimeout(()=>{console.log('PASS: exit sentinel/creation guards; Main Door activation and punch; remote activation; invalid destination preserves world; three trusted ranks; prefixes/permissions; no rank escalation via account flags/debug dialog; nine native logo targets + two readable menu backgrounds');fs.rmSync(root,{recursive:true,force:true});},300);
