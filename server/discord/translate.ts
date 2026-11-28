// ---------------------------------------------------------------------------
// Translation for Discord messages.
//
// Engines, in order:
//   1. DeepL            - optional, needs a free API key (500k chars/month).
//   2. Google gtx       - free, no key, quality of translate.google.com.
//   3. clients5         - free, different host/quota.
//   4. translate.google.com - same API as (2) on another host.
//
// Indonesian slang is normalised first (see slang.ts), because raw engines turn
// "hoki" into "hockey". Nothing here has an SLA: when every engine fails the
// message is left untranslated instead of spamming the channel with errors.
// ---------------------------------------------------------------------------

import { hasLlm, llmTranslate } from "./llm";
import { looksIndonesian, normalizeIndonesian } from "./slang";

type Endpoint = (text: string, target: string, source: string, raw: string) => Promise<Translation>;

const TRANSLATE_TIMEOUT_MS = 8000;
const MAX_INPUT_CHARS = 4500;
// Google answers with its "We're sorry... automated queries" page when requests
// arrive in bursts, so calls are spaced out and a blocked host rests.
const MIN_GAP_MS = 900;
const HOST_COOLDOWN_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/122.0.0.0 Safari/537.36";

export interface Translation {
  /** Translated text. */
  text: string;
  /** Detected source language, e.g. "id", "ja", "zh-CN". */
  lang: string;
}

const TARGET_FLAGS: Record<string, string> = {
  en: "\u{1F1FA}\u{1F1F8}",
  id: "\u{1F1EE}\u{1F1E9}",
  ja: "\u{1F1EF}\u{1F1F5}",
  ko: "\u{1F1F0}\u{1F1F7}",
  zh: "\u{1F1E8}\u{1F1F3}",
  "zh-cn": "\u{1F1E8}\u{1F1F3}",
  "zh-tw": "\u{1F1F9}\u{1F1FC}",
  ru: "\u{1F1F7}\u{1F1FA}",
  es: "\u{1F1EA}\u{1F1F8}",
  pt: "\u{1F1E7}\u{1F1F7}",
  fr: "\u{1F1EB}\u{1F1F7}",
  de: "\u{1F1E9}\u{1F1EA}",
  it: "\u{1F1EE}\u{1F1F9}",
  nl: "\u{1F1F3}\u{1F1F1}",
  pl: "\u{1F1F5}\u{1F1F1}",
  tr: "\u{1F1F9}\u{1F1F7}",
  ar: "\u{1F1F8}\u{1F1E6}",
  hi: "\u{1F1EE}\u{1F1F3}",
  th: "\u{1F1F9}\u{1F1ED}",
  vi: "\u{1F1FB}\u{1F1F3}",
  ms: "\u{1F1F2}\u{1F1FE}",
  tl: "\u{1F1F5}\u{1F1ED}",
  uk: "\u{1F1FA}\u{1F1E6}",
  sv: "\u{1F1F8}\u{1F1EA}",
  da: "\u{1F1E9}\u{1F1F0}",
  fi: "\u{1F1EB}\u{1F1EE}",
  no: "\u{1F1F3}\u{1F1F4}",
  cs: "\u{1F1E8}\u{1F1FF}",
  ro: "\u{1F1F7}\u{1F1F4}",
  hu: "\u{1F1ED}\u{1F1FA}",
  el: "\u{1F1EC}\u{1F1F7}",
  he: "\u{1F1EE}\u{1F1F1}",
  fa: "\u{1F1EE}\u{1F1F7}",
  bn: "\u{1F1E7}\u{1F1E9}",
  ta: "\u{1F1F1}\u{1F1F0}",
  my: "\u{1F1F2}\u{1F1F2}",
  km: "\u{1F1F0}\u{1F1ED}",
  lo: "\u{1F1F1}\u{1F1E6}",
};

export function targetFlag(target: string): string {
  const key = target.toLowerCase();
  return TARGET_FLAGS[key] || TARGET_FLAGS[key.split("-")[0]] || "\u{1F310}";
}

/** Discord body for a translation: `[\u{1F1FA}\u{1F1F8}] "translated text"`. */
export function formatTranslated(flag: string, text: string): string {
  return "[" + flag + "] " + JSON.stringify(text);
}

const hostBlockedUntil = new Map<string, number>();
let lastCallAt = 0;

async function waitForSlot(): Promise<void> {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
}

async function fetchJson(host: string, url: string): Promise<unknown> {
  const blocked = hostBlockedUntil.get(host) || 0;
  if (blocked > Date.now()) throw new Error("host cooling down");
  await waitForSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 429 || res.status === 503) hostBlockedUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
      throw new Error("HTTP " + res.status);
    }
    const head = body.trimStart();
    if (!head.startsWith("{") && !head.startsWith("[")) {
      // "We're sorry... automated queries" or a captcha page.
      hostBlockedUntil.set(host, Date.now() + HOST_COOLDOWN_MS);
      throw new Error("blocked");
    }
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function sentencesToText(data: { sentences?: Array<{ trans?: string }> }): string {
  return (data.sentences || []).map((s) => s.trans || "").join("");
}

// The model gets the untouched message: slang, typos and all. It also reports the
// detected language, which is what the en <-> id switch relies on.
async function viaLlm(_text: string, target: string, _source: string, raw: string): Promise<Translation> {
  const result = await llmTranslate(raw, target);
  if (!result) throw new Error("LLM tidak tersedia");
  return { text: result.text, lang: result.lang };
}

async function viaGoogleApis(text: string, target: string, source: string, _raw = ""): Promise<Translation> {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1" +
    "&sl=" + source + "&tl=" + encodeURIComponent(target) + "&q=" + encodeURIComponent(text);
  const data = (await fetchJson("googleapis", url)) as { sentences?: Array<{ trans?: string }>; src?: string };
  return { text: sentencesToText(data), lang: String(data.src || "") };
}

async function viaGoogleClients5(text: string, target: string, source: string, _raw = ""): Promise<Translation> {
  const url =
    "https://clients5.google.com/translate_a/t?client=dict-chrome-ex" +
    "&sl=" + source + "&tl=" + encodeURIComponent(target) + "&q=" + encodeURIComponent(text);
  const data = (await fetchJson("clients5", url)) as unknown;
  const rows = Array.isArray(data) ? (data as Array<Array<string> | string>) : [];
  const parts: string[] = [];
  let lang = "";
  for (const row of rows) {
    if (Array.isArray(row)) {
      parts.push(String(row[0] ?? ""));
      if (!lang) lang = String(row[1] ?? "");
    } else {
      parts.push(String(row ?? ""));
    }
  }
  return { text: parts.join(""), lang };
}

async function viaGoogleTranslateHost(text: string, target: string, source: string, _raw = ""): Promise<Translation> {
  const url =
    "https://translate.google.com/translate_a/single?client=gtx&dt=t&dj=1" +
    "&sl=" + source + "&tl=" + encodeURIComponent(target) + "&q=" + encodeURIComponent(text);
  const data = (await fetchJson("google", url)) as { sentences?: Array<{ trans?: string }>; src?: string };
  return { text: sentencesToText(data), lang: String(data.src || "") };
}

// ---------------------------------------------------------------------------
// DeepL (optional). With a key it becomes the primary engine because it phrases
// natural language (and slang) better than Google; without a key everything
// keeps running on the free Google endpoints.
// ---------------------------------------------------------------------------
let deeplKey = "";
let deeplHost = "api-free.deepl.com";

export function configureDeepL(key: string): void {
  deeplKey = String(key || "").trim();
  // Free keys end with ":fx"; paid keys must go through api.deepl.com.
  deeplHost = deeplKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
}

export function hasDeepL(): boolean {
  return Boolean(deeplKey);
}

const DEEPL_TARGETS: Record<string, string> = {
  en: "EN-US",
  id: "ID",
  ja: "JA",
  ko: "KO",
  zh: "ZH",
  ru: "RU",
  es: "ES",
  pt: "PT-BR",
  fr: "FR",
  de: "DE",
  it: "IT",
  nl: "NL",
  pl: "PL",
  tr: "TR",
  ar: "AR",
  uk: "UK",
  cs: "CS",
  da: "DA",
  fi: "FI",
  no: "NB",
  sv: "SV",
  ro: "RO",
  hu: "HU",
  el: "EL",
  bg: "BG",
  sk: "SK",
  sl: "SL",
  et: "ET",
  lv: "LV",
  lt: "LT",
};

function deeplTarget(target: string): string | null {
  const key = target.toLowerCase();
  return DEEPL_TARGETS[key] || DEEPL_TARGETS[key.split("-")[0]] || null;
}

async function viaDeepL(text: string, target: string, source: string, _raw = ""): Promise<Translation> {
  if (!deeplKey) throw new Error("DeepL not configured");
  const targetLang = deeplTarget(target);
  if (!targetLang) throw new Error("DeepL does not support " + target);
  const coolUntil = hostBlockedUntil.get("deepl") || 0;
  if (coolUntil > Date.now()) throw new Error("DeepL cooling down");
  await waitForSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  const payload: Record<string, unknown> = { text: [text], target_lang: targetLang };
  if (source === "id") payload.source_lang = "ID";
  try {
    const res = await fetch("https://" + deeplHost + "/v2/translate", {
      method: "POST",
      headers: { Authorization: "DeepL-Auth-Key " + deeplKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status === 456 || res.status === 429) {
      // Kuota habis / terlalu cepat: istirahatkan DeepL, lanjut ke Google.
      hostBlockedUntil.set("deepl", Date.now() + 60 * 60 * 1000);
      throw new Error("DeepL quota " + res.status);
    }
    if (!res.ok) throw new Error("DeepL HTTP " + res.status);
    const data = (await res.json()) as {
      translations?: Array<{ text?: string; detected_source_language?: string }>;
    };
    const first = (data.translations || [])[0];
    return {
      text: String(first?.text || ""),
      lang: String(first?.detected_source_language || "").toLowerCase(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Sisa karakter DeepL bulan ini, atau null kalau key belum diisi. */
export async function deepLUsage(): Promise<{ used: number; limit: number } | null> {
  if (!deeplKey) return null;
  try {
    const res = await fetch("https://" + deeplHost + "/v2/usage", {
      headers: { Authorization: "DeepL-Auth-Key " + deeplKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { character_count?: number; character_limit?: number };
    return { used: Number(data.character_count || 0), limit: Number(data.character_limit || 0) };
  } catch {
    return null;
  }
}

const cache = new Map<string, Translation>();
const CACHE_LIMIT = 400;

/**
 * Translate `text` into `target`, normalising Indonesian slang first. Returns
 * null when nothing could be translated.
 */
export async function translateText(text: string, target: string): Promise<Translation | null> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;
  const key = target + "\u0000" + input;
  const cached = cache.get(key);
  if (cached) return cached;

  // Slang is Indonesian, so force the source language once it is found; otherwise
  // let the engine detect it (that keeps Japanese, Spanish, ... working).
  const indonesian = looksIndonesian(input);
  const prepared = indonesian ? normalizeIndonesian(input).text : input;
  const source = indonesian ? "id" : "auto";

  const endpoints: Endpoint[] = [viaGoogleApis, viaGoogleClients5, viaGoogleTranslateHost];
  // Order: model first (best slang), then DeepL, then the free Google endpoints.
  if (hasDeepL()) endpoints.unshift(viaDeepL);
  if (hasLlm()) endpoints.unshift(viaLlm);

  for (const endpoint of endpoints) {
    try {
      const result = await endpoint(prepared, target, source, input);
      const out = { text: result.text.trim(), lang: result.lang.trim() };
      if (!out.text) continue;
      cache.set(key, out);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return out;
    } catch {
      // next endpoint
    }
  }
  return null;
}
