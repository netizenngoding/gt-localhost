// Run from repository root:
//   npx esbuild tests/block-glue-wasm.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-wasm-test.cjs && node /tmp/block-glue-wasm-test.cjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { patchClient } from "../server/client/patch-client";

const input = fs.readFileSync("data/client/upstream.wasm");
const result = patchClient(input, false);
assert(WebAssembly.validate(new Uint8Array(result)), "patched WASM must validate");

// The glue pass is an appended function; 5029 calls it immediately BEFORE the
// tile batch flush so the quads are queued after the terrain quads and are
// submitted in the same batch:
//   terrain quads ... call <glue> ; call 410 (flush) ; reset visible list ; ...
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
// The call sits right before the flush anchor. Later patches (foreground tile
// pass, mannequin, RmlUi bridge) rewrite parts of 5029, so locate the call by
// scanning backwards for `call <appended>` rather than assuming an offset.
const callBytes = Buffer.concat([Buffer.from([0x10]), Buffer.from([0x8d, 0x2c])]); // call 5645
assert(at - 8 >= 0, "anchor too close to start");
assert(result.subarray(at - callBytes.length, at).equals(callBytes), "glue call (to the appended function) must precede the tile batch flush");

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

// Dropped items must be drawn AFTER the player. 5029 is not the last renderer:
// the frame dispatcher (2781) runs the renderer list through the vtable, and the
// player renderer (4310) sits after 5029 (table 1806 vs 1917). So the drop loop
// is lifted into an appended function that the dispatcher calls as its last
// draw, and the in-frame loop is turned into dead code.
// `i32.const 385392; i32.load; i32.const 0; call <drop>; call 2786; end`
const dispatch = Buffer.from("41f0c217" + "280200" + "4100" + "108e2c" + "10e2150b", "hex");
assert(result.includes(dispatch), "drop pass must be the last draw of the frame, right before the frame flag");
// The in-frame drop loop must not run any more (dead-coded `if`).
assert(result.includes(Buffer.from("1a4100" + "0440" + "0340", "hex")), "in-frame drop loop must be dead-coded");
// The appended pass must carry 5029's local list so the lifted code lines up.
assert(result.includes(Buffer.from("04187f0d7d067e047c" + "200041b4026a", "hex")), "drop pass must declare 5029's locals");

// The appended function must reuse the empty () -> nil signature (type 8).
assert.equal(WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(result))).length > 0, true);

assert.throws(() => patchClient(Buffer.alloc(32), false), /Unsupported upstream client revision/);
console.log("PASS: glue queues before the tile flush, and the drop pass is the last draw of the frame (after the player)");
