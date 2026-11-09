#!/usr/bin/env node
// Import a compatible package selected by the operator; no default remote source.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const expectedSize = 341708818;
const expectedHash = 'f7f126b0a56d096006dd26f16a4cf6b1d3ab76f641d39b38c8a47081046719a7';
async function main() {
  const source = process.argv[2];
  if (!source) throw Error('Pemakaian: node tools/prepare-client.cjs <lokasi-file-atau-URL-https>');
  const dest = path.resolve('data/client/client.data');
  if (path.resolve(source) === dest) throw Error('File sumber sama dengan tujuan. Pindahkan dulu atau gunakan file sumber lain.');
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  const temp = dest + '.download-' + process.pid;
  let input;
  if (/^https:\/\//i.test(source)) {
    const response = await fetch(source, {signal:AbortSignal.timeout(30 * 60 * 1000)});
    if (!response.ok || !response.body) throw Error('Download gagal: HTTP ' + response.status);
    input = Readable.fromWeb(response.body);
  } else {
    if (/^[a-z]+:\/\//i.test(source)) throw Error('Hanya URL HTTPS atau path lokal yang didukung.');
    input = fs.createReadStream(path.resolve(source));
  }
  let size = 0, last = 0;
  const hash = crypto.createHash('sha256');
  const meter = new Transform({transform(chunk, _enc, cb) {
    size += chunk.length; hash.update(chunk);
    if (size > expectedSize) return cb(Error('Ukuran file melebihi paket yang kompatibel.'));
    if (Date.now() - last > 2000) { process.stdout.write(`\rMenyiapkan ${(size/1048576).toFixed(1)} / ${(expectedSize/1048576).toFixed(1)} MiB`); last = Date.now(); }
    cb(null, chunk);
  }});
  try {
    await pipeline(input, meter, fs.createWriteStream(temp, {flags:'wx'}));
    if (size !== expectedSize || hash.digest('hex') !== expectedHash) throw Error('Ukuran atau SHA-256 tidak cocok; file tidak dipasang.');
    fs.renameSync(temp, dest);
    console.log('\nPaket client terverifikasi dan dipasang di ' + dest);
  } finally { try {fs.unlinkSync(temp)} catch {} }
}
main().catch(e=>{console.error('\nGagal:', e.message);process.exitCode=1;});
