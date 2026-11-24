// Called only after patchClient has verified the upstream SHA-256. Export-only:
// no function body, table index, memory layout or asset is changed.
export const PORTRAIT_EXPORTS: Record<string, number> = {portraitDraw:588,portraitResources:835,portraitApply:1514,portraitDestroy:549};
function leb(n:number):Buffer {const out:number[]=[];do{const b=n&127;n>>>=7;out.push(b|(n?128:0));}while(n);return Buffer.from(out);}
function read(b:Buffer,p:number):[number,number]{let n=0,s=0;while(p<b.length&&s<35){const x=b[p++];n|=(x&127)<<s;if(!(x&128))return[n>>>0,p];s+=7;}throw new Error('Invalid WASM section');}
export function extendChatPortraitExports(input:Buffer):Buffer {
 const parts:Buffer[]=[input.subarray(0,8)];let p=8,found=false;
 while(p<input.length){const id=input[p++],[size,start]=read(input,p);p=start+size;if(p>input.length)throw new Error('Truncated WASM section');let body=input.subarray(start,p);
  if(id===7){found=true;const [count,end]=read(body,0);const extra=Object.entries(PORTRAIT_EXPORTS).map(([name,index])=>Buffer.concat([leb(Buffer.byteLength(name)),Buffer.from(name),Buffer.from([0]),leb(index)]));body=Buffer.concat([leb(count+extra.length),body.subarray(end),...extra]);}
  parts.push(Buffer.from([id]),leb(body.length),body);
 }
 if(!found)throw new Error('Missing WASM exports');const result=Buffer.concat(parts);if(!WebAssembly.validate(result))throw new Error('Invalid portrait bridge');return result;
}
