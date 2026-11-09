#!/usr/bin/env node
// Local, read-only diagnostic; no network and no account details uploaded.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),esbuild=require('esbuild');
const file=path.join(process.cwd(),'data_store/players.json');
if(!fs.existsSync(file)){console.error('data_store/players.json tidak ditemukan.');process.exit(1)}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outfit-audit-'));
try {
  const bundle=path.join(dir,'items.cjs');esbuild.buildSync({entryPoints:['server/database/items.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs'});
  const db=new (require(bundle).ItemDatabase)();const players=JSON.parse(fs.readFileSync(file,'utf8'));let problems=0;
  for(const p of players){
    for(const s of [...(p.inventory||[]),...(p.unavailableInventory||[])]){
      if(!s.equipped)continue;const item=db.get(s.itemId);
      if(!item||!item.isClothing){console.log(`${p.name}: item ${s.itemId} dipakai tetapi ${!item?'tidak ada di katalog':'bukan item pakaian'}; tidak bisa ditampilkan.`);problems++}
    }
  }
  console.log(problems?`${problems} item perlu diperiksa. Data tidak diubah.`:'Tidak ada item equipped yang hilang dari katalog pada data saat ini. Data tidak diubah.');
} finally {fs.rmSync(dir,{recursive:true,force:true})}
