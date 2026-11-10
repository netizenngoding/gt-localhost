const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gameplay-progression-'));
function load(src){const out=path.join(temp,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try {
 const {normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts'),{ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts');
 const {recordProgress,evaluate,progression}=load('server/progression/service.ts'),{addXp,xpRequired,normalizeProgression}=load('server/progression/model.ts');
 const {handleProgressionCommand}=load('server/progression/commands.ts'),{canUseSkin,setSkin}=load('server/progression/skin.ts'),{hasPermission}=load('server/ranks/index.ts');
 const {useConsumable,expireMods}=load('server/playmods/service.ts'),{effectiveSkin,normalizeMods}=load('server/playmods/model.ts'),{recycleValue}=load('server/progression/recycling.ts');
 const {handleTrashItemReturn}=load('server/action/dialog_return/trash_item.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,temp),a=normalizeAccount({userId:123,name:'Progression',isGuest:false});
 const s={account:a,netId:1,world:null,x:0,y:0,facingLeft:false,mstate:0,smstate:0,cheats:{noclip:false,speed:false,fly:false},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.sessions.add(s);ctx.accounts.set(a.name.toLowerCase(),a);
 assert.equal(a.progression.level,1);assert.equal(a.progression.superSupporter,false);
 handleProgressionCommand(ctx,s,'setlevel',['setlevel','50']);assert.equal(a.progression.level,1,'player cannot set level');
 for(const n of ['0','126','-1','NaN','50evil','1.5','Infinity']){a.rank='developer';handleProgressionCommand(ctx,s,'setlevel',['setlevel',n]);assert.equal(a.progression.level,1);}
 a.rank='player';recordProgress(ctx,s,'blocks_placed',99);assert.ok(!a.progression.earned.blocks_placed_1);
 recordProgress(ctx,s,'blocks_placed',1);assert.ok(a.progression.earned.blocks_placed_1);
 const count=()=>s.peer.packets.filter(p=>p.includes(Buffer.from('OnTalkBubble'))).length,n=count();recordProgress(ctx,s);assert.equal(count(),n,'no duplicate announcement');
 recordProgress(ctx,s,'trees_harvested',100);assert.ok(s.peer.packets.filter(p=>p.includes(Buffer.from('OnTalkBubble'))).at(-1).readInt32LE(12)>5000,'consecutive-event notification is queued');
 const p=normalizeProgression();addXp(p,xpRequired(1)+xpRequired(2)+7);assert.equal(p.level,3);assert.equal(p.xp,7);
 a.rank='developer';handleProgressionCommand(ctx,s,'setlevel',['setlevel','50']);a.rank='player';
 const notices=s.peer.packets.filter(p=>p.includes(Buffer.from('OnTalkBubble'))).slice(-3).map(p=>p.readInt32LE(12));assert.ok(notices[1]-notices[0]>=5900 && notices[2]-notices[1]>=5900);
 assert.equal(a.progression.level,50);assert.equal(a.progression.superSupporter,true);assert.equal(hasPermission(a,'debug'),false);assert.equal(hasPermission(a,'moderate'),false);
 assert.ok(a.progression.earned.level_2);assert.ok(a.progression.earned.supporter);assert.ok(buildCharacterStateForSession(s,db).stateFlags&(1<<24));
 handleProgressionCommand(ctx,s,'hidestatus',['hidestatus']);assert.equal(buildCharacterStateForSession(s,db).stateFlags&(1<<24),0);assert.ok(canUseSkin(a,0xffffffff));
 assert.equal(canUseSkin(a,0xffffff00),false);assert.equal(canUseSkin(a,-1),false);setSkin(ctx,s,0xffffffff);assert.equal(a.skinColor,0xffffffff);
 const plain=normalizeAccount({userId:124,name:'Plain'});assert.equal(canUseSkin(plain,0xffffffff),false);assert.ok(canUseSkin(plain,2190853119));
 // Hair animation flag must not grant Rayman's Fist effects.
 a.inventory.push({itemId:5482,count:1,equipped:true});assert.ok(db.get(5482).isRayman);assert.equal(buildCharacterStateForSession(s,db).punchEffect,0);a.inventory.push({itemId:5480,count:1,equipped:true});assert.equal(buildCharacterStateForSession(s,db).punchEffect,80);
 ctx.joinWorld(s,'CONSUMETEST');s.x=0;s.y=0;
 a.inventory.push({itemId:196,count:2,equipped:false});assert.ok(useConsumable(ctx,s,196,0,0));assert.equal(effectiveSkin(a),4278190335);assert.equal(a.inventory.find(i=>i.itemId===196).count,1);assert.equal(a.progression.counters.consumables_used,1);
 a.playmods[0].expiresAt=Date.now()-1;expireMods(ctx);assert.equal(effectiveSkin(a),0xffffffff);assert.equal(a.playmods.length,0);
 assert.deepEqual(normalizeMods([{id:'forged',expiresAt:Date.now()+1000}]),[]);
 assert.equal(recycleValue(242,2),400);assert.equal(recycleValue(2,5),0);
 a.inventory.push({itemId:242,count:2,equipped:false});handleTrashItemReturn(ctx,s,{itemID:'242',trash_count:'1evil'});assert.equal(a.inventory.find(i=>i.itemId===242).count,2);
 handleTrashItemReturn(ctx,s,{itemID:'242',trash_count:'1'});assert.equal(a.gems,200);assert.equal(a.progression.counters.items_trashed,1);
 ctx.savePlayersNow();const reload=new ServerContext(db,temp).accounts.get(a.name.toLowerCase());assert.equal(reload.progression.level,50);assert.equal(reload.progression.earned.blocks_placed_1,a.progression.earned.blocks_placed_1);assert.equal(reload.rank,'player');assert.equal(reload.skinColor,0xffffffff);assert.ok(reload.progression.superSupporter);
 // Joiners must receive existing players' supporter state and active skin, not just clothes.
 a.progression.hideStatus=false;a.playmods=[{id:'blue',expiresAt:Date.now()+10000}];ctx.joinWorld(s,'SYNC');
 const second={...s,account:normalizeAccount({userId:124,name:'Second'}),netId:0,world:null,peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.sessions.add(second);ctx.accounts.set('second',second.account);ctx.joinWorld(second,'SYNC');
 const {makeVariantPacket}=load('server/proton/packet.ts');
 assert.ok(second.peer.packets.some(p=>p.equals(makeVariantPacket(['OnChangeSkin',{type:'u32',value:4278190335}],s.netId))));
 assert.ok(second.peer.packets.some(p=>p[4]===20 && p.readInt32LE(8)===s.netId && (p.readUInt32LE(24)&(1<<24))));
 ctx.leaveCurrentWorld(second,false);ctx.leaveCurrentWorld(s,false);
 const junk=normalizeProgression({level:Infinity,xp:NaN,counters:JSON.parse('{"__proto__":999,"blocks_placed":-1}'),earned:[]});assert.equal(junk.level,1);assert.equal(junk.counters.blocks_placed,0);assert.equal(Object.getPrototypeOf(junk.counters),null);
 console.log('PASS: progression migration/reload, thresholds, one-time earned notifications, multi-level XP, DEV authorization/validation, staff separation, supporter bit/status hiding, skin gating/white/alpha, Rayman hair-vs-fist, timed consumable/expiry/base skin restore, recycle values/forged counts');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
