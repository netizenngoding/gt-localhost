# Auto-translate Discord (gratis)

Bot membalas **dua arah**: pesan Indonesia dibalas terjemahan Inggris, pesan Inggris
dibalas terjemahan Indonesia. Bentuknya reply ke pesan aslinya:

```
"update apa ini"    -> [🇺🇸] "what update is this?"
"tapi kata koballee lu hoki" -> [🇺🇸] "but koballee said you were lucky"
"good morning everyone" -> [🇮🇩] "selamat pagi semuanya"
```

Bahasa lain (Jepang, Spanyol, dst) diterjemahkan ke `target` (default Inggris).

## LLM (paling ngerti slang, gratis, perlu key)

Kamus + mesin terjemahan biasa selalu kaku. Yang benar-benar paham "hoki", "jir",
"kobalee lu hoki" cuma language model. Tidak ada yang benar-benar *unlimited*, tapi
limit gratisnya jauh di atas kebutuhan bot Discord (ratusan pesan/hari):

| Provider | Daftar | Limit gratis | Model default |
| --- | --- | --- | --- |
| `cerebras` | <https://cloud.cerebras.ai> | 300 RPM, 150k token/menit, tanpa cap harian | `qwen-3-32b` |
| `gemini` | <https://aistudio.google.com/apikey> | ~1500 request/hari | `gemini-3.1-flash-lite` |
| `groq` | <https://console.groq.com/keys> | ~1000 request/hari, paling cepat | `llama-3.3-70b-versatile` |
| `mistral` | <https://console.mistral.ai> | ~1 request/detik | `mistral-small-latest` |
| `openrouter` | <https://openrouter.ai/keys> | model `:free`, ~50 request/hari | `llama-3.3-70b:free` |
| `pollinations` | tanpa key | 1 pesan / 45 detik | `openai-fast` |
| `openai` | provider OpenAI-compatible apa pun | sesuai akun | `gpt-4o-mini` |

Provider ditebak dari awalan key (`gsk_` groq, `csk-` cerebras, `sk-or-` openrouter,
`AIza`/`AQ.` gemini), jadi biasanya cukup isi `key` saja.

Beberapa key bisa dirangkai. Kalau profil pertama kena limit/error, profil berikutnya
yang menjawab:

```json
{
  "translate": {
    "target": "en",
    "secondary": "id",
    "llm": {
      "provider": "cerebras",
      "key": "csk-...",
      "fallbacks": [
        { "provider": "groq", "key": "gsk_..." },
        { "provider": "gemini", "key": "AIza..." }
      ]
    }
  }
}
```

Atau lewat env: `GEMINI_API_KEY` / `GROQ_API_KEY` / `LLM_API_KEY`, plus `LLM_PROVIDER`,
`LLM_MODEL`, `LLM_BASE_URL`.

Urutan mesin: **LLM chain → DeepL → Google**. Kalau semuanya gagal (limit, key salah,
timeout), pesan tetap diterjemahkan Google tanpa pesan error di channel. Log startup:

```
[Discord] engine: LLM (cerebras/qwen-3-32b -> groq/llama-3.3-70b-versatile) -> DeepL/Google
```
## DeepL (opsional, tapi paling enak)

Kalau mau kualitas paling natural, pakai **DeepL**: daftar gratis di
<https://www.deepl.com/pro-api> (paket **DeepL API Free**, 500.000 karakter/bulan,
tanpa biaya). Setelah dapat key (bentuknya berakhiran `:fx`), isi salah satu:

- `config/discord.json` → `"translate": { "deeplKey": "xxxx:fx" }`, atau
- environment variable `DEEPL_API_KEY`.

Selama key ada, DeepL jadi mesin utama; kalau DeepL kena limit/quota habis (HTTP
456/429) atau error, otomatis pindah ke Google tanpa pesan error di channel. Tanpa
key, semuanya tetap jalan pakai Google.

Log startup menunjukkan mesin yang aktif:

```
[Discord] engine: DeepL, 499871/500000 karakter tersisa bulan ini
[Discord] engine: Google (isi translate.deeplKey untuk pakai DeepL)
```

## API yang dipakai

1. **DeepL API Free** (kalau key diisi) — 500k karakter/bulan, kualitas terbaik.
2. **Google Translate** publik (yang dipakai translate.google.com), **tanpa API key,
   tanpa billing, gratis**:

   - `translate.googleapis.com/translate_a/single` (client=gtx, dj=1) — kualitas
     penuh, auto-detect bahasa, sampai ~4500 karakter per request.
   - `clients5.google.com/translate_a/t` (client=dict-chrome-ex) — endpoint ringan,
     kuota terpisah, dipakai kalau yang pertama kena 429/5xx.
   - `translate.google.com/translate_a/single` — host sama, jaga-jaga kalau host
     utama diblokir.

Kalau ketiganya gagal, pesan dibiarkan tanpa terjemahan (tidak ada error ke user).

## Slang Indonesia

Google mentah menerjemahkan "hoki" jadi "hockey" dan mendeteksi bahasa aneh untuk teks
gaul. Karena itu pesan dinormalisasi dulu ke Bahasa Indonesia baku lewat kamus slang
(`server/discord/slang.ts`, ~95 entri: lu/gw, gabisa, gmn, mulu, bgt, matiin, hoki,
apes, jir, wkwk, ...), baru dikirim ke mesin terjemahan dengan `sl=id`.

```
"tapi kata koballee lu hoki"     -> [🇺🇸] "but koballee said you were lucky"
"par gabisa login jir, error mulu" -> [🇺🇸] "par can't log in, the error continues"
"gmn cara matiin rotate di iphone" -> [🇺🇸] "how to turn off rotate on iphone"
```

## Syarat di Discord Developer Portal

Bot perlu membaca isi pesan, jadi privileged intent **MESSAGE_CONTENT** harus ON:

1. <https://discord.com/developers/applications> → pilih aplikasi bot.
2. Tab **Bot** → *Privileged Gateway Intents* → aktifkan **Message Content Intent**.
3. Simpan, lalu restart server.

Kalau intent ini belum aktif, Discord menutup socket dengan kode `4014`. Bot otomatis
mencoba ulang tanpa intent tersebut supaya status presence tetap jalan, dan menulis
peringatan di log:

```
[Discord] MESSAGE_CONTENT intent ditolak (4014). Aktifkan privileged intent ...
```

## Konfigurasi

Default sudah aktif untuk Bahasa Inggris. Untuk mengubah, tambahkan di
`config/discord.json`:

```json
{
  "translate": {
    "enabled": true,
    "target": "en",
    "secondary": "id",
    "channels": [],
    "skipBots": true
  }
}
```

| Field | Arti |
| --- | --- |
| `enabled` | Matikan dengan `false` kalau tidak mau auto-translate. |
| `target` | Bahasa tujuan utama, misal `en`. Pesan non-`target` diterjemahkan ke sini. |
| `secondary` | Bahasa balasan untuk pesan yang **sudah** `target`, default `id`. |
| `channels` | Daftar channel id. Kosong = semua channel yang bisa dibaca bot. |
| `categories` | Daftar **category** id (bukan channel). Kalau diisi, hanya channel di dalam category itu yang diterjemahkan; kosong = semua channel. |
| `debug` | `true` = catat setiap pesan yang dilewati beserta alasannya (`[Discord] translate lewat (...)`). |
| `skipBots` | `true` = abaikan pesan bot lain. Pesan lewat webhook (relay chat in-game) tetap diterjemahkan. |

Bisa juga lewat environment variable: `TRANSLATE_ENABLED`, `TRANSLATE_TARGET`,
`TRANSLATE_CHANNELS`, `TRANSLATE_CATEGORIES` (dipisah koma), `TRANSLATE_BOT_MESSAGES`.

Contoh membatasi translate hanya ke satu category:

```json
{
  "translate": {
    "target": "en",
    "secondary": "id",
    "categories": ["1568981054138613892"]
  }
}
```

Log startup ikut menyebut batasnya: `auto-translate aktif -> en di category 1568981054138613892`.

## Perilaku

- Pesan yang sudah berbahasa target dibalas dengan `secondary` (Inggris → Indonesia).
- Pesan yang isinya cuma emoji/angka/link tidak disentuh.
- Pesan yang diawali `!`, `/`, `.`, `$` dianggap command dan dilewati.
- Maksimal 2 terjemahan berjalan bersamaan, ada cache 400 teks terakhir, dan
  dedupe per message id supaya pesan tidak dobel saat gateway reconnect.
- Teks terjemahan dipotong di 1500 karakter, semua mention di-mute (`allowed_mentions: parse: []`).

## Batasan

- Endpoint gratis tanpa SLA: bisa kena rate limit kalau channel sangat ramai.
- Deteksi bahasa & terjemahan bisa meleset untuk singkatan gaul atau campuran bahasa
  (misal "matiin rotation di hp" tetap kebaca Indonesia dan hasilnya benar).
- Terjemahan tidak diteruskan ke chat in-game, hanya balasan di Discord.