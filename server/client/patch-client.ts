import { hideTickerSetting } from "./hide-ticker-setting";
import { patchItemAppearance } from "./item-appearance";
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
 if(!WebAssembly.validate(output)) throw new Error("Patched client failed WebAssembly validation");
 return extendChatPortraitExports(patchItemAppearance(hideTickerSetting(output)));
}
