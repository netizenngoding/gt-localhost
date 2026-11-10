const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gtps3-recipes-'));
function load(src){const o=path.join(dir,path.basename(src)+Math.random()+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:o,bundle:true,platform:'node'});return require(o)}
try{
 const {ItemDatabase}=load('server/database/items.ts'),{ServerContext}=load('server/database/context.ts'),{normalizeAccount}=load('server/database/peer.ts'),{useConsumable}=load('server/playmods/service.ts'),{GTPS3_CONSUME_RECIPES:recipes}=load('server/playmods/gtps3-recipes.ts');
 const db=new ItemDatabase(),ctx=new ServerContext(db,dir),a=normalizeAccount({userId:1,name:'A'}),s={account:a,netId:1,x:32,y:32,world:null,cheats:{},peer:{packets:[],sendPacket(c,p){this.packets.push(p)}}};ctx.accounts.set('a',a);ctx.sessions.add(s);ctx.joinWorld(s,'RECIPES');s.x=s.y=32;
 for(const [raw, [need,prize]] of Object.entries(recipes)){
  const id=Number(raw);assert.equal(db.get(id).actionType,8);assert.ok(db.get(prize));
  a.backpackSize=20;a.inventory=[{itemId:id,count:need-1,equipped:false}];useConsumable(ctx,s,id,1,1);assert.equal(a.inventory[0].count,need-1,'not enough');
  a.inventory=[{itemId:id,count:need,equipped:false},{itemId:prize,count:200,equipped:false}];useConsumable(ctx,s,id,1,1);assert.equal(a.inventory[0].count,need,'full stack failure');
  a.backpackSize=1;a.inventory=[{itemId:id,count:need,equipped:false}];useConsumable(ctx,s,id,1,1);assert.equal(a.inventory[0].count,need,'full backpack failure');
  a.backpackSize=20;useConsumable(ctx,s,id,1,1);assert.equal(a.inventory.find(v=>v.itemId===id)?.count||0,0);assert.equal(a.inventory.find(v=>v.itemId===prize)?.count,1);
 }
 const saved=new ServerContext(db,dir).accounts.get('a');const [lastId,[,lastPrize]]=Object.entries(recipes).at(-1);assert.equal(saved.inventory.find(v=>v.itemId===Number(lastId))?.count||0,0);assert.equal(saved.inventory.find(v=>v.itemId===lastPrize)?.count,1);
 console.log(`PASS: ${Object.keys(recipes).length} C++ recipes, insufficient input/full inventory safety, rewards and persistence`);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
