/** Remove the pinned options checkbox construction, callback wiring and row. */
function read(b:Buffer,p:number):[number,number]{let n=0,s=0;while(p<b.length&&s<35){const x=b[p++];n|=(x&127)<<s;if(!(x&128))return[n>>>0,p];s+=7;}throw Error('Invalid WASM length');}
function leb(n:number):Buffer{const out:number[]=[];do{const x=n&127;n>>>=7;out.push(x|(n?128:0));}while(n);return Buffer.from(out);}
export function hideTickerSetting(input:Buffer):Buffer {
 const parts:Buffer[]=[input.subarray(0,8)];let p=8,found=0;
 const signature=Buffer.from('4190052005200041c8096a200041bc096a200b200c41b085181a410120002802d40f20002a02d80f410010302102','hex');
 while(p<input.length){const id=input[p++],[size,start]=read(input,p);p=start+size;if(p>input.length)throw Error('Truncated WASM');let data=input.subarray(start,p);
  if(id===10){const [n,end]=read(data,0);const bodies:Buffer[]=[data.subarray(0,end)];let q=end;
   for(let i=0;i<n;i++){const [length,bodyStart]=read(data,q);q=bodyStart+length;let body=data.subarray(bodyStart,q);const at=body.indexOf(signature);
    if(at>=0){
     if(body.indexOf(signature,at+1)>=0)throw Error('Duplicate ticker widget');found++;
     // Skip the entire checkbox creation and callback wiring, preserving only
     // the two string destructors (the strings were constructed immediately before).
     const cleanupStart=body.indexOf(Buffer.from('20002c00c7094100480440','hex'),at);
     const cleanupEnd=body.indexOf(Buffer.from('411810b602','hex'),cleanupStart);
     const finish=body.indexOf(Buffer.from('200041306a20024100410110b704','hex'),cleanupEnd);
     if(cleanupStart<0||cleanupEnd<0||finish<0||finish-at>900)throw Error('Ticker construction tail changed');
     body=Buffer.concat([body.subarray(0,at),body.subarray(cleanupStart,cleanupEnd),body.subarray(finish+14)]);
     // Leave the next option at the previous y, rather than reserving a blank row.
     const advance=Buffer.from('2000200c200d20002a023c9220002a02349392220c3802dc0f','hex');
     const y=body.indexOf(advance,at);
     if(y<0||y-at>150)throw Error('Ticker row advancement changed');
     body=Buffer.concat([body.subarray(0,y),Buffer.from('2000200c3802dc0f','hex'),body.subarray(y+advance.length)]);
    }
    bodies.push(leb(body.length),body);
   }
   if(q!==data.length)throw Error('Unexpected WASM code data');data=Buffer.concat(bodies);
  }
  parts.push(Buffer.from([id]),leb(data.length),data);
 }
 if(found!==1)throw Error('Ticker setting not found');const output=Buffer.concat(parts);if(!WebAssembly.validate(output))throw Error('Ticker setting patch invalid');return output;
}
