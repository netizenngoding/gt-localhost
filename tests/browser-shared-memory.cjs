const {chromium,firefox}=require('playwright');const fs=require('fs');const path=require('path');const http=require('http');
(async()=>{let out=[];const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});r.end('<!doctype html><title>Shared-memory regression</title>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const sdk=fs.readFileSync(path.join(__dirname,'../public/WebLoaderData/GameSDK.js'),'utf8');const code=sdk.slice(sdk.indexOf('  function readStdString('),sdk.indexOf('  function writeStdString('));
for (const [name,type] of Object.entries({chromium,firefox})) {
let browser;try{browser=await type.launch({headless:true,timeout:15000});const ctx=await browser.newContext();const p=await ctx.newPage();await p.goto(url);const r=await p.evaluate(code=>{
const bytes=new Uint8Array(new SharedArrayBuffer(128));const words=new Uint32Array(bytes.buffer);const global={Module:{HEAPU8:bytes,HEAPU32:words}};const isWasmReady=()=>true;const utf8Dec=new TextDecoder();const read=eval('('+code.trim()+')');bytes.set([116,101,115,116],16);bytes[27]=4;
let oldThrows=false;try{utf8Dec.decode(bytes.subarray(16,20))}catch(e){oldThrows=true}
const short=read(16);words[32>>2]=64;words[36>>2]=4;bytes[43]=128;bytes.set([108,111,110,103],64);return{isolated:crossOriginIsolated,oldThrows,short,long:read(32)};
},code);out.push({browser:name,...r,pass:r.oldThrows&&r.short==='test'&&r.long==='long'});}catch(e){out.push({browser:name,pass:false,error:String(e)})}finally{if(browser)await browser.close()}}
server.close();fs.writeFileSync(path.join(__dirname,'../docs/browser-evidence/shared-memory-browsers.json'),JSON.stringify(out,null,2));console.log(out);if(out.some(x=>!x.pass))process.exitCode=1;
})();
