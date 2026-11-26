# Perbaikan Modern UI dan chat

## Temuan dan perubahan

- Callback resource RmlUi sebelumnya memakai synchronous XHR di main thread. Sekarang resource disiapkan secara asynchronous; sprite, font, dan ikon yang diketahui di-cache sebelum dokumen ditampilkan. Dokumen yang gagal di native dicoba melalui Shadow DOM.
- Prewarm dokumen tidak lagi menampilkan HUD/modal sementara dan prewarm dihentikan setelah timeout. Mount native diserialisasi; prewarm dan tick HUD berbagi promise mount yang sama.
- HUD bawaan tetap aktif sampai sidebar siap. Portrait tidak lagi memanggil `gl.finish()` secara eksplisit; readback GPU dan parsing WASM tetap dapat memakan waktu.
- Pada uji browser, setelah transisi world ditemukan `ConsoleLogParent.pos2d.y` bernilai sekitar `1e25`, sehingga chat keluar dari layar. Kode memulihkan nilai yang tidak finite atau jauh di luar layar, tanpa mengubah posisi normal atau console yang sengaja disembunyikan. Layout diperbarui lagi saat spawn dan dibatasi di viewport kecil.

## Menjalankan

```sh
npm ci
npm run typecheck
npm run build
npm start
```

Refresh halaman setelah deploy. Gunakan data store cadangan untuk pengujian: tes membuat akun guest dan mengubah state world. Tes browser opsional memerlukan Playwright dan browser Chromium:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# terminal 1: DATA_STORE_DIR harus direktori terpisah dari data produksi
DATA_STORE_DIR=/tmp/gt-ui-test PORT=3000 npm start
# terminal 2:
BASE_URL=http://127.0.0.1:3000 node tests/modern-ui-browser.cjs
```

Tes browser memeriksa boot, font, HUD, mailbox, pemulihan koordinat chat yang dirusak secara terkontrol, dan dua siklus keluar/masuk world. Ini bukan uji login/logout penuh berulang, pengujian semua dialog, semua ukuran layar, atau jaminan bebas lag. Tiga siklus dalam pengujian headless sempat timeout pada transisi HUD; perlu investigasi dan uji ulang pada browser/perangkat nyata sebelum menyatakan masalah selesai secara menyeluruh.

## Pembaruan dungeon, ikon, animasi, dan mobile

Template dungeon dan leaderboard yang disertakan sekarang memakai teks yang tersedia untuk native RmlUi; template dalam `ui-assets.json` juga diperbarui agar hasil prewarm sama dengan file RML. Ikon hadiah berdasarkan `Id`/`ItemID` serta ikon statis dungeon disiapkan sebelum rendering. Modal dibuka dan ditutup tanpa animasi; sidebar tetap memakai transisi slide.

Di perangkat dengan pointer coarse, resolusi overlay RmlUi dibatasi pada DPR 1 dan render ditargetkan sekitar 30 fps; teks bisa terlihat lebih lembut dibanding DPR asli. Portrait sidebar menggunakan cache portrait chat apabila tampilannya sama, dan `gl.finish()` eksplisit dihapus. `readPixels` tetap sinkron sehingga ini mengurangi sumber stall, bukan jaminan bebas lag di semua GPU.

Template dan stylesheet tetap dimuat asinkron, tetapi gambar dekorator seperti ikon item dan sprite dimuat langsung saat render agar tidak berubah menjadi kotak putih kosong. URL gambar yang gagal ditandai supaya tidak diminta berulang kali.

Jalankan `node tests/dungeon-ui-browser.cjs` dengan server berjalan untuk uji renderer desktop dan emulasi viewport mobile, termasuk teks, icon preload, dan urutan buka/tutup. Ini bukan pengujian performa pada HP fisik. Pengujian login penuh setelah pembaruan terakhir belum berhasil: browser headless sempat crash di lingkungan uji.
