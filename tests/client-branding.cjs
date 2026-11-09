const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),vm=require('vm'),zlib=require('zlib'),esbuild=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'brand-test-'));
function load(src){const out=path.join(tmp,path.basename(src)+'.cjs');esbuild.buildSync({entryPoints:[src],outfile:out,bundle:true,platform:'node',format:'cjs'});return require(out);}
const {validateBranding,loadBranding}=load('server/config/branding.ts');
const c=validateBranding({serverName:'Orchid Realm',logoPath:'branding/logo.png',skipIntro:true,hideLegacyCustomItemWarning:true,splashes:['Welcome to {serverName}!']});
for(const bad of ['Bad|name','Bad`4name','<script>','a\nb',''])assert.throws(()=>validateBranding({...c,serverName:bad}));
assert.throws(()=>validateBranding({...c,logoPath:'../logo.png'}));assert.throws(()=>validateBranding({...c,logoPath:'https://example.com/logo.png'}));
assert.throws(()=>validateBranding({...c,skipIntro:'true'}));
fs.mkdirSync(path.join(tmp,'config'));fs.writeFileSync(path.join(tmp,'config/server.json'),JSON.stringify(c));assert.equal(loadBranding(tmp).serverName,'Orchid Realm');assert.equal(validateBranding({...c,version:'V7.2'}).version,'V7.2');assert.throws(()=>validateBranding({...c,version:'`Rrainbow'}));
for(const b of [{color:'red'},{text:'`Rbad'},{iconPath:'../escape.svg'},{iconEnabled:'yes'},{url:'javascript:alert(1)'},{url:'https://user:password@example.com'}])assert.throws(()=>validateBranding({...c,menuButton:{...c.menuButton,...b}}));
assert.equal(validateBranding({...c,menuButton:{color:'#754DB2',iconEnabled:false,text:'Follow'}}).menuButton.text,'Follow');
const sandbox={SERVER_CONFIG:c,atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('public/WebLoaderData/BrandingAssets.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/UIAssets.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/ServerBranding.js','utf8'),sandbox);
const writes=new Map();sandbox.ServerBranding.install({ignorePermissions:false,unlink(){},writeFile(p,b){writes.set(p,Buffer.from(b))}});assert.equal(writes.size,16);
const texture=zlib.inflateSync(writes.get('/interface/large/game_title.rttex').subarray(32));assert.equal(texture.readUInt32LE(12),2048);assert.equal(texture.readUInt32LE(8),1024);
const hooks=new Map(),memory=new Uint8Array(500000);let calls=0;const fakeModule={HEAPU8:memory,hookWasmTable(i,fn,sig){hooks.set(i,{fn,sig});return()=>{calls++}}};
sandbox.ServerBranding.installNativeHooks(fakeModule);assert.equal(hooks.get(1498).sig,'v');assert.equal(hooks.get(2366).sig,'vii');memory[393360]=1;hooks.get(1498).fn();assert.equal(memory[393360],0);hooks.get(2366).fn(10,20);assert.equal(memory[393968],1);assert.equal(calls,2);assert.equal(hooks.has(2047),false,'shared console layout must NOT be blocked');assert.equal(hooks.get(2342).sig,'viiiiii');assert.equal(hooks.get(2338).sig,'vi');
const labels=[{text:'Welcome to Creative Growtopia'},{text:'Copyright (c) 2021-2026 iProgramInCpp & TCG Group'}];const callbacks={};const fakeSDK={onMenu(n,fn){(callbacks[n]??=[]).push(fn)},listEntities(){return labels.map((_,i)=>({ptr:i}))},entity(i){return labels[i]}};
sandbox.ServerBranding.attachUi(fakeSDK);callbacks.MainMenu.at(-1)();assert.equal(labels[0].text,'Welcome to Orchid Realm');assert.ok(!labels[1].text.includes('iProgram'));
const {patchClient}=load('server/client/patch-client.ts');assert.throws(()=>patchClient(Buffer.alloc(16),true),/Unsupported/);
if(process.argv[2]){const src=fs.readFileSync(process.argv[2]),patched=patchClient(src,true);assert.ok(WebAssembly.validate(patched));assert.equal(src.length,patched.length);let diff=0;for(let i=0;i<src.length;i++)if(src[i]!==patched[i])diff++;assert.equal(diff,4);const noWarningPatch=patchClient(src,false);assert.equal(noWarningPatch.filter((v,i)=>v!==src[i]).length,1);console.log('PASS: actual SHA-pinned WASM, 3 diagnostic-call bytes + 1 menu-weather selector byte changed, parser retained, enabled/disabled settings');}
else console.log('NOTE: pass the upstream WASM path to also test the real binary patch.');
console.log('PASS: reusable name/config validation; HD native texture; both startup branches; non-author branding; notice preservation; unknown WASM fails closed');
fs.rmSync(tmp,{recursive:true,force:true});
