const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm'),esbuild=require('esbuild'),express=require('express');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'parts-test-'));
 esbuild.buildSync({entryPoints:['server/client/data-package.ts'],outfile:path.join(temp,'package.cjs'),bundle:true,platform:'node'});
 const {createDataPackage,DATA_SIZE,DATA_SHA256,PART_SIZE}=require(path.join(temp,'package.cjs'));
 const source=path.resolve(process.argv[2]||'data/client/parts'),dest=path.join(temp,'data/client/parts');fs.mkdirSync(dest,{recursive:true});
 for(const file of fs.readdirSync(source))fs.copyFileSync(path.join(source,file),path.join(dest,file),fs.constants.COPYFILE_FICLONE);
 // Manifest and tampering tests use separate copies, never mutate the linked source.
 const originalManifest=fs.readFileSync(path.join(dest,'manifest.json'));fs.unlinkSync(path.join(dest,'manifest.json'));fs.writeFileSync(path.join(dest,'manifest.json'),originalManifest);
 const pack=createDataPackage(temp),app=express();pack.install(app);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/client/client.data`;
 try{
  const [p,q]=await Promise.all([pack.prepare(),pack.prepare()]);assert.equal(p.length,17);assert.equal(q.length,17);
  const full=await fetch(url);assert.equal(full.status,200);assert.equal(Number(full.headers.get('content-length')),DATA_SIZE);const hash=crypto.createHash('sha256');let size=0;for await(const c of full.body){hash.update(c);size+=c.length;}assert.equal(size,DATA_SIZE);assert.equal(hash.digest('hex'),DATA_SHA256);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(url,{headers:{Range:`bytes=${PART_SIZE-8}-${PART_SIZE+7}`}});assert.equal(range.status,206);const bytes=Buffer.from(await range.arrayBuffer());const left=fs.readFileSync(path.join(dest,'part-000.bin')).subarray(-8),right=fs.readFileSync(path.join(dest,'part-001.bin')).subarray(0,8);assert.deepEqual(bytes,Buffer.concat([left,right]));
  const suffix=await fetch(url,{headers:{Range:'bytes=-16'}});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),fs.readFileSync(path.join(dest,'part-016.bin')).subarray(-16));
  for(const spec of ['bytes=999999999-','bytes=2-1','bytes=-0','bytes=0-1,5-6','bytes=-']){const r=await fetch(url,{headers:{Range:spec}});assert.equal(r.status,416,spec);await r.text();}
  fs.renameSync(path.join(dest,'part-000.bin'),path.join(dest,'original.bin'));let r=await fetch(url);assert.equal(r.status,503);await r.text();
  fs.writeFileSync(path.join(dest,'part-000.bin'),'version https://git-lfs.github.com/spec/v1\n');r=await fetch(url);assert.equal(r.status,503);await r.text();
  const corrupt=fs.readFileSync(path.join(dest,'original.bin'));corrupt[0]^=1;fs.writeFileSync(path.join(dest,'part-000.bin'),corrupt);r=await fetch(url);assert.equal(r.status,503);await r.text();
  fs.unlinkSync(path.join(dest,'part-000.bin'));fs.renameSync(path.join(dest,'original.bin'),path.join(dest,'part-000.bin'));await pack.prepare();
  const evil=JSON.parse(originalManifest);evil.parts[0].file='../upstream.wasm';fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(evil));await assert.rejects(pack.prepare());fs.writeFileSync(path.join(dest,'manifest.json'),originalManifest);
  const js=fs.readFileSync('public/MagnoliaClient-1.50.js','utf8');const a=js.indexOf('async function fetchRemotePackage'),b=js.indexOf('async function runWithFS',a);assert.ok(a>=0&&b>a);
  const sandbox={isNode:false,Module:{},fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}})),Uint8Array};vm.createContext(sandbox);vm.runInContext(js.slice(a,b),sandbox);assert.deepEqual(Buffer.from(await sandbox.fetchRemotePackage('/test',4)),Buffer.from([1,2,3,4]));await assert.rejects(sandbox.fetchRemotePackage('/test',5),/truncated/);await assert.rejects(sandbox.fetchRemotePackage('/test',3),/exceeds/);
  sandbox.fetch=async()=>new Response('oops',{headers:{'Content-Length':'99'}});await assert.rejects(sandbox.fetchRemotePackage('/test',4),/length mismatch/);
  console.log('PASS: real 341708818-byte package streamed; SHA-256 identical; 17 parts; concurrent verification; HEAD; boundary/suffix ranges; invalid ranges; missing part; LFS pointer; same-size corruption; recovery; unsafe manifest; single-buffer loader; truncated/oversized HTTP data.');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
