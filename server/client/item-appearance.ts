import crypto from 'node:crypto';
function read(b:Buffer,p:number):[number,number] { let n=0,s=0; while(p<b.length && s<35){const v=b[p++];n|=(v&127)<<s;if(v<128)return[n>>>0,p];s+=7;}throw Error('Invalid WASM length'); }
function leb(n:number):Buffer {const a:number[]=[];do {const v=n&127;n>>>=7;a.push(v|(n?128:0));}while(n);return Buffer.from(a);}
/** Pinned native face renderer f781. ItemDef+36 is the item kind.
 * Match kind 14, not one item ID. The shirt renderer f1937 already applies
 * this same kind to its skin-color argument; leave that path unchanged.
 * Renderer+32 carries effective skin/status/lighting for world AND portraits.
 */
export function patchItemAppearance(input:Buffer):Buffer {
 const parts:Buffer[]=[input.subarray(0,8)];let p=8,patched=false;
 while(p<input.length) {
  const id=input[p++],[len,start]=read(input,p);p=start+len;
  let section=input.subarray(start,p);
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
     body=Buffer.concat([body.subarray(0,op),tint,body.subarray(op)]);patched=true;
    }
    bodies.push(leb(body.length),body);
   }
   section=Buffer.concat(bodies);
  }
  parts.push(Buffer.from([id]),leb(section.length),section);
 }
 if(!patched)throw Error('Face renderer not found');
 const result=Buffer.concat(parts);if(!WebAssembly.validate(result))throw Error('Invalid appearance patch');return result;
}
