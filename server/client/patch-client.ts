import { hideTickerSetting } from "./hide-ticker-setting";
import { patchItemAppearance } from "./item-appearance";
import { patchDyeAppearance } from "./dye-appearance";
import { extendChatPortraitExports } from "./portrait-exports";
import crypto from "node:crypto";
// Exact audited client. Never apply offsets to an unrecognized upstream revision.
export const CLIENT_SHA256="9e5a82fa90926a8f33f651c672d7eed276538db51b083bfad034d1e7a2cf556d";
export function patchClient(input:Buffer,hideWarning:boolean, autofillLabel = "Autofill", serverName = "MagnoliaPS"):Buffer {
 if(crypto.createHash("sha256").update(input).digest("hex")!==CLIENT_SHA256) throw new Error("Unsupported upstream client revision; native patches require a new audit");
 const output=Buffer.from(input);
 if(hideWarning) {
  // Function 4815 (item parser), ONLY its obsolete no-custom-items diagnostic.
  // i32.const 35086; i32.const 0; call 1813 -> keep args then drop/drop/nop.
  const signature=Buffer.from("418e9202410010950e","hex"),at=output.indexOf(signature);
  if(at<0 || output.indexOf(signature,at+1)!==-1) throw new Error("Native diagnostic signature changed");
  output.set([0x1a,0x1a,0x01],at+6);
 }
 // MenuBackgroundComponent::OnAdd, func4646: random(32) -> random(0).
 // Selects the default purple-hills/sun renderer; world-weather factory is untouched.
 const weather=Buffer.from("412010d402220141054a","hex"),w=output.indexOf(weather);
 if(w<0 || output.indexOf(weather,w+1)!==-1) throw new Error("Native menu weather signature changed");
 output[w+1]=0;
 // Fixed-width replacement preserves the WASM layout and any compiled string length.
 const original=Buffer.from("Enable `5AutoFill`` (automatically completes commands) (`2Experimental``)", "ascii");
 const at=output.indexOf(original);
 const label=Buffer.from(autofillLabel,"ascii");
 if(at<0 || output.indexOf(original,at+1)!==-1 || label.length>original.length || !/^[\x20-\x7e]+$/.test(autofillLabel)) throw new Error("Unsupported Autofill label or client signature");
 output.fill(0x20,at,at+original.length); label.copy(output,at);
 // Native news ticker visibility flag, VA 393904 in this pinned build.
 // Each load8_u of the flag is replaced by drop; i32.const 1: the client
 // consistently sees the existing "hide news ticker" setting as enabled.
 // The loaded address is still dropped, preserving stack and instruction sizes.
 const tickerRead=Buffer.from("41b085182d0000","hex");
 let tickerOffset=0, tickerCount=0;
 while((tickerOffset=output.indexOf(tickerRead,tickerOffset))!==-1){
   output.set([0x1a,0x41,0x01],tickerOffset+4); tickerOffset+=tickerRead.length;tickerCount++;
 }
 if(tickerCount!==3) throw new Error("Native ticker signature changed");
 // Same-width replacement keeps WASM addresses and compiled lengths intact.
 // Do not drop attribution; retain notices separately when redistributing.
 const identity: [string,string][] = [
  ["creativeps.eu", "magnolia.test"],
  ["Creative Growtopia", serverName.slice(0,18).padEnd(18," ")],
  ["CreativePS", "MagnoliaPS"],
  ["ReGrowtopia", "MagnoliaApp"],
  ["regrowtopia", "magnoliaapp"],
  ["CREATIVE", "MAGNOLIA"],
  ["Creative", "Magnolia"],
  ["creative", "magnolia"],
 ];
 for (const [from,to] of identity) {
   const old=Buffer.from(from,"ascii"), replacement=Buffer.from(to,"ascii");
   if(old.length!==replacement.length || !/^[\x20-\x7e]+$/.test(to)) throw new Error("Native branding requires ASCII and fixed-width replacement");
   let offset=0, count=0;
   while ((offset=output.indexOf(old,offset))!==-1) { replacement.copy(output,offset); offset+=old.length; count++; }
   if (!count) throw new Error(`Native branding signature not found: ${from}`);
 }
 const punchAutoAimPatches: ReadonlyArray<[string, string]> = [
   [
     "200220252023430000003f9443000000429222248c202420031b92380200",
     "200220252023430000003f9492430000004222248c202420031b92380200"
   ],
   [
     "200220252023430000003f9443000080429222248c202420031b92380200",
     "200220252023430000003f9492430000804222248c202420031b92380200"
   ],
   [
     "41d78b084100109b05",
     "010101010101010101"
   ]
 ];
 for (const [fromHex, toHex] of punchAutoAimPatches) {
   const oldBytes = Buffer.from(fromHex, "hex");
   const newBytes = Buffer.from(toHex, "hex");
   const offset = output.indexOf(oldBytes);
   if (offset === -1) throw new Error(`Punch auto-aim signature not found: ${fromHex}`);
   if (output.indexOf(oldBytes, offset + oldBytes.length) !== -1) {
     throw new Error(`Multiple matches for punch auto-aim signature: ${fromHex}`);
   }
   newBytes.copy(output, offset);
 }
  // Foreground tile render pass fix:
  // 1) In func 4240 (TerrainRenderCache, runs before players), skip foreground (isBG == 0)
  //    tiles whose ItemDef flags (item+54) have Property_Foreground (0x2000, e.g. Display Box 1422).
  // 2) Replace func 1518 (TileOverlayComponent::PostRender, vtable+12, called at func 5029 after players
  //    and right before batch flush) to render all visible fg tiles with flags & 0x2000.
  const patched = patchDisplayForegroundPass(output);
 if(!WebAssembly.validate(new Uint8Array(patched))) throw new Error("Patched client failed WebAssembly validation");
 return extendChatPortraitExports(Buffer.from(patchDyeAppearance(patchItemAppearance(hideTickerSetting(patched)))));
}

function readUleb(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
}

function writeUleb(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return Buffer.from(out);
}

function patchDisplayForegroundPass(wasm: Buffer): Buffer {
  let pos = 8;
  let funcImports = 0;
  let codeSecStart = -1;
  let codeSecLenStart = -1;
  let codeSecBodyStart = -1;
  let codeSecEnd = -1;

  while (pos < wasm.length) {
    const sid = wasm[pos++];
    const lenStart = pos;
    const [secLen, bodyStart] = readUleb(wasm, pos);
    const secEnd = bodyStart + secLen;
    if (sid === 2) {
      let ip = bodyStart;
      const [impCount, p2] = readUleb(wasm, ip);
      ip = p2;
      for (let i = 0; i < impCount; i++) {
        const [ml, p3] = readUleb(wasm, ip);
        ip = p3 + ml;
        const [nl, p4] = readUleb(wasm, ip);
        ip = p4 + nl;
        const kind = wasm[ip++];
        if (kind === 0) {
          [, ip] = readUleb(wasm, ip);
          funcImports++;
        } else if (kind === 1) {
          ip++;
          const [fl, p5] = readUleb(wasm, ip);
          [, ip] = readUleb(wasm, p5);
          if (fl & 1) [, ip] = readUleb(wasm, ip);
        } else if (kind === 2) {
          const [fl, p5] = readUleb(wasm, ip);
          [, ip] = readUleb(wasm, p5);
          if (fl & 1) [, ip] = readUleb(wasm, ip);
        } else if (kind === 3) {
          ip += 2;
        }
      }
    } else if (sid === 10) {
      codeSecStart = lenStart - 1;
      codeSecLenStart = lenStart;
      codeSecBodyStart = bodyStart;
      codeSecEnd = secEnd;
      break;
    }
    pos = secEnd;
  }

  if (codeSecStart < 0) throw new Error("WASM Code section not found");

  const needle4240 = Buffer.from(
    "20092009290238370214200120032005200941146a4100200020022d000822004100200d20001b10f606",
    "hex"
  );
  const replacement4240 = Buffer.from(
    "20092009290238370214024020022d00084504402003419481182802002802940e490440419481182802002802900e200341b4026c6a2f01364180c000710d020b0b200120032005200941146a4100200020022d000822004100200d20001b10f6060b",
    "hex"
  );
  const body1518 = Buffer.from(
    "01087f230041206b2203240041f48019280200220441f8801928020022054704400340200428020022062f0100220704402007419481182802002802940e490440419481182802002802900e200741b4026c6a2f01364180c0007104400240230128023022080440200828020022080d010b419481182802002802880e2802900121080b10bb022109200320062d0007b3430000004294380204200320062d0006b3430000004294380200200341086a220a2009200310e8022008200720062f010a200a410020064100410010f6060b0b0b200441046a22042005470d000b0b200341206a24000b",
    "hex"
  );

  let cp = codeSecBodyStart;
  const [funcCount, afterCount] = readUleb(wasm, cp);
  cp = afterCount;

  const chunks: Buffer[] = [writeUleb(funcCount)];
  let patched4240 = false;
  let patched1518 = false;

  for (let i = 0; i < funcCount; i++) {
    const fid = funcImports + i;
    const [sz, fStart] = readUleb(wasm, cp);
    const fEnd = fStart + sz;
    let body = wasm.subarray(fStart, fEnd);
    cp = fEnd;

    if (fid === 1518) {
      body = body1518;
      patched1518 = true;
    } else if (fid === 4240) {
      const idx = body.indexOf(needle4240);
      if (idx === -1 || body.indexOf(needle4240, idx + 1) !== -1) {
        throw new Error("func 4240 call 886 signature mismatch");
      }
      body = Buffer.concat([body.subarray(0, idx), replacement4240, body.subarray(idx + needle4240.length)]);
      patched4240 = true;
    }

    chunks.push(writeUleb(body.length), body);
  }

  if (!patched4240 || !patched1518) {
    throw new Error(`Failed to patch Display foreground pass (4240=${patched4240}, 1518=${patched1518})`);
  }

  const newCodeBody = Buffer.concat(chunks);
  return Buffer.concat([
    wasm.subarray(0, codeSecLenStart),
    writeUleb(newCodeBody.length),
    newCodeBody,
    wasm.subarray(codeSecEnd),
  ]);
}
