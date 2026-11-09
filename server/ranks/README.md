# MagnoliaPS ranks

Tiga role inti: `player`, `moderator`, `developer`. Prefix tampilan bukan sumber izin.

| Rank | Prefix nama | mstate/smstate | Izin lokal |
|---|---|---|---|
| player | putih (`w), hijau jika pemilik world, warna akses jika admin lock | 0/0 | bermain, membeli dari Store, browse item |
| moderator | `#@Nama | 1/0 | moderasi pemain dengan rank lebih rendah |
| developer | `6@Nama | 1/1 | moderasi + grant item + tools/debug |

Format Markdown di tabel menampilkan kode warna sebagai teks. Tidak ada spasi antara `@` dan nama.

## Assign rank

1. Hentikan server dan backup `data_store`.
2. Baca **userId akun GrowID milik operator** dari `data_store/players.json` secara lokal. Jangan membagikan file itu.
3. Buat `data_store/ranks.json`:

```json
{
  "schemaVersion": 1,
  "assignments": {
    "1001": "developer",
    "1002": "moderator"
  }
}
```

**1001/1002 hanya contoh**, bukan akun yang otomatis mendapat izin. Ganti dengan ID yang benar. Jika belum ingin memberi rank, gunakan `"assignments": {}`. Restart setelah perubahan. Akun guest selalu player.

Alternatif environment: `MODERATOR_USER_IDS`, `DEVELOPER_USER_IDS`, daftar ID dipisah koma. `ADMIN_USER_IDS` dari v4 tetap didukung sebagai alias developer. Urutan prioritas: JSON < MODERATOR_USER_IDS < ADMIN_USER_IDS < DEVELOPER_USER_IDS. Untuk mencabut rank, hapus ID dari semua sumber yang berlaku lalu restart.

Nilai `rank`/`moderator` yang tersimpan di players.json **diabaikan sebagai otoritas**. Jangan memberi akses tulis konfigurasi ini kepada pengguna game. Tidak ada command publik untuk mengubah rank; `/rank` hanya membaca role sendiri, `/mods` menampilkan staff online.

## Batas kesetaraan

Warna moderator ungu + `@` dikonfirmasi oleh Help Center resmi. Tiga enum role dan pemetaan flag dicocokkan dengan C++ Gurotopia; warna developer mengikuti konvensi historis dan telah diuji pada renderer client ini. Matriks izin di atas adalah kebijakan lokal yang aman, bukan klaim kebocoran/rekonstruksi backend resmi atau seluruh hierarchy private CreativePS. Detail: `docs/MAGNOLIA_V5.md`.
