// Run from repository root: npx esbuild tests/block-glue-wasm.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-wasm-test.cjs && node /tmp/block-glue-wasm-test.cjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { patchClient } from "../server/client/patch-client";

const input = fs.readFileSync("data/client/upstream.wasm");
const result = patchClient(input, false);
assert(WebAssembly.validate(new Uint8Array(result)), "patched WASM must validate");
// Native glue flag and the APK's particle-atlas frame 5,5, inside the injected pass.
const guard = Buffer.from("200141801071454520022f01004571", "hex");
assert(result.includes(guard), "native Glue visual guard missing");
assert.throws(() => patchClient(Buffer.alloc(32), false), /Unsupported upstream client revision/);
console.log("PASS: patched WASM validates, Glue visual guard is present, unsupported builds rejected");
