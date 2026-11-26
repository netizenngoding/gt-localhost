# Block Glue — server + visual WASM

`TILE_FLAG_GLUED = 0x0800`. `0x1000` adalah `TILE_FLAG_ON_FIRE`, bukan Glue.

## Perubahan
- Toggle Glue, konsumsi inventory hanya saat menempel, lepas tanpa konsumsi.
- Flag Glue dipertahankan saat foreground/background ditempatkan atau dihancurkan, harvest tree, crystal recipe, dan Display Block.
- Full tile update dikirim ke semua viewer saat Glue berubah.
- `server/client/patch-client.ts` mem-patch fungsi WASM 5029: tile kosong (FG/BG kosong) dengan flag `0x0800` menggambar frame atlas `particles.rttex` `(5,5)` milik client APK/web yang kompatibel. Render api `0x1000` tidak diubah.
- Patch menolak WASM yang signature/hash-nya tidak cocok dan memvalidasi hasil patch.

## Test
```sh
npm run typecheck
npx esbuild tests/block-glue.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-test.cjs
node /tmp/block-glue-test.cjs
npx esbuild tests/block-glue-wasm.ts --bundle --platform=node --format=cjs --outfile=/tmp/block-glue-wasm-test.cjs
node /tmp/block-glue-wasm-test.cjs
npm run build
```

## Batasan
Visual sudah dipatch untuk tile kosong. Sambungan antarblok, dua client nyata, performa world besar, dan perangkat fisik belum diverifikasi. Hard refresh client setelah restart server.
