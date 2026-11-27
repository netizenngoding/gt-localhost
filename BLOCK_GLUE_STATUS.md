# Block Glue — server + visual WASM

`TILE_FLAG_GLUED = 0x0800`. `0x1000` adalah `TILE_FLAG_ON_FIRE`, bukan Glue.

## Perubahan
- Toggle Glue, konsumsi inventory hanya saat menempel, lepas tanpa konsumsi.
- Flag Glue dipertahankan saat foreground/background ditempatkan atau dihancurkan, harvest tree, crystal recipe, dan Display Block.
- Full tile update dikirim ke semua viewer saat Glue berubah.
- `public/cache/game/particles.rttex` ditambahkan (atlas asli dari APK 1.50). Tanpa file ini `/cache/game/particles.rttex` 404 dan Glue tidak pernah bisa digambar.
- `server/client/patch-client.ts` menambahkan pass Glue sebagai **fungsi WASM baru** (index 5645, signature `() -> nil`) dan menyisipkan satu `call` ke dalam fungsi 5029 **tepat sebelum batch tile di-flush**:

  ```
  quad terrain ...                      <- pass tile
  call <glue>                           <- disisipkan di sini (daftar tile masih terisi)
  call 410                              <- batch di-flush: terrain + Glue terkirim bersama
  reset visible list
  pass objek / player
  ```

  Glue jadi **di atas tanah, di bawah semua objek & avatar**. Urutan dropped item diatur terpisah (lihat poin berikutnya). Render api `0x1000` tidak diubah.

  Tiga hal yang harus benar sekaligus (semuanya pernah salah):
  1. **Posisi**: sebelum flush + reset daftar tile. Kalau disisipkan setelah `[409720] = [409716]`, loop-nya membaca daftar kosong dan tidak menggambar apa pun.
  2. **Cara**: bukan inline di 5029. Kode inline merebut local milik 5029 dan merusak render. Sekarang badannya ada di fungsi terpisah, jadi stack dan local 5029 tidak tersentuh.
  3. **Atlas**: handle dicari lewat lookup berbasis string `resolve(9177, 32, 32)` — `9177` adalah alamat `game/particles.rttex` di memori client — lalu quad dikirim ke sprite batcher dengan frame `(5,5)`, sama seperti APK.
- **Dropped item di atas player.** 5029 **bukan** renderer terakhir. Dispatcher frame (fungsi `2781`) menjalankan daftar renderer lewat vtable, dan renderer player (`4310`, indeks tabel 1917) ada **setelah** 5029 (indeks tabel 1806) — itu sebabnya player menutupi dropped item. Perbaikannya:
  - loop dropped item dikeluarkan dari 5029 (di 5029 sisanya jadi dead code: `drop; i32.const 0` di depan `if` milik loop), lalu
  - loop yang sama dipasang sebagai fungsi baru (index 5646, signature `(i32,i32) -> nil`, memakai daftar local 5029 apa adanya) dan dipanggil dari `2781` **tepat sebelum `call 2786`** — jadi setelah semua renderer frame, sebagai gambar terakhir.
  Patch menolak diterapkan kalau tail `2781` atau loop di 5029 tidak cocok.
- Klaim lama "pass objek `2465` menggambar dropped item di akhir 5029, jadi drop sudah paling depan" **salah** dan sudah dihapus.
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

## Verifikasi
- `tests/block-glue-wasm.ts`: memastikan pass Glue ada sebelum flush terrain (atlas + frame (5,5)), loop drop di 5029 sudah dead code, dan pass drop dipanggil sebagai gambar terakhir frame (sebelum `call 2786`).
- `tests/block-glue.ts`: perilaku server (toggle, inventory, permission, broadcast, persistence).
- **Uji browser nyata** (Chromium + SwiftShader, server lokal): world dimuat, tile Glue digambar sebagai splat `particles.rttex` frame (5,5) di baris tempat player berdiri, dan player tergambar **di atas** Glue. Screenshot: `glue_visible.png` / `fz1_pre.png`.

## Batasan
Skala/posisi Glue mengikuti APK (satu tile penuh). Sambungan antarblok, dua client nyata bersamaan, dan performa world besar belum diuji. Hard refresh client setelah restart server.
