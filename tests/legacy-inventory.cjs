const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'outfit-archive-'));fs.mkdirSync(path.join(tmp,'data_store'));
fs.writeFileSync(path.join(tmp,'data_store','players.json'),JSON.stringify([{userId:1,name:'Tester',inventory:[{itemId:18,count:1},{itemId:32,count:1},{itemId:65000,count:1,equipped:true}]}]));
const out=path.join(tmp,'context.cjs');esbuild.buildSync({entryPoints:['server/database/context.ts'],outfile:out,bundle:true,platform:'node',format:'cjs'});
const {ServerContext}=require(out);const db={get:(id)=>id===18||id===32?{id}:undefined};const ctx=new ServerContext(db,tmp),acct=ctx.accounts.get('tester');
assert.ok(!acct.inventory.some(x=>x.itemId===65000));assert.ok(acct.unavailableInventory.some(x=>x.itemId===65000&&x.equipped));ctx.savePlayersNow();
const ctx2=new ServerContext(db,tmp);const archived=ctx2.accounts.get('tester').unavailableInventory;assert.equal(archived.length,1);assert.equal(archived[0].itemId,65000);assert.equal(archived[0].equipped,true);
console.log('PASS: unknown equipped items are preserved on save and reload, never sent in inventory');fs.rmSync(tmp,{recursive:true,force:true});
