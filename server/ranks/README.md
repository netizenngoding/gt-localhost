# MagnoliaPS rank system (AstroVerse-style, fully dynamic)

Mirip `RoleManager` + `roles_config.json` di AstroVerse, tapi semua bisa diubah
langsung dari dalam game dan tersimpan otomatis ke `data_store/ranks.json`.

## Konsep

- Rank = `id` + `label` + `level` + `prefix` + `chatColor` + `permissions`.
- Jumlah rank **tidak dibatasi** (maks 200), bisa dibuat/dihapus kapan saja.
- `prefix` dipakai sebelum nama (chat, bubble, wrench, world list).
  Contoh bawaan: moderator `^`, developer `5`.
- `chatColor` mewarnai teks chat rank tersebut.
- Permission: `moderate`, `grantItems`, `debug`, `setRanks`.
- **Tidak ada rank guest.** Guest dan GrowID diperlakukan sama; rank tersimpan
  permanen di akun dan tidak di-reset saat logout.

## Command

| Command | Fungsi |
|---|---|
| `/ranks` | Daftar semua rank + level, prefix, permission, jumlah online |
| `/rank` | Info rank sendiri |
| `/setrank <player> <rankId>` | Beri/ganti rank (player online atau offline) |
| `/setrole <rankId>` | Ganti rank sendiri |
| `/createrank <id> <level> <prefix> [label]` | Buat rank baru |
| `/delrank <id>` | Hapus rank (pemiliknya kembali ke `player`) |
| `/rankedit <id> label\|level\|prefix\|color <value>` | Ubah properti rank |
| `/rankperm <id> add\|remove <permission>` | Atur permission rank |
| `/rankreload` | Baca ulang `data_store/ranks.json` |
| `/grole <player>` | Dialog AstroVerse "Give / Remove - Role" |

Semua command manajemen butuh permission `setRanks` (Administrator/Developer/Owner).
Pemegang `debug` boleh memberikan rank apa pun; rank lain hanya sampai levelnya sendiri.

## Contoh cepat

```
/createrank builder 2 `3 Builder
/rankedit builder level 6
/rankperm builder add moderate
/setrank Bob builder
/ranks
```

## File

`data_store/ranks.json` (schemaVersion 2):

```json
{
  "schemaVersion": 2,
  "ranks": {
    "moderator": { "label": "Moderator", "level": 3, "prefix": "`^", "chatColor": "`^", "permissions": ["moderate"] }
  },
  "assignments": { "1019": "developer" }
}
```

`assignments` adalah override per userId. Rank juga tersimpan di `players.json`
(field `rank`), jadi memberi rank lewat command langsung permanen.

Environment override tetap didukung: `MODERATOR_USER_IDS`, `DEVELOPER_USER_IDS`,
`ADMIN_USER_IDS` (alias developer), `OWNER_USER_IDS`.

## Bagaimana prefix & warna dipakai

- Nama: `prefix + nama` (`displayName`), contoh `^Bob`, `5Alice`.
- Chat: nama tetap berprefix, teks chat memakai `chatColor`.
- Rank dengan `level 0` dan tanpa permission tetap memakai warna world owner
  (hijau) / admin lock (`^`) seperti `Role::Prefix2` AstroVerse.
