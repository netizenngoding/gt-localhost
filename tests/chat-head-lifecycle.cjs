const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
let now=1000;const env={document:{hidden:false},console:{warn(){}},Date:{now:()=>now}};vm.createContext(env);
let s=fs.readFileSync('public/WebLoaderData/NativeChatHeads.js','utf8');s=s.replace('g.NativeChatHeads={','g.lab={mergeHeadLayers,cache,rows,receive,prepare,want(meta){wanted.set(key(meta),meta)},capture(fn){capture=fn}};g.NativeChatHeads={');vm.runInContext(s,env);
const meta={v:1,id:'0000000001',skin:2190853119,clothes:Array(10).fill(0)};env.lab.receive(['OnConsoleMessage','',JSON.stringify(meta)]);env.lab.want(meta);let calls=0;env.lab.capture(()=>{calls++;return null});
for(let i=0;i<6;i++){env.lab.prepare();now+=2000;}assert.equal(calls,6,'renderer unavailable must never permanently exhaust retries');assert.equal([...env.lab.cache.values()][0].tries,0);
const image={width:40,height:40};env.lab.capture(()=>image);env.lab.prepare();assert.equal([...env.lab.cache.values()][0].image,image);
now+=2000;env.lab.capture(()=>{throw Error('temporary renderer transition')});env.lab.prepare();assert.equal([...env.lab.cache.values()][0].image,image,'retain visible pixels when recapture fails');assert.equal(env.lab.rows.size,1);
now+=6000;env.lab.capture(()=>image);env.lab.prepare();now+=2000;env.lab.prepare();assert.equal([...env.lab.cache.values()][0].tries,3);
console.log('PASS: unavailable renderer retries beyond three attempts; successful snapshots survive transient failure; successful-only retry accounting');

const full=new Uint8Array([20,20,20,255,255,255,255,255]),tail=new Uint8Array([255,255,255,255,255,255,255,255]);env.lab.mergeHeadLayers(full,tail,2,1,0);assert.deepEqual([...full],[0,0,0,0,255,255,255,255]);console.log("PASS: costume occlusion preserved; visible beard retained");
