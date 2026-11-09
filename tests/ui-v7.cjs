const fs=require('fs'),vm=require('vm'),zlib=require('zlib'),assert=require('assert/strict');
assert.equal(require('crypto').createHash('sha256').update(Buffer.from(fs.readFileSync('tools/font-colors.hex','utf8').trim(),'hex')).digest('hex'),'fdd3269d8ad562d98b01a511b8c6e5d5b79caac2087e478da69b7808b944858a');
const box={};vm.createContext(box);vm.runInContext(fs.readFileSync('public/WebLoaderData/UIAssets.js','utf8'),box);
for(const [key,height] of Object.entries({normal:18,normalx2:36,big:48,bigx2:96})){
 const packed=Buffer.from(box.SERVER_UI_ASSETS[key],'base64'),b=zlib.inflateSync(packed.subarray(32));
 assert.equal(b.subarray(0,6).toString(),'RTFONT');assert.equal(b.readInt16LE(10),height);assert.equal(b.readInt16LE(12),height);
 const first=b.readInt16LE(18),last=b.readInt16LE(20),states=b.readInt16LE(24),kern=b.readInt16LE(26);
 assert.equal(first,32);assert.equal(last,255);assert.equal(states,27);assert.equal(kern,0);
 const colors=152+(last-first)*32;assert.equal(b.subarray(colors,colors+states*8).toString('hex'),fs.readFileSync('tools/font-colors.hex','utf8').trim());
 const t=152+(last-first)*32+states*8,tex=b.subarray(t);assert.equal(tex.subarray(0,6).toString(),'RTTXTR');
 const w=tex.readUInt32LE(12),h=tex.readUInt32LE(8);assert.ok(w<=4096&&h<=4096);assert.equal(tex.length,124+w*h*4);
 for(let i=0;i<last-first;i++){const o=152+i*32;assert.ok(b.readInt16LE(o)+b.readInt16LE(o+4)<=w);assert.ok(b.readInt16LE(o+2)+b.readInt16LE(o+6)<=h);}
 assert.ok(tex.subarray(124).some(v=>v!==0));
}
assert.ok(fs.readFileSync('public/branding/fonts/Minecraft.ttf').length>10000);
console.log('PASS: four native Minecraft RTFont variants, original line heights, 223 glyph records, 27 pre-toggle formatting states, atlas bounds/pixel payloads, <=4096 texture dimensions');
