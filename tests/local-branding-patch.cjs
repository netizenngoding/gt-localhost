const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-branding-'));
try {
  const out = path.join(tmp, 'patch.cjs');
  esbuild.buildSync({ entryPoints: ['server/client/patch-client.ts'], outfile: out, bundle: true, platform: 'node', format: 'cjs' });
  const {patchClient} = require(out);
  const source = fs.readFileSync('data/client/upstream.wasm');
  const patched = patchClient(source, true, 'Autofill');
  assert.equal(source.length, patched.length);
  assert.ok(WebAssembly.validate(patched));
  assert.ok(patched.includes(Buffer.from('Autofill')));
  for (const text of ['Creative Growtopia', 'CreativePS', 'creativeps.eu', 'ReGrowtopia', 'regrowtopia'])
    assert.ok(!patched.includes(Buffer.from(text)), `Unexpected legacy string: ${text}`);
  assert.ok(patched.includes(Buffer.from('MagnoliaAppIWantANewFlag')));
  assert.ok(!patched.includes(Buffer.from('Enable `5AutoFill`` (automatically completes commands) (`2Experimental``)')));
  assert.throws(() => patchClient(Buffer.alloc(20), true, 'Autofill'), /Unsupported/);
  console.log('PASS: pinned binary, replacement label and WASM structure');
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }
