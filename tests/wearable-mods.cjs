const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wearable-mods-'));
function load(src){const out=path.join(tmp,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
try {
 const {normalizeAccount,buildCharacterStateForSession}=load('server/database/peer.ts');
 const {ItemDatabase}=load('server/database/items.ts');
 const {ServerContext}=load('server/database/context.ts');
 const {hasEnhancedDigging,equippedAbilities}=load('server/playmods/equipment.ts');
 const catalog=load('server/playmods/wearable-catalog.ts');
 const {toggleWearableItem}=load('server/gamePacket/item_activate.ts');
 const {handleWrenchPlayer}=load('server/action/wrench.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,tmp),a=normalizeAccount({userId:101,name:'Test'});
 const s={account:a,netId:1,world:null,x:32,y:32,cheats:{noclip:false,speed:false,fly:false},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};
 ctx.sessions.add(s);ctx.accounts.set('test',a);ctx.joinWorld(s,'TEST');
 for (const k of ['PUNCH_DAMAGE_IDS','PUNCH_RANGE_IDS','BUILD_RANGE_IDS','DOUBLE_JUMP_IDS','SPEEDY_IDS']) {
  assert.ok(catalog[k].size>40,k+' has broad catalog coverage');
  for(const id of catalog[k])assert.ok(db.get(id)?.isClothing,`${k} #${id} must exist and be wearable`);
 }
 const add=id=>a.inventory.push({itemId:id,count:1,equipped:false});
 [4590,98,5480,138,4746,496,156,11094,3774].forEach(add);
 toggleWearableItem(ctx,s,4590);assert.ok(hasEnhancedDigging(a));
 a.inventory.find(i=>i.itemId===4590).count=0;assert.equal(hasEnhancedDigging(a),false,'zero count must not apply');a.inventory.find(i=>i.itemId===4590).count=1;
 assert.equal(equippedAbilities(a).damage[0],4590);
 toggleWearableItem(ctx,s,98);assert.equal(equippedAbilities(a).damage.length,2);
 toggleWearableItem(ctx,s,5480);assert.ok(hasEnhancedDigging(a),'scarf still gives damage with Rayman');
 toggleWearableItem(ctx,s,4590);assert.equal(hasEnhancedDigging(a),false,'Rayman alone has no enhanced digging');
 toggleWearableItem(ctx,s,138);toggleWearableItem(ctx,s,4746);toggleWearableItem(ctx,s,496);toggleWearableItem(ctx,s,156);
 let state=buildCharacterStateForSession(s,db);assert.equal(state.buildRangeTiles,3);assert.ok(state.stateFlags&2);assert.equal(state.moveSpeed,325);
 toggleWearableItem(ctx,s,5480);state=buildCharacterStateForSession(s,db);assert.equal(state.punchRangeTiles,3);assert.equal(state.punchEffect,1);
 toggleWearableItem(ctx,s,11094);state=buildCharacterStateForSession(s,db);assert.equal(state.buildRangeTiles,4);assert.equal(state.punchRangeTiles,4);
 s.world.ownerUserId=a.userId;state=buildCharacterStateForSession(s,db);assert.equal(state.buildRangeTiles,5);assert.equal(state.punchRangeTiles,5);
 toggleWearableItem(ctx,s,4590);s.peer.packets.length=0;handleWrenchPlayer(ctx,s,{netid:String(s.netId)});const dialog=s.peer.packets.find(p=>p.includes(Buffer.from('OnDialogRequest'))).toString();for(const effect of ['Enhanced Digging','Punch Range','Build Range','Double Jump','Speedy','Extended Punch and Build Range'])assert.ok(dialog.includes(effect),effect);
 a.rank='developer';const staff=buildCharacterStateForSession(s,db);assert.ok(staff.buildRangeTiles>5&&staff.punchRangeTiles>5);a.rank='player';
 toggleWearableItem(ctx,s,156);toggleWearableItem(ctx,s,496);state=buildCharacterStateForSession(s,db);assert.equal(state.stateFlags&2,0);assert.equal(state.moveSpeed,250);
 toggleWearableItem(ctx,s,3774);assert.ok(buildCharacterStateForSession(s,db).stateFlags & (1<<4),'No-Face state');toggleWearableItem(ctx,s,3774);assert.equal(buildCharacterStateForSession(s,db).stateFlags & (1<<4),0,'No-Face unequip');
 const restored=new ServerContext(db,tmp).accounts.get('test');assert.ok(hasEnhancedDigging(restored));
 console.log('PASS: catalog item IDs, Dragoscarf and Rayman combination, non-stacking digging, range, movement, unequip and persistence');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
