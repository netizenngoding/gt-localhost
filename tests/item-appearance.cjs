const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),esbuild=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'item-appearance-'));
try {
 const out=path.join(dir,'patch.cjs');esbuild.buildSync({entryPoints:['server/client/item-appearance.ts'],outfile:out,bundle:true,platform:'node'});
 const {patchItemAppearance}=require(out),before=fs.readFileSync('data/client/upstream.wasm'),after=patchItemAppearance(before);assert.ok(WebAssembly.validate(after));
 function sections(b){let p=8;const out=[];function read(){let n=0,s=0;for(;;){const v=b[p++];n|=(v&127)<<s;if(v<128)return n>>>0;s+=7;}}while(p<b.length){const id=b[p++],len=read();out.push([id,b.subarray(p,p+len)]);p+=len;}return out;}
 const a=sections(before),b=sections(after);assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++)if(a[i][0]!==10)assert.deepEqual(a[i],b[i]);
 function bodies(b){let p=0;function read(){let n=0,s=0;for(;;){const v=b[p++];n|=(v&127)<<s;if(v<128)return n>>>0;s+=7;}}const n=read(),r=[];for(let i=0;i<n;i++){const len=read();r.push(b.subarray(p,p+len));p+=len;}return r;}
 const x=bodies(a.find(s=>s[0]===10)[1]),y=bodies(b.find(s=>s[0]===10)[1]);assert.equal(x.length,y.length);let changes=[];
 x.forEach((v,i)=>{if(!v.equals(y[i]))changes.push(i+308)});assert.deepEqual(changes,[781]);assert.equal(y[781-308].length,x[781-308].length+18);
 assert.throws(()=>patchItemAppearance(after),/signature changed/);
 console.log('PASS: only face renderer f781 changes; ItemDef kind 14 takes skin color, no item-ID hardcode; tables/types/data/exports and all other function bodies identical; double patch fails closed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
