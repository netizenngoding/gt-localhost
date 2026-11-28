// Indonesian chat/game slang that Google Translate gets wrong on its own.
//
// The message is normalised to standard Indonesian before it is translated, so
// "tapi kata koballee lu hoki" becomes "tapi kata koballee kamu beruntung" and
// translates to "but koballee said you were lucky" instead of "... is hockey".
// Empty replacements are filler words that only add noise to the translation.
const SLANG: Record<string, string> = {
  "lu": "kamu",
  "lo": "kamu",
  "loe": "kamu",
  "gw": "aku",
  "gue": "aku",
  "gua": "aku",
  "ente": "kamu",
  "ga": "tidak",
  "gak": "tidak",
  "gk": "tidak",
  "nggak": "tidak",
  "engga": "tidak",
  "enggak": "tidak",
  "tdk": "tidak",
  "gabisa": "tidak bisa",
  "gbs": "tidak bisa",
  "gatau": "tidak tahu",
  "gamau": "tidak ingin",
  "gaboleh": "tidak boleh",
  "gmn": "bagaimana",
  "gimana": "bagaimana",
  "gmna": "bagaimana",
  "knp": "kenapa",
  "napa": "kenapa",
  "udah": "sudah",
  "dah": "sudah",
  "udeh": "sudah",
  "blm": "belum",
  "blom": "belum",
  "bgt": "sekali",
  "bngt": "sekali",
  "banget": "sekali",
  "mulu": "terus",
  "trus": "terus",
  "msh": "masih",
  "masi": "masih",
  "kalo": "kalau",
  "klo": "kalau",
  "kyk": "seperti",
  "kaya": "seperti",
  "gitu": "begitu",
  "gini": "begini",
  "matiin": "matikan",
  "hidupin": "hidupkan",
  "nyalain": "menyalakan",
  "benerin": "perbaiki",
  "buatin": "buatkan",
  "nyoba": "mencoba",
  "liat": "lihat",
  "dengerin": "dengarkan",
  "dapet": "dapat",
  "dpt": "dapat",
  "nanya": "bertanya",
  "pengen": "ingin",
  "pingin": "ingin",
  "abisin": "habiskan",
  "dapetin": "dapatkan",
  "bikin": "buat",
  "hoki": "beruntung",
  "apes": "sial",
  "mantap": "bagus",
  "mantul": "bagus",
  "keren": "bagus",
  "gede": "besar",
  "cepet": "cepat",
  "bener": "benar",
  "bner": "benar",
  "gampang": "mudah",
  "susah": "sulit",
  "hp": "ponsel",
  "wa": "whatsapp",
  "ig": "instagram",
  "yt": "youtube",
  "fb": "facebook",
  "dc": "discord",
  "btw": "ngomong-ngomong",
  "dll": "dan lain-lain",
  "gpp": "tidak apa-apa",
  "mksh": "terima kasih",
  "makasih": "terima kasih",
  "sori": "maaf",
  "wkwk": "",
  "wkwkwk": "",
  "haha": "",
  "hehe": "",
  "anjir": "",
  "anjay": "",
  "jir": "",
  "bjir": "",
  "cuy": "",
  "sih": "",
  "deh": "",
  "dong": "",
  "kok": "kok",
  "nih": "ini",
  "tuh": "itu",
  "yak": "ya",
};

// Words that strongly indicate Indonesian even without slang.
const INDONESIAN_MARKERS = new Set([
  "yang", "dengan", "tidak", "bisa", "saja", "sudah", "belum", "kamu", "aku", "kita",
  "mau", "kenapa", "bagaimana", "kalau", "dari", "untuk", "ini", "itu", "ada", "banget",
]);

export interface NormalizedText {
  /** Text with slang replaced by standard Indonesian. */
  text: string;
  /** How many slang tokens were replaced. */
  hits: number;
}

/**
 * Replace Indonesian slang with standard Indonesian. Words are matched whole
 * and case-insensitively; URLs, mentions and everything else stay untouched.
 */
export function normalizeIndonesian(text: string): NormalizedText {
  let hits = 0;
  const replaced = text.replace(/[\p{L}\p{N}_]+/gu, (word) => {
    const key = word.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SLANG, key)) return word;
    hits++;
    const value = SLANG[key];
    if (!value) return "";
    return /^[A-Z]/.test(word) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  });
  const cleaned = replaced
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .trim();
  return { text: cleaned, hits };
}

/** True when the text looks like Indonesian chat, slang included. */
export function looksIndonesian(text: string): boolean {
  const { hits } = normalizeIndonesian(text);
  if (hits > 0) return true;
  let markers = 0;
  for (const word of text.toLowerCase().match(/[\p{L}]+/gu) || []) {
    if (INDONESIAN_MARKERS.has(word)) markers++;
    if (markers >= 2) return true;
  }
  return false;
}
