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
 x.forEach((v,i)=>{if(!v.equals(y[i]))changes.push(i+308)});assert.deepEqual(changes,[781,1940]);assert.equal(y[781-308].length,x[781-308].length+48);
 const neck=y[1940-308];
 assert.ok(neck.includes(Buffer.from('2206410446200641074672200641184672450d01','hex'))); // types 4,7,24
 assert.ok(neck.includes(Buffer.from('200a2d0024411746200a2d0024411846720440200220002a023c4300008041949321020b','hex'))); // 23/24 y - 16*scaleY
 assert.ok(!neck.includes(Buffer.from('220641046b0e040001010001','hex')));
 // Execute the exact injected opcodes in tiny isolated WASM harnesses.
 const u=n=>{const b=[];do{let v=n&127;n>>>=7;b.push(v|(n?128:0))}while(n);return Buffer.from(b)};
 const sec=(id,b)=>Buffer.concat([Buffer.from([id]),u(b.length),b]);
 const mod=(type,locals,code,withMemory=false)=>{const fn=Buffer.concat([locals,code,Buffer.from([0x0b])]);return Buffer.concat([
   Buffer.from('0061736d01000000','hex'),sec(1,Buffer.concat([Buffer.from([1,0x60]),type])),sec(3,Buffer.from([1,0])),
   ...(withMemory?[sec(5,Buffer.from([1,0,1]))]:[]),sec(7,Buffer.from(withMemory?[2,1,0x66,0,0,1,0x6d,2,0]:[1,1,0x66,0,0])),
   sec(10,Buffer.concat([Buffer.from([1]),u(fn.length),fn]))]);};
 const dispatch=Buffer.from('2206410446200641074672200641184672450d01','hex');
 const f=new WebAssembly.Instance(new WebAssembly.Module(mod(Buffer.from([1,0x7f,1,0x7f]),Buffer.from([1,6,0x7f]),Buffer.concat([Buffer.from('024002402000','hex'),dispatch,Buffer.from('0b41010f0b4100','hex')])))).exports.f;
 for(let mode=0;mode<256;mode++)assert.equal(f(mode),[4,7,24].includes(mode)?1:0,`dispatch mode ${mode}`);
 const offset=Buffer.from('200a2d0024411746200a2d0024411846720440200220002a023c4300008041949321020b','hex');
 const h=new WebAssembly.Instance(new WebAssembly.Module(mod(Buffer.from([7,0x7f,0x7d,0x7d,0x7f,0x7f,0x7f,0x7f,1,0x7d]),Buffer.from([1,4,0x7f]),Buffer.concat([Buffer.from('2003210a','hex'),offset,Buffer.from('2002','hex')]),true))).exports;
 const mem=new DataView(h.m.buffer);mem.setFloat32(60,1.5,true);
 for(let mode=0;mode<256;mode++){mem.setUint8(1024+36,mode);assert.equal(h.f(0,0,100,1024,0,0,0),[23,24].includes(mode)?76:100,`position mode ${mode}`);}
 assert.ok(y[781-308].includes(Buffer.from('200341f8ce0046210a','hex'))); // targeted Omegalul overlay
 assert.ok(y[781-308].includes(Buffer.from('200641ff017141807e722006200a1b','hex'))); // white RGB, original alpha
 assert.throws(()=>patchItemAppearance(after),/signature changed/);
 console.log('PASS: only f781 and f1940 change; face tint/overlay and necklace type 23/24 signatures; other sections and function bodies identical; double patch fails closed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
