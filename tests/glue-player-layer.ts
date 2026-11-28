// Run: npx esbuild tests/glue-player-layer.ts --bundle --platform=node --format=cjs --outfile=/tmp/glue-player-layer.cjs && node /tmp/glue-player-layer.cjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchClient } from '../server/client/patch-client';

function uleb(data: Buffer, at: number): [number, number] {
  let value = 0, shift = 0;
  for (;;) {
    assert(at < data.length, 'truncated wasm');
    const byte = data[at++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) return [value, at];
    shift += 7;
    assert(shift < 35);
  }
}
function codeBodies(wasm: Buffer): Buffer[] {
  for (let p = 8; p < wasm.length;) {
    const id = wasm[p++];
    const [size, body] = uleb(wasm, p);
    const end = body + size;
    if (id === 10) {
      const [count, start] = uleb(wasm, body);
      const result: Buffer[] = [];
      let i = start;
      for (let n = 0; n < count; n++) {
        const [len, begin] = uleb(wasm, i);
        result.push(wasm.subarray(begin, begin + len));
        i = begin + len;
      }
      assert.equal(i, end);
      return result;
    }
    p = end;
  }
  throw new Error('missing code section');
}
const upstream = fs.readFileSync('data/client/upstream.wasm');
const patched = patchClient(upstream, false);
assert(WebAssembly.validate(new Uint8Array(patched)), 'patched client validates');
const originalBodies = codeBodies(upstream);
const bodies = codeBodies(patched);
// Pinned client imports 308 functions; the new pass is the first appended one.
const index = 308 + originalBodies.length;
assert.equal(index, 5645);
const call = Buffer.from([0x10, 0x8d, 0x2c]);
const returnSequence = Buffer.from('200941406b24000f', 'hex');
const terrain = bodies[4240 - 308], overlay = bodies[5029 - 308];
assert(terrain.includes(Buffer.concat([call, returnSequence])), 'glue must run at end of terrain renderer');
assert(!overlay.includes(call), 'overlay renderer must not render glue');
const glue = bodies[index - 308];
assert(glue.includes(Buffer.from('4180107104', 'hex')), 'checks the glue flag');
assert(glue.includes(Buffer.from('41d9c7004120412010960e', 'hex')), 'uses the particles texture');
assert(glue.includes(Buffer.from('4105410520', 'hex')), 'uses glue sprite frame');
assert.throws(() => patchClient(Buffer.alloc(32), false), /Unsupported upstream client revision/);
console.log('PASS: glue pass moved from overlay renderer to terrain renderer; WASM validates');
