import { hideTickerSetting } from "./hide-ticker-setting";
import { patchItemAppearance } from "./item-appearance";
import { patchDyeAppearance } from "./dye-appearance";
import { extendChatPortraitExports } from "./portrait-exports";
import { patchClothingAnimations } from "./clothing-animation";
import { patchColorSliderDialog } from "./color-slider-dialog";
import { patchRmlUiNativeBridge } from "./rmlui-native-patch";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// Exact audited client. Never apply offsets to an unrecognized upstream revision.
export const CLIENT_SHA256="9e5a82fa90926a8f33f651c672d7eed276538db51b083bfad034d1e7a2cf556d";

function collectLegacyXmlRendererIds(publicCacheDir: string): number[] {
  const xmlDir = path.join(publicCacheDir, "GameData", "ItemRenderers");
  if (!fs.existsSync(xmlDir)) return [];
  const ids: number[] = [];
  for (const name of fs.readdirSync(xmlDir)) {
    const m = /^r(\d+)\.xml$/.exec(name);
    if (!m) continue;
    // Libc++ 32-bit std::string SSO fits at most 10 ASCII bytes inline ("r12345.xml" = 10)
    if (name.length > 10) continue;
    ids.push(Number(m[1]));
  }
  ids.sort((a, b) => a - b);
  return ids;
}

export function patchClient(
  input: Buffer,
  hideWarning: boolean,
  autofillLabel = "Autofill",
  serverName = "MagnoliaPS",
  publicCacheDir = path.resolve(process.cwd(), "public", "cache")
): Buffer {
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
  ["/creativedance", "/disabledemote"],
  ["Creative", "Magnolia"],
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
  const prePatched = Buffer.from(patchDyeAppearance(patchItemAppearance(hideTickerSetting(patchDisplayForegroundPass(output)))));
  const legacyXmlIds = collectLegacyXmlRendererIds(publicCacheDir);
  const patched = Buffer.from(
    patchRmlUiNativeBridge(
      patchColorSliderDialog(patchClothingAnimations(patchMannequinExpression(prePatched), legacyXmlIds))
    )
  );
  if (!WebAssembly.validate(new Uint8Array(patched))) throw new Error("Patched client failed WebAssembly validation");
  return extendChatPortraitExports(patched);
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

  const needle5029 = Buffer.from("200128020028020c110e00200d28029c034100109a03", "hex");
  const insert5029 = Buffer.from(
    "41808119280200220c41848119280200220447044041f48019280200220e41f88019280200220f470440230041c0006b2206240041940a109903430000803f92430000003f94430000404094430000004192211c20064180808088043602242006201c38022803400240200c280200210b4100211141f48019280200210e41f88019280200210f200b2a0204430000004192430000003d94a82109200b2a0208430000004192430000003d94a8210a0340200e28020022102f0100418e0b46044020102d000620094620102d0007200a46710440410121110b0b200e41046a220e200f47201145710d000b2011450d00200b10f806221b43cdcccc3d5d0d00419481182802002203418c0e6a2202280204200b2f010c220141b4026c6a410020012002280208481b2202450d002301280230221245044020032802880e28029001410c6a21120b2006200b2a02043802142006201c200b2a020892380218200641306a2012200641146a10e8022006200629033037030c200b41046a21032006201b20122a0218943802082006201b20122a021494380204200d200b2f010c2003200641246a2201201b20064100200b4101410010f706200d200b2f010c20032001201b10c20d200b2d000e4102490d0020022d00044104460d00200d200b2f010c20032001200b41001080130b200c41046a220c2004470d000b200d28029c0341ecf9172a020041f0f9172a02004300000000410010e509200d28029c034100109a03200641c0006a24000b0b",
    "hex"
  );

  let cp = codeSecBodyStart;
  const [funcCount, afterCount] = readUleb(wasm, cp);
  cp = afterCount;

  const chunks: Buffer[] = [writeUleb(funcCount)];
  let patched4240 = false;
  let patched1518 = false;
  let patched5029 = false;

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
    } else if (fid === 5029) {
      const idx = body.indexOf(needle5029);
      if (idx === -1 || body.indexOf(needle5029, idx + 1) !== -1) {
        throw new Error("func 5029 post-render signature mismatch");
      }
      const after = idx + needle5029.length;
      body = Buffer.concat([body.subarray(0, after), insert5029, body.subarray(after)]);
      patched5029 = true;
    }

    chunks.push(writeUleb(body.length), body);
  }

  if (!patched4240 || !patched1518 || !patched5029) {
    throw new Error(`Failed to patch Display foreground pass (4240=${patched4240}, 1518=${patched1518}, 5029=${patched5029})`);
  }

  const newCodeBody = Buffer.concat(chunks);
  return Buffer.concat([
    wasm.subarray(0, codeSecLenStart),
    writeUleb(newCodeBody.length),
    newCodeBody,
    wasm.subarray(codeSecEnd),
  ]);
}


// Mannequin expression + skin color fix.
//
// Reverse-engineered from GrowtopiaInstaller v3.52 (Growtopia.exe SHA-256
// 20763ab5...1583) and the pinned ReGrowtopia-1.50 upstream.wasm:
//   * Native render branch 0x759e64..0x75a1ef selects the facial expression
//     index per mannequin item (OMG=4, SAD=2, LOL=8, TROLL=15, default 25).
//   * The web client's TileExtra type-14 parser (func 2458, case 14) reads the
//     expression byte and skinColor dword from the packet but discards both,
//     hard-coding a gray skin. The renderer (func 886, case 40) then forces
//     expression index 25 (smile) and tint 0xE6E6E6FF.
//
// Patch 1 (func 2458): store the parsed expression byte at mannequin struct+22
//   and the parsed skinColor at struct+0 instead of the hard-coded gray.
// Patch 2 (func 886): after MannequinRenderData::Init (func 1948), load the
//   expression from struct+22 and the skin tint from struct+0 rather than the
//   hard-coded smile/gray constants.
//
// Both replacements are signature-pinned to the audited upstream revision.
function patchMannequinExpression(wasm: Buffer): Buffer {
  const patches: Array<{ fid: number; old: Buffer; replacement: Buffer }> = [
    {
      fid: 2458,
      old: Buffer.from(
        "2001200841056a200741012002200310cb022001200841086a200741042002200310cb02200828025441ffe9d2a57b360200",
        "hex"
      ),
      replacement: Buffer.from(
        // Keep original f331 reads/cursor advance, then copy skin/expression into mannequin struct.
        "2001200841056a200741012002200310cb022001200841086a200741042002200310cb02200828025422052008280208360200200520082d00053a0016",
        "hex"
      ),
    },
    {
      fid: 339,
      old: Buffer.from("21022000419ab3e6f40336022020002002380214", "hex"),
      replacement: Buffer.from(
        // Initialize both scale/alpha (this+28 = 1.0f) and lifetime (this+32 = 0.3f) for particleType 60 starburst sparkles.
        "2102200042808080fc93b3e6f43e37021c20002002380214",
        "hex"
      ),
    },
    {
      fid: 1948,
      old: Buffer.from(
        "20002f0104220241016a220341b4026c6a410020032001280208481b2201450d002002450d00200141c4006a0c010b200041286a0b2802002101200041193a00b8012000200136022c",
        "hex"
      ),
      replacement: Buffer.from(
        // Read hair item from statePtr+0, preserve expression byte, and force both statePtr+44 and statePtr+48 (hairColor) to -1 (0xFFFFFFFF) so HairRenderer (func 1262) never hits the green 0x00FF00FF alpha-mismatch fallback.
        "20002f0100220241016a220341b4026c6a410020032001280208481b2201450d002002450d00200141c4006a0c010b200041286a0b2802002101200020002d00123a00b8012000417f36022c2000417f360230",
        "hex"
      ),
    },
    {
      fid: 886,
      old: Buffer.from(
        "200041003a008106200041193a0084052000410036028004200041ffcd9bb77e3602f403230a220f410036020041e415100a200f280200200f41003602004101460d09200c42808080fc838080c03f370290032009430000000043000000004100200c4190036a10cc04",
        "hex"
      ),
      replacement: Buffer.from(
        // Persistent 64-slot per-mannequin AvatarRenderData pool (poolGlobalIdx, lazily allocated via memory.grow(1)) keyed by tileExtra ptr + pose + clothesHash (XOR of tileExtra+4..20), rate-limited to >= 3ms so multi-pass renders deduplicate without slowing high-Hz monitors, copying only +124..439 (316 bytes) so clothing updates immediately while emoting; if func 1945 clears pose back to 0 (one-shot emote finished, e.g. /popcorn), invalidate slot[0] = 0 so it loops continuously.
        "200041003a00810620004100360280042000201228020041ff01723602f403201228020041ff01710440230c45044041014000411074240c0b230041c0026b240023002009417c6a41bc02fc0a0000230c2012410476413f714109746a210f200f280200201246200f280204201228020041ff01714671200f28020c2012280204201228020873201228020c73201228021073201228021473467104402009417c6a200f41106a41bc02fc0a00001050b0a7200f2802086b41034f0440200f1050b0a73602082000201228020041ff01713a00c804200910990f200f41106a2009417c6a41bc02fc0a000020002d00c804450440200f41003602000b0b05200f2012360200200f201228020041ff0171360204200f1050b0a7360208200f2012280204201228020873201228020c7320122802107320122802147336020c2000430000803f3802ec042000430000803f3802f4042000201228020041ff01713a00c804200910990f200f41106a2009417c6a41bc02fc0a00000b0b200020122d00163a008405230a220f410036020041e415100a200f280200200f41003602004101460d09200c42808080fc838080c03f370290032009430000000043000000004100200c4190036a10cc04201228020041ff017104402009417c6a230041bc02fc0a0000230041c0026a24000b",
        "hex"
      ),
    },
    {
      fid: 2569,
      old: Buffer.from(
        "41ff8389ae7c2001200220032004200b10352007280200200741003602004101470d180b",
        "hex"
      ),
      replacement: Buffer.from(
        // Append the 4 Super Supporter skin colors (Royal Blue, Ice Blue, Bright Orange, Translucent Ruby Red) to the native Options "Tap to set skin color:" palette.
        "41ff8389ae7c2001200220032004200b10352007280200200741003602004101460d00230a2207410036020041b411200541fff1b0a37d2001200220032004200b10352007280200200741003602004101460d00230a2207410036020041b411200541ffe5a2f67e2001200220032004200b10352007280200200741003602004101460d00230a2207410036020041b411200541ffffa3042001200220032004200b10352007280200200741003602004101460d00230a2207410036020041b41120054190fdd2b8032001200220032004200b10352007280200200741003602004101470d180b",
        "hex"
      ),
    },
    {
      fid: 2620,
      old: Buffer.from("047f20032d00044104460541000b", "hex"),
      replacement: Buffer.from(
        // Show floating Sign/Title bubble for both Sign (extraType 4) and Portrait (extraType 48).
        "047f20032d000441044620032d0004413046720541000b",
        "hex"
      ),
    },
    {
      fid: 2869,
      old: Buffer.from("20052802642205450d022005280204450d02", "hex"),
      replacement: Buffer.from(
        // Allow Magplant 5000 Remote (actionType 112) when client suckerData+4 is unset, while preserving UPSTREAM's seed-only flying animation gate (actionType 19) so non-seed blocks place normally.
        "01",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("047f20002d0004410e460541000b", "hex"),
      replacement: Buffer.from(
        // Render green/dark Sign/Title floating bubble for Portrait (extraType 48) alongside Sign (2) and Mannequin (14).
        "047f20002d0004410e4620002d0004413046720541000b",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("200a2802242201220028022020002c0027", "hex"),
      replacement: Buffer.from(
        // Portrait (extraType 48) stores its label std::string at extra+16 instead of extra+28 (Sign/Mannequin).
        "200a280224220020004110411c20002d00044130461b6a2201220028020420002c000b",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("200a2001411c6a41014100410110a213", "hex"),
      replacement: Buffer.from(
        // Pass resolved label std::string pointer (local 1) directly to bubble creator (func 2466).
        "200a200141014100410110a213",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("2223380224202343cdcc4c3e5e0440", "hex"),
      replacement: Buffer.from(
        // Spawn suck trail particle 197 every 0.07s instead of 0.2s so the suck path is visibly animated.
        "2223380224202343295c8f3d5e0440",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("200420042a022443cdcc4cbe922223380224202343cdcc4c3e5e0d000b", "hex"),
      replacement: Buffer.from(
        // Match 0.07s trail interval inside the particle 197 loop.
        "200420042a022443295c8fbd922223380224202343295c8f3d5e0d000b",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("20042a0210222320042a020822255b20042a020c222620042a021422275b710d06", "hex"),
      replacement: Buffer.from(
        // Clear objType 3 sucker flying effect (entry[4] = 0) once within 1px of target (speedX, speedY), avoiding float32 1-ULP stall.
        "20042a0210222320042a02082225938b430000803f5d20042a020c222620042a02142227938b430000803f5d710440200441003602040c070b",
        "hex"
      ),
    },
    {
      fid: 5029,
      old: Buffer.from("2001280204220441026b0e0d0006060106060602000306060406", "hex"),
      replacement: Buffer.from(
        // Route objType 3 (sucker effect, index 1 = objType - 2) alongside objType 5 into case 1 while branching on objType inside case 1.
        "2001280204220441026b0e0d0001060106060602000306060406",
        "hex"
      ),
    },
    {
      fid: 5055,
      old: Buffer.from("200841036b0e0d0102020202000202020202020002", "hex"),
      replacement: Buffer.from(
        // Skip spawning the initial 6 bee swarm particles (197) when creating objType 3 (Magplant/item sucker flying drop).
        "200841036b0e0d0202020202000202020202020002",
        "hex"
      ),
    },
    {
      fid: 5010,
      old: Buffer.from("380224202343295c8f3d5e04400340", "hex"),
      replacement: Buffer.from(
        // Skip spawning bee swarm particle 197 for objType 3 (Magplant/item sucker flying drop).
        "3802242004280204410347202343295c8f3d5e7104400340",
        "hex"
      ),
    },
    {
      fid: 5029,
      old: Buffer.from(
        "10bb020240230128023022020440200228020022020d010b419481182802002802880e2802900121020b20022802c40210b8022d00e40341017310d1022102200620012a020838027820012a020c211a200642808080fc838080c03f3702702006201a38027c20064200370268410e410d200241c8017041e4004b1b410a200641f8006a200641f0006a4101417f4300000000200641e8006a4100410010c2020c03",
        "hex"
      ),
      replacement: Buffer.from(
        // For objType 3 sucker effects: seeds (actionType 19) draw via WorldToScreen (360) + RenderItemIcon (630) so Gaia's Beacon shows an actual seed; tiles/items draw via world+1872 (322) with spreadType frame offset at 0.5x scale. Leaves objType 5 snowball untouched.
        "20044103460440200128021841004a044041948118280200418c0e6a2001280218109c0b2202044020022d0004411346044010bb0222030440200620012a0208380250200620012a020c380254200641d8006a2003200641d0006a10e8022002200641d8006a20032a0214436666263f94417f417f41004100410110f6040b054194811828020041c80e6a20012802184101108603220b044010bb02200620012a0208380278200620012a020c38027c200642808080f8838080803f37027020064200370268200b20022d002c41034104410020022d002e41024620022d002e4104467220022d002e410546721b20022d002e4103461b6a20022d002d4101410020022d002e41024620022d002e410546721b6a200641f8006a200641f0006a4101417f4300000000200641e8006a4100410010c2020b0b0b0b0c040b" +
          "10bb020240230128023022020440200228020022020d010b419481182802002802880e2802900121020b20022802c40210b8022d00e40341017310d1022102200620012a020838027820012a020c211a200642808080fc838080c03f3702702006201a38027c20064200370268410e410d200241c8017041e4004b1b410a200641f8006a200641f0006a4101417f4300000000200641e8006a4100410010c2020c03",
        "hex"
      ),
    },
    {
      fid: 2835,
      old: Buffer.from("02402008450d0020042d00240d004117", "hex"),
      replacement: Buffer.from(
        // Route Magplant 5000 Remote (itemId 5640) past fast-path BlitAnim (call 545) into RenderItemIcon (call 630) so it draws its configured item mini-preview.
        "02402008450d0020042f010041882c460d0020042d00240d004117",
        "hex"
      ),
    },
    {
      fid: 630,
      old: Buffer.from("230041d0016b22082400", "hex"),
      replacement: Buffer.from(
        // Extend fid 630 stack frame (208 -> 224) and save LocalPlayer+396 configured itemInfo*, original scale, and align for post-draw overlay on 5640 Remote.
        "230041e0016b22082400200841003602d001200028020041882c4604400240419481182802002209450d0020092802880e2209450d00200928028c03220941004c0d00200941882c460d0041948118280200418c0e6a2009109c0b220d450d002008200d3602d001200820023802d401200820073602d8010b0b",
        "hex"
      ),
    },
    {
      fid: 630,
      old: Buffer.from("200841d0016a24000f", "hex"),
      replacement: Buffer.from(
        // Draw 5640 Remote configured item mini-icon via RenderItemIcon (call 630) IN FRONT of the remote (after base/shadow/overlay finish) at full -1 brightness.
        "20082802d001220d044020082a02d401210e20082802d8012107200820012a0200200e430000b041949220012a0200200e430000d04094922007451b3802d001200820012a0204200e4300002041949220012a0204200e430000d0c094922007451b3802d401200d200841d0016a200e43cdcc0c3f94417f417f41004100410110f6040b200841e0016a24000f",
        "hex"
      ),
    },
  ];

  let pos = 8;
  let funcImports = 0;
  let poolGlobalIdx = -1;
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
    } else if (sid === 6) {
      // Append 1 mutable i32 global for the persistent mannequin AvatarRenderData pool.
      const [gCount, gEntriesStart] = readUleb(wasm, bodyStart);
      poolGlobalIdx = gCount;
      const newGlobalBody = Buffer.concat([
        writeUleb(gCount + 1),
        wasm.subarray(gEntriesStart, secEnd),
        Buffer.from("7f0141000b", "hex"),
      ]);
      const newSec = Buffer.concat([writeUleb(newGlobalBody.length), newGlobalBody]);
      wasm = Buffer.concat([wasm.subarray(0, lenStart), newSec, wasm.subarray(secEnd)]);
      pos = lenStart + newSec.length;
      continue;
    } else if (sid === 10) {
      codeSecLenStart = lenStart;
      codeSecBodyStart = bodyStart;
      codeSecEnd = secEnd;
      break;
    }
    pos = secEnd;
  }

  if (codeSecLenStart < 0 || poolGlobalIdx < 0) throw new Error("WASM Code/Global section not found for mannequin patch");
  const gIdxHex = writeUleb(poolGlobalIdx).toString("hex");
  const fid886Patch = patches.find((p) => p.fid === 886)!;
  fid886Patch.replacement = Buffer.from(
    fid886Patch.replacement
      .toString("hex")
      .replace(/230c/g, "23" + gIdxHex)
      .replace(/240c/g, "24" + gIdxHex),
    "hex"
  );

  let cp = codeSecBodyStart;
  const [funcCount, afterCount] = readUleb(wasm, cp);
  cp = afterCount;

  const chunks: Buffer[] = [writeUleb(funcCount)];
  let appliedCount = 0;

  for (let i = 0; i < funcCount; i++) {
    const fid = funcImports + i;
    const [sz, fStart] = readUleb(wasm, cp);
    const fEnd = fStart + sz;
    let body = wasm.subarray(fStart, fEnd);
    cp = fEnd;

    for (const patch of patches.filter((p) => p.fid === fid)) {
      const idx = body.indexOf(patch.old);
      if (idx === -1 || body.indexOf(patch.old, idx + 1) !== -1) {
        throw new Error(`Mannequin patch signature mismatch in func ${fid}`);
      }
      body = Buffer.concat([
        body.subarray(0, idx),
        patch.replacement,
        body.subarray(idx + patch.old.length),
      ]);
      appliedCount++;
    }

    chunks.push(writeUleb(body.length), body);
  }

  if (appliedCount !== patches.length) {
    throw new Error(`Mannequin patch count mismatch: applied ${appliedCount} of ${patches.length}`);
  }

  const newCodeBody = Buffer.concat(chunks);
  return Buffer.concat([
    wasm.subarray(0, codeSecLenStart),
    writeUleb(newCodeBody.length),
    newCodeBody,
    wasm.subarray(codeSecEnd),
  ]);
}
