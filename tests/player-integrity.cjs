const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gt-integrity-'));
function load(file){const out=path.join(root,path.basename(file)+'.cjs');esbuild.buildSync({entryPoints:[file],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out);}
const {ItemDatabase}=load('server/database/items.ts');
const {ServerContext}=load('server/database/context.ts');
const {normalizeAccount,getClothingVector}=load('server/database/peer.ts');
const {hashPassword,verifyPassword}=load('server/tools/string.ts');
const {handleLogon}=load('server/action/logon.ts');
const {applyGrowIdUpgrade}=load('server/action/dialog_return/growid_apply.ts');
const {toggleWearableItem}=load('server/gamePacket/item_activate.ts');
const {handleBuy}=load('server/action/buy.ts');
const {handleStore}=load('server/action/store.ts');
const {STORE_CATALOG}=load('server/database/store-catalog.ts');
const raw=process.env.ITEMS_DAT ? fs.readFileSync(process.env.ITEMS_DAT) : null,db=new ItemDatabase();
assert.equal(db.items.size,13258);if(raw) assert.notEqual(db.rawItemsDat.compare(raw),0);
assert.equal(new ItemDatabase(db.rawItemsDat).itemsDatHash,db.itemsDatHash);
assert.equal(db.get(242).name,'World Lock');assert.equal(db.get(242).texture,'tiles_page1.rttex');assert.equal(db.get(17642),undefined);assert.equal(db.get(6).name,'Main Door');
for(const product of STORE_CATALOG)for(const [id] of product.items)assert.ok(db.get(id),product.key);
const fresh=normalizeAccount({userId:1,name:'Player'});
assert.equal(fresh.backpackSize,16);assert.equal(fresh.gems,0);assert.equal(fresh.moderator,false);
assert.deepEqual(fresh.inventory.map(s=>s.itemId).sort((a,b)=>a-b),[18,32]);
const hash=hashPassword('Password123');assert.notEqual(hash,hashPassword('Password123'));
assert.ok(verifyPassword('Password123',hash));assert.ok(!verifyPassword('',hash));assert.ok(!verifyPassword('wrong',hash));assert.ok(!verifyPassword('anything',''));assert.ok(!verifyPassword('plaintext','plaintext'));
const oldHash=crypto.createHash('sha256').update('gt_v150_salt:Password123').digest('hex');assert.ok(verifyPassword('Password123',oldHash));
function peer(){return {clientDeviceId:crypto.randomBytes(16).toString('hex'),userData:null,packets:[],sendPacket(c,p){this.packets.push(p)},sendDisconnect(){}};}
const ctx=new ServerContext(db,root);
for(const [name,password] of [['Unknown',''],['Unknown','Password123']]){let p=peer();handleLogon(ctx,p,{tankIDName:name,tankIDPass:password});assert.equal(p.userData,null);assert.equal(ctx.accounts.size,0);}
const guest=peer();handleLogon(ctx,guest,{requestedName:'Tester'});const session=guest.userData;assert.ok(session.account.isGuest);
applyGrowIdUpgrade(ctx,session,'RealPlayer','Password123','Password123');assert.equal(session.account.isGuest,false);
const persistedHash=session.account.passwordHash;
applyGrowIdUpgrade(ctx,session,'StolenName','NewPassword123','NewPassword123');assert.equal(session.account.passwordHash,persistedHash);assert.equal(session.account.name,'RealPlayer');
for(const pass of ['', 'wrong']){const p=peer();handleLogon(ctx,p,{tankIDName:'RealPlayer',tankIDPass:pass});assert.equal(p.userData,null);}
const blank=normalizeAccount({userId:55,name:'LegacyBlank',isGuest:false,passwordHash:''});ctx.accounts.set('legacyblank',blank);
const pblank=peer();handleLogon(ctx,pblank,{tankIDName:'LegacyBlank',tankIDPass:'Password123'});assert.equal(pblank.userData,null);assert.equal(blank.passwordHash,'');
const good=peer();handleLogon(ctx,good,{tankIDName:'RealPlayer',tankIDPass:'Password123'});assert.ok(good.userData);const s=good.userData;
assert.equal(ctx.giveInventoryItem(s,6,1),0);assert.equal(ctx.giveInventoryItem(s,17642,1),0);
const shirt=[...db.items.values()].find(d=>d.isClothing&&d.clothingType===1);
ctx.giveInventoryItem(s,shirt.id,1,false);toggleWearableItem(ctx,s,shirt.id);
s.account.spawnWorld='START';s.account.spawnX=96;s.account.spawnY=64;ctx.savePlayersNow();
let reloaded=new ServerContext(db,root);let saved=reloaded.accounts.get('realplayer');
assert.equal(getClothingVector(saved,db)[1],shirt.id);assert.equal(saved.spawnWorld,'START');assert.equal(saved.spawnX,96);
s.account.gems=10000;ctx.savePlayersNow();const before=s.account.inventory.map(x=>({...x}));
handleBuy(ctx,s,'6');assert.deepEqual(s.account.inventory,before);assert.equal(s.account.gems,10000);
handleBuy(ctx,s,'world_lock');assert.equal(s.account.gems,8000);assert.equal(s.account.inventory.find(x=>x.itemId===242).count,1);
handleBuy(ctx,s,'upgrade_backpack');assert.equal(s.account.backpackSize,26);assert.equal(s.account.gems,7900);
handleBuy(ctx,s,'upgrade_backpack');assert.equal(s.account.backpackSize,36);assert.equal(s.account.gems,7700);
const originalSave=ctx.savePlayersNow.bind(ctx),snapshot=JSON.stringify(s.account);ctx.savePlayersNow=()=>{throw Error('simulated disk failure')};handleBuy(ctx,s,'world_lock');assert.equal(JSON.stringify(s.account),snapshot);ctx.savePlayersNow=originalSave;
s.account.inventory.find(x=>x.itemId===242).count=199;const money=s.account.gems;handleBuy(ctx,s,'world_lock_10_pack');assert.equal(s.account.gems,money);assert.equal(s.account.inventory.find(x=>x.itemId===242).count,199);
handleStore(ctx,s,'locks');assert.ok(good.packets.at(-1).includes(Buffer.from('OnStoreRequest')));assert.ok(good.packets.at(-1).includes(Buffer.from('enable_tabs|1')));
// Join performs both immediate and guarded post-spawn restoration without manual equip.
ctx.joinWorld(s,'START');assert.ok(good.packets.some(p=>p.includes(Buffer.from('OnSetClothing'))));
const corrupt=fs.mkdtempSync(path.join(os.tmpdir(),'gt-corrupt-'));fs.mkdirSync(path.join(corrupt,'data_store'));fs.writeFileSync(path.join(corrupt,'data_store/players.json'),'broken');assert.throws(()=>new ServerContext(db,corrupt),/Refusing startup/);assert.equal(fs.readFileSync(path.join(corrupt,'data_store/players.json'),'utf8'),'broken');
setTimeout(()=>{
 assert.ok(good.packets.filter(p=>p.includes(Buffer.from('OnSetClothing'))).length>=2);
 console.log('PASS: filtered items round-trip/hash; 16-slot starter; password/register fail-closed; restart clothing/checkpoint; catalog-only atomic purchases/rollback; native store; guarded join clothing sync; corrupt database preserved');
 console.log(JSON.stringify({enabledItems:db.items.size,disabledRecords:17720-db.items.size,filteredBytes:db.rawItemsDat.length,filteredHash:db.itemsDatHash}));
 fs.rmSync(root,{recursive:true,force:true});fs.rmSync(corrupt,{recursive:true,force:true});
},250);
