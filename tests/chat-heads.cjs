const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict'),esbuild=require('esbuild');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'native-heads-'));
function load(src){const out=path.join(temp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node'});return require(out)}
function strings(p){let n=p[60],at=61,a=[];while(n--){const i=p[at++],t=p[at++];assert.equal(t,2);const len=p.readUInt32LE(at);at+=4;a[i]=p.toString('utf8',at,at+len);at+=len;}return a;}
try{
 const {chatPortrait,makeConsoleMessagePacket}=load('server/onVariant/OnConsoleMessage.ts'),{ItemDatabase}=load('server/database/items.ts'),{normalizeAccount}=load('server/database/peer.ts');
 const db=new ItemDatabase(),account=normalizeAccount({userId:88,name:'Portrait',skinColor:2190853119,inventory:[{itemId:66,count:1,equipped:true},{itemId:232,count:1,equipped:true}]});
 const meta=chatPortrait({account},db);assert.equal(meta.clothes[0],66);assert.equal(meta.clothes[4],232);assert.equal(meta.skin,2190853119);
 const plain='CP:0_PL:0_OID:_CT:[W]_ `6<Portrait>`` hi',a=strings(makeConsoleMessagePacket(plain,meta)),b=strings(makeConsoleMessagePacket(plain,meta));
 const marker=/`o`o`o((?:`[0-9]){10})`o {6}/;assert.equal(a[1].replace(marker,''),plain);assert.notEqual(JSON.parse(a[2]).id,JSON.parse(b[2]).id);assert.equal(a[1].match(marker)[1].replace(/`/g,''),JSON.parse(a[2]).id);assert.deepEqual(strings(makeConsoleMessagePacket('system')),['OnConsoleMessage','system']);
 account.inventory[0].equipped=false;assert.equal(meta.clothes[0],66,'snapshot must not change after unequip');
 const src=fs.readFileSync('public/WebLoaderData/NativeChatHeads.js','utf8');let image;
 const env={console,Uint8Array,DataView,document:{createElement(){return{getContext(){return{createImageData(w,h){return{data:new Uint8Array(w*h*4)}},putImageData(i){image=i}}}}}}};vm.createContext(env);vm.runInContext(src.replace('g.NativeChatHeads={','g.test={validMeta,receive,rows,cropHead};g.NativeChatHeads={'),env);
 const good={v:1,id:'0000000001',clothes:Array(10).fill(0),skin:4294967295};assert.ok(env.test.validMeta(good));
 for(const bad of [{id:1000000000},{id:'bad'},{clothes:[0]},{clothes:Array(10).fill(-1)},{clothes:Array(10).fill(65536)},{skin:-1},{skin:4294967296},{v:2}])assert.ok(!env.test.validMeta({...good,...bad}));
 for(let i=0;i<405;i++)env.test.receive(['OnConsoleMessage','',JSON.stringify({...good,id:String(i).padStart(10,'0')})]);assert.equal(env.test.rows.size,400);env.test.receive(['','','{bad']);assert.equal(env.test.rows.size,400);
 const pixels=new Uint8Array(256*256*4);pixels[((255-150)*256+128)*4+3]=255;pixels[((255-235)*256+128)*4+3]=255;const crop=env.test.cropHead(pixels,256,256);assert.equal(crop.height,86,'long beard below chin must survive crop');assert.equal([...image.data].filter(v=>v===255).length,2);
 const input=fs.readFileSync('data/client/upstream.wasm'),{extendChatPortraitExports,PORTRAIT_EXPORTS}=load('server/client/portrait-exports.ts'),extended=extendChatPortraitExports(input);
 function sections(buf){let p=8,out=[];function leb(){let n=0,s=0,b;do{b=buf[p++];n|=(b&127)<<s;s+=7}while(b&128);return n>>>0}while(p<buf.length){const id=buf[p++],len=leb();out.push([id,buf.subarray(p,p+len)]);p+=len;}return out;}
 const before=sections(input),after=sections(extended);assert.equal(before.length,after.length);before.forEach(([id,body],i)=>{assert.equal(after[i][0],id);if(id!==7)assert.deepEqual(after[i][1],body,'non-export section changed '+id)});
 const exports=WebAssembly.Module.exports(new WebAssembly.Module(extended)).map(x=>x.name);Object.keys(PORTRAIT_EXPORTS).forEach(n=>assert.ok(exports.includes(n)));
 const {patchClient}=load('server/client/patch-client.ts');assert.ok(WebAssembly.validate(patchClient(input,true)));assert.throws(()=>patchClient(Buffer.alloc(32),true),/Unsupported/);
 console.log('PASS: server-owned clothing/skin snapshots, unique row markers, unchanged plain logs, strict/bounded metadata, full beard crop, export-only native bridge, pinned-client fail-closed');
}finally{fs.rmSync(temp,{recursive:true,force:true})}
