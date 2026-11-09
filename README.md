# Growtopia Browser MMO (1:1 Official Sprites & Server-Authoritative Anti-Exploit)

Game **Browser Growtopia** full-stack berbasis **TypeScript + React + Express + WebSocket (`ws`) + Zod** dengan sprite sheet resmi Growtopia (`Base Set GT`, `player_*`, `tiles_page*`, `seed.png`, `particles.png`, `gui_itembox.png`, dan audio `.wav`), bitmask autotiler `ST2/ST5/ST14/ST4/ST7` 1:1, serta arsitektur **100% Server-Authoritative Multiplayer** yang kebal terhadap exploit sisi klien.

## Fitur Utama
- **1:1 Character & Wearable Compositing (`64` Pakaian Resmi di 8 Slot):** Menggunakan layer anatomi terpisah (`Base Set GT`) + dual-row `player_feet.png` + animasi kepak sayap `wearables_anim_map` + *telescopic conical punch arm* + `gt_punch_fist.png`.
- **196 Item Resmi & 72 Resep Splicing Growtopia (`items.dat` v2.78 & `recapies.txt`):** Termasuk blok bangunan (Log Cabin Roof, Wood Background, Sign, Doors, Locks, Weather Machines), pohon bertumbuh real-time, dan Gem Store.
- **Real-Time WebSocket Multiplayer:** Banyak pemain dapat masuk ke World yang sama (`START`, `PARKOUR`, `BUYCLOTHES`, `FARM`, atau nama World kustom apa pun), chat dengan kode warna Growtopia (`` `2 ``, `` `4 ``, `` `9 ``), saling melihat pakaian/pukulan/emote, berdagang via `DROP`, dan mengunci World dengan `World Lock`.
- **Anti-Exploit Server-Authoritative:**
  - Autentikasi sesi bertanda tangan **HMAC-SHA256**.
  - Validasi paket ketat via **Zod** + batas ukuran frame WebSocket `2 KB` + `TokenBucket` rate limiter.
  - **Anti-Speedhack & Anti-Noclip:** Server memvalidasi kecepatan & tabrakan AABB `20x27` setiap gerakan dan otomatis me-*rubberband* koordinat ilegal.
  - **Anti-Reach & Anti-Autoclicker:** Pukulan/pemasangan blok di luar jangkauan `3.35` tile atau lebih cepat dari cooldown ditolak server.
  - **Zero Item/Gem Duplication:** Inventaris, Gems, pembelian Store, Recycle, dan klaim item jatuh (`pickup_box`) dikelola atomik di server.

## Menjalankan untuk Produksi / Publish
```bash
npm install
npm run build
PORT=8080 node server_bundle/server.cjs
```
