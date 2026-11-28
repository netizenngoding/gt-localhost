// ---------------------------------------------------------------------------
// LLM translation (optional, but the only thing that really understands slang).
//
// A dictionary-based translator always flattens "hoki", "jir", "kobalee lu hoki".
// A language model reads the whole sentence, so the translation keeps the joke,
// the tone and the usernames. Nobody gives unlimited requests, but the free tiers
// below are far beyond what a Discord chat needs; several of them can be chained,
// so when one runs out of quota the next one answers (and Google is the last net).
//
//   gemini       https://aistudio.google.com/apikey      ~1500 req/hari
//   groq         https://console.groq.com/keys           ~1000 req/hari, cepat
//   cerebras     https://cloud.cerebras.ai               300 RPM, tanpa cap harian
//   mistral      https://console.mistral.ai              ~1 req/detik
//   openrouter   https://openrouter.ai/keys              model ":free", ~50/hari
//   pollinations https://text.pollinations.ai/openai     tanpa key, 1 req/45 detik
// ---------------------------------------------------------------------------

export interface LlmProfile {
  /** gemini | groq | cerebras | mistral | openrouter | pollinations | openai */
  provider: string;
  key: string;
  /** Model name; each provider has a default. */
  model: string;
  /** Base URL override for OpenAI-compatible providers. */
  baseUrl: string;
}

export interface LlmConfig extends Partial<LlmProfile> {
  /** Tried in order when the main profile fails or hits its quota. */
  fallbacks?: Array<Partial<LlmProfile>>;
}

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.1-flash-lite",
  groq: "llama-3.3-70b-versatile",
  cerebras: "qwen-3-32b",
  mistral: "mistral-small-latest",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  pollinations: "openai-fast",
  openai: "gpt-4o-mini",
};

const BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

function normalizeProfile(config: Partial<LlmProfile> | undefined, keyHint = ""): LlmProfile | null {
  if (!config) return null;
  let provider = String(config.provider || "").trim().toLowerCase();
  const key = String(config.key || keyHint || "").trim();
  if (!provider && key) {
    // Key prefixes are recognisable enough to guess the provider.
    if (key.startsWith("gsk_")) provider = "groq";
    else if (key.startsWith("csk-")) provider = "cerebras";
    else if (key.startsWith("sk-or-")) provider = "openrouter";
    else if (key.startsWith("AIza") || key.startsWith("AQ.")) provider = "gemini";
    else provider = "openai";
  }
  if (!provider) return null;
  if (provider !== "pollinations" && !key) return null;
  return {
    provider,
    key,
    model: String(config.model || "").trim() || DEFAULT_MODELS[provider] || "",
    baseUrl: String(config.baseUrl || "").trim() || BASE_URLS[provider] || "",
  };
}

let profiles: LlmProfile[] = [];
// Pollinations tanpa key: 1 balasan / 45 detik / IP. Setelah kena 402 jangan
// dicoba lagi sampai jeda itu lewat, biar pesan lain langsung pakai yang lain.
let pollinationsBlockedUntil = 0;

export function configureLlm(config: LlmConfig): void {
  const chain: LlmProfile[] = [];
  const primary = normalizeProfile(config);
  if (primary) chain.push(primary);
  for (const fallback of config.fallbacks || []) {
    const profile = normalizeProfile(fallback);
    if (profile) chain.push(profile);
  }
  profiles = chain;
}

export function hasLlm(): boolean {
  return profiles.length > 0;
}

export function llmLabel(): string {
  return profiles.map((p) => p.provider + "/" + p.model).join(" -> ");
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  ms: "Malay",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
};

const SLANG_HINTS = [
  "hoki=lucky", "apes=unlucky", "gabisa=cannot", "gak/ga/nggak=tidak",
  "lu/lo=you", "gw/gue=I", "gmn=how", "knp=why", "mulu=always", "bgt=banget=very",
  "matiin=turn off", "jir/anjir=exclamation (drop it)", "wkwk=lol (drop it)",
  "drop=item drop", "world=Growtopia world", "pet=pet", "bux=currency",
].join(" ");

function buildPrompt(text: string, targetName: string): string {
  return [
    "You translate chat messages from a Growtopia game Discord server.",
    "Understand Indonesian slang correctly; never translate usernames, world names or item names.",
    "Slang hints: " + SLANG_HINTS + "",
    "Translate the message into " + targetName + ".",
    "Reply with JSON only, no markdown: {\"lang\":\"<detected ISO 639-1 code>\",\"text\":\"<translation>\"}",
    "",
    "Message: " + text,
  ].join("\n");
}

function langName(code: string): string {
  const key = code.toLowerCase();
  return LANG_NAMES[key] || LANG_NAMES[key.split("-")[0]] || "English";
}

/** Pull {"lang":...,"text":...} out of a model reply, fences and chatter included. */
export function parseLlmReply(raw: string): { lang: string; text: string } | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { lang?: unknown; text?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) return null;
    return { lang: typeof parsed.lang === "string" ? parsed.lang.toLowerCase().trim() : "", text };
  } catch {
    return null;
  }
}

// Model gratis kadang jawab 40 detik kalau lagi sibuk. Chat tidak boleh nunggu
// selama itu: 9 detik per percobaan, lalu profil berikutnya yang menjawab.
const TIMEOUT_MS = 9_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

// Google retires and reshuffles model names regularly (2.0-flash is gone, some
// flash aliases answer 503 under load), so a few known-good ones are tried.
const GEMINI_FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];

async function callGemini(profile: LlmProfile, prompt: string): Promise<string> {
  const models = [profile.model, ...GEMINI_FALLBACK_MODELS].filter((m, i, all) => m && all.indexOf(m) === i);
  let lastError: unknown = new Error("gemini: tidak ada model yang menjawab");
  const deadline = Date.now() + 15_000;
  for (const model of models) {
    if (Date.now() > deadline) break;
    try {
      const data = (await postJson(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(profile.key),
        {},
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
        }
      )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || "").join("");
      if (text.trim()) return text;
      lastError = new Error("gemini: balasan kosong");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function callOpenAiCompatible(profile: LlmProfile, prompt: string): Promise<string> {
  const base = profile.baseUrl || BASE_URLS[profile.provider] || "";
  const url = base ? base.replace(/\/+$/, "") + "/chat/completions" : "https://text.pollinations.ai/openai";
  const headers: Record<string, string> = {};
  if (profile.key) headers.Authorization = "Bearer " + profile.key;
  const data = (await postJson(url, headers, {
    model: profile.model,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      { role: "system", content: "You are a translation engine. Reply with JSON only." },
      { role: "user", content: prompt },
    ],
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "";
}

async function callProfile(profile: LlmProfile, prompt: string): Promise<string> {
  if (profile.provider === "gemini") return callGemini(profile, prompt);
  if (profile.provider === "pollinations") {
    if (pollinationsBlockedUntil > Date.now()) throw new Error("pollinations cooling down");
    try {
      return await callOpenAiCompatible(profile, prompt);
    } catch (err) {
      if (/402/.test(err instanceof Error ? err.message : "")) pollinationsBlockedUntil = Date.now() + 45_000;
      throw err;
    }
  }
  return callOpenAiCompatible(profile, prompt);
}

/**
 * Translate with the configured chain. Returns null when every provider is
 * unconfigured, rate limited, or answers something unparsable.
 */
export async function llmTranslate(
  text: string,
  target: string
): Promise<{ lang: string; text: string } | null> {
  if (!profiles.length) return null;
  const prompt = buildPrompt(text, langName(target));
  for (const profile of profiles) {
    try {
      const raw = await callProfile(profile, prompt);
      const parsed = parseLlmReply(raw);
      if (parsed) return parsed;
    } catch {
      // next profile
    }
  }
  return null;
}
