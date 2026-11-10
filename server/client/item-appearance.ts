import crypto from 'node:crypto';
function read(b:Buffer,p:number):[number,number] { let n=0,s=0; while(p<b.length && s<35){const v=b[p++];n|=(v&127)<<s;if(v<128)return[n>>>0,p];s+=7;}throw Error('Invalid WASM length'); }
function leb(n:number):Buffer {const a:number[]=[];do {const v=n&127;n>>>=7;a.push(v|(n?128:0));}while(n);return Buffer.from(a);}
/** Pinned native face renderer f781. ItemDef+36 is the item kind.
 * Match kind 14, not one item ID. The shirt renderer f1937 already applies
 * this same kind to its skin-color argument; leave that path unchanged.
 * Renderer+32 carries effective skin/status/lighting for world AND portraits.
 */
export function patchItemAppearance(input:Buffer):Buffer {
 const parts:Buffer[]=[input.subarray(0,8)];let p=8,patched=false,neckPatched=false;
 while(p<input.length) {
  const id=input[p++],[len,start]=read(input,p);p=start+len;
  let section=input.subarray(start,p);
  if(id===6){
   // Appended global 12: lazily allocated Cat Eyes per-player blink state.
   const [count,end]=read(section,0);
   if(count!==12) throw Error('Unexpected client globals');
   section=Buffer.concat([leb(count+1),section.subarray(end),Buffer.from('7f0141000b','hex')]);
  }
  if(id===10){
   const [count,header]=read(section,0), bodies:Buffer[]=[section.subarray(0,header)];let q=header;
   for(let i=0;i<count;i++){
    const [size,a]=read(section,q);q=a+size;let body=section.subarray(a,q);
    if(i+308===781){
     if(crypto.createHash('sha256').update(body).digest('hex')!=='1375c6252da382d3b485c4f47c7e1a6aadadb9a6f936fb932c85993b0f1b03c1') throw Error('Face renderer signature changed');
     // Insert after the checked ItemDef lookup, before the common draw path.
     const anchor=Buffer.from('200b2d0024220641176b','hex');
     const op=body.indexOf(anchor);
     if(op<0 || body.indexOf(anchor,op+1)>=0)throw Error('Item kind lookup signature changed');
     const tint=Buffer.from('200b2d0024410e460440200028022021040b','hex');
     body=Buffer.concat([body.subarray(0,op),tint,body.subarray(op)]);
     // Omegalul has a second sprite immediately to the right of its face.
     // The pinned renderer's overlay dispatch excludes its kind (14), so its
     // mouth is otherwise never drawn. Restrict this exception to the item:
     // other kind-14 faces (e.g. Rayman's Nose) are not necessarily layered.
     // Local 10 is dead after the first draw, and records the item ID before
     // the native overlay code reuses local 3 as a temporary pointer.
     const guard=Buffer.from('200b2d002441146b220841134b0d0041012008744185813071450d00','hex');
     const guardAt=body.indexOf(guard);
     if(guardAt<0 || body.indexOf(guard,guardAt+1)>=0)throw Error('Face overlay signature changed');
     const overlayGuard=Buffer.from('200341f8ce0046210a200b2d002441146b220841134b200a45710d004101200874418581307145200a45710d00','hex');
     body=Buffer.concat([body.subarray(0,guardAt),overlayGuard,body.subarray(guardAt+guard.length)]);
     // Use white RGB for the coloured mouth, preserving its inherited alpha;
     // retain the native seed-tint path for every other overlay item.
     const color=Buffer.from('2006430000803f10ee022104','hex');
     const colorAt=body.indexOf(color,guardAt);
     if(colorAt<0 || body.indexOf(color,colorAt+1)>=0)throw Error('Face overlay color signature changed');
     const overlayColor=Buffer.from('200641ff017141807e722006200a1b430000803f10ee022104','hex');
     body=Buffer.concat([body.subarray(0,colorAt),overlayColor,body.subarray(colorAt+color.length)]);
     // Cat Eyes has a dedicated BlinkFaceRenderObject in official v3.52.
     // Native 0x4ec770 uses 3 frames, 300ms and random open delays 1..3.
     // Injection is compiled from tools/wasm/cat-eyes-frame.wat. It deliberately
     // implements the native sleep override (state 9) using renderer offset 124.
     const catAnchor=Buffer.from('200220082a029801922102','hex');
     const catAt=body.indexOf(catAnchor);
     if(catAt<0 || body.indexOf(catAnchor,catAt+1)>=0)throw Error('Cat Eyes frame signature changed');
     const cat=Buffer.from('200341c237460440230a2206410036020041d804100a2006280200200641003602004101460d02230a220641003602002d00e403410173210e2006280200200641003602004101460d02230a2206410036020041ca0c200e10032006280200200641003602004101460d0241ac026e210e230c4504404180c00010a903240c230c0440230c41004180c000fc0b000b0b230c0440200841037641ff0771210a4100210602400340230c200a4103746a220d280200450440200d20083602000c020b200d2802002008460d01200a41016a41ff0771210a200641016a2206418008490d00200d2008360200200d41003602040b0b200e200d28020441036a7021092009450440200d410310d40241016a3602040b200941034f0440410021090b0b20082d007c4109460440410221090b0b','hex');
     body=Buffer.concat([body.subarray(0,catAt),cat,body.subarray(catAt)]);
     patched=true;
    }
    if(i+308===1940){
     // Growtopia 3.52 x86 0x54c465..0x54c518: necklace visual types
     // 4, 7 and 24 animate; types 23 and 24 draw 16 scaled pixels higher.
     // ReGrowtopia f1940 omitted 24 from the former, and both from the latter.
     // This applies to the visual TYPE, not a guessed replacement item ID.
     if(crypto.createHash('sha256').update(body).digest('hex')!=='fd614dcda2e71282a2dce521abb59d94ebc4bf44f5945eb97754d69e2afc8bd6') throw Error('Neck renderer signature changed');
     const table=Buffer.from('220641046b0e040001010001','hex');
     const tableAt=body.indexOf(table);
     if(tableAt<0 || body.indexOf(table,tableAt+1)>=0)throw Error('Neck animation dispatch signature changed');
     // stack: visual type; leave block if it is not 4, 7 or 24.
     const dispatch=Buffer.from('2206410446200641074672200641184672450d01','hex');
     body=Buffer.concat([body.subarray(0,tableAt),dispatch,body.subarray(tableAt+table.length)]);
     // Immediately after frame selection, at the first mode-200 check.
     const positionAnchor=Buffer.from('200641ff017141c801460440','hex');
     const at=body.indexOf(positionAnchor,tableAt);
     if(at<0 || body.indexOf(positionAnchor,at+1)>=0)throw Error('Neck position signature changed');
     // if (type == 23 || type == 24) y -= renderer.scaleY * 16;
     const offset=Buffer.from('200a2d0024411746200a2d0024411846720440200220002a023c4300008041949321020b','hex');
     body=Buffer.concat([body.subarray(0,at),offset,body.subarray(at)]);
     neckPatched=true;
    }
    bodies.push(leb(body.length),body);
   }
   section=Buffer.concat(bodies);
  }
  parts.push(Buffer.from([id]),leb(section.length),section);
 }
 if(!patched || !neckPatched)throw Error('Appearance renderer not found');
 const result=Buffer.concat(parts);if(!WebAssembly.validate(result))throw Error('Invalid appearance patch');return result;
}
