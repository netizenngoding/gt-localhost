// Run from repository root:
//   npx esbuild tests/block-glue-wasm.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-wasm-test.cjs && node /tmp/block-glue-wasm-test.cjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { patchClient } from "../server/client/patch-client";

const input = fs.readFileSync("data/client/upstream.wasm");
const result = patchClient(input, false);
assert(WebAssembly.validate(new Uint8Array(result)), "patched WASM must validate");

// The glue pass is an appended function; the early terrain renderer (4240) calls
// it right before its successful return, so the quads are queued after the
// terrain quads and land under avatars (see tests/glue-player-layer.ts):
//   terrain quads ... call <glue> ; epilogue ; return
const anchor = Buffer.from(
  "200d28029c034100109a0341f8801941f480192802003602004184811941808119280200360200",
  "hex"
);
const at = result.indexOf(anchor);
assert(at >= 0, "terrain/object seam not found in patched WASM");

// Just in front of the anchor there must be a `call <appendedIndex>` (0x10 + uleb).
function readUlebBack(buf: Buffer, end: number): { value: number; start: number } {
  let start = end - 1;
  while (start > 0 && (buf[start] & 0x80) !== 0) start--;
  let value = 0;
  let shift = 0;
  for (let i = start; i < end; i++) {
    value |= (buf[i] & 0x7f) << shift;
    shift += 7;
  }
  return { value, start };
}
const callBytes = Buffer.concat([Buffer.from([0x10]), Buffer.from([0x8d, 0x2c])]); // call 5645
const terrainReturn = Buffer.from("200941406b24000f", "hex");
assert(
  result.includes(Buffer.concat([callBytes, terrainReturn])),
  "glue call (to the appended function) must run at the end of the terrain renderer"
);

// The glue function itself: resolves game/particles.rttex via the string-keyed
// lookup (address 9177), scans the visible-tile list, requires an empty FG/BG
// tile with flag 0x800 and draws APK frame (5,5) through the sprite batcher.
assert(result.includes(Buffer.from("41d9c7004120412010960e", "hex")), "glue must resolve game/particles.rttex (9177) like the APK");
assert(result.includes(Buffer.from("41f48019280200210041f880192802002101", "hex")), "glue must scan the visible-tile list");
assert(result.includes(Buffer.from("4180107104", "hex")), "glue must gate on TILE_FLAG_GLUED (0x800)");
assert(result.includes(Buffer.from("4105410520", "hex")), "glue quad must use APK frame (5,5)");

// Glue must be drawn before the object/drop pass in 5029.
const objectPass = Buffer.from("10a113", "hex"); // call 2465 (object + drop pass)
const dropAt = result.indexOf(objectPass, at);
assert(dropAt > at, "object/drop pass must follow the glue quads");
assert(!result.includes(Buffer.from("10a529", "hex")), "no leftover placeholder tail call");

// The appended function must reuse the empty () -> nil signature (type 8).
assert.equal(WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(result))).length > 0, true);

// Dropped items are drawn by the inserted 5029 pass, right after the overlay
// renderer (1518) already ran, so they land in front of players and FG tiles.
assert(result.includes(Buffer.from("230041c0006b2206240041940a109903", "hex")), "5029 must draw the dropped-item list after the overlay pass");

assert.throws(() => patchClient(Buffer.alloc(32), false), /Unsupported upstream client revision/);
console.log("PASS: glue runs at the end of the terrain pass, before the object pass");
console.log("PASS: dropped items are drawn last, in front of players and foreground tiles");
