import assert from "node:assert";
import { formatTranslated, targetFlag } from "../server/discord/translate";
import { looksIndonesian, normalizeIndonesian } from "../server/discord/slang";

// Slang that Google alone mistranslates ("hoki" -> "hockey").
assert.equal(normalizeIndonesian("tapi kata koballee lu hoki").text, "tapi kata koballee kamu beruntung");
assert.equal(normalizeIndonesian("par gabisa login jir").text, "par tidak bisa login");
assert.equal(normalizeIndonesian("gmn cara matiin rotate di iphone").text, "bagaimana cara matikan rotate di iphone");
assert.ok(normalizeIndonesian("hp gw error mulu").hits >= 3);
// English must survive untouched.
assert.equal(normalizeIndonesian("how to turn off rotate on iphone").text, "how to turn off rotate on iphone");
assert.equal(normalizeIndonesian("Black Friday + role TAO").text, "Black Friday + role TAO");
// Detection.
assert.equal(looksIndonesian("tapi kata koballee lu hoki"), true);
assert.equal(looksIndonesian("gimana cara login"), true);
assert.equal(looksIndonesian("how to turn off rotate on iphone"), false);
assert.equal(looksIndonesian("Black Friday + role TAO"), false);
// Reply format matches the screenshot: [flag] "text"
const US = String.fromCodePoint(0x1f1fa, 0x1f1f8);
const ID = String.fromCodePoint(0x1f1ee, 0x1f1e9);
assert.equal(targetFlag("en"), US);
assert.equal(targetFlag("id"), ID);
assert.equal(formatTranslated(targetFlag("en"), "cannot login dude"), "[" + US + "] \"cannot login dude\"");
assert.equal(formatTranslated(targetFlag("id"), "selamat pagi"), "[" + ID + "] \"selamat pagi\"");
assert.equal(formatTranslated(US, 'say "hi"'), "[" + US + "] " + JSON.stringify('say "hi"'));

console.log("PASS: slang normalisation, language detection and [flag] \"text\" reply format");
import { configureLlm, hasLlm, llmLabel, parseLlmReply } from "../server/discord/llm";

// LLM replies arrive as JSON, sometimes wrapped in fences or chatter.
assert.deepEqual(parseLlmReply('{"lang":"id","text":"but kobalee said you were lucky"}'), {
  lang: "id",
  text: "but kobalee said you were lucky",
});
assert.deepEqual(parseLlmReply('```json\n{"lang":"en","text":"selamat pagi"}\n```'), { lang: "en", text: "selamat pagi" });
assert.deepEqual(parseLlmReply('Sure! {"lang":"id","text":"halo"} semoga membantu'), { lang: "id", text: "halo" });
assert.equal(parseLlmReply("no json here"), null);
assert.equal(parseLlmReply('{"lang":"id","text":""}'), null);

// Provider wiring: no key means no LLM; pollinations runs keyless.
configureLlm({ provider: "" });
assert.equal(hasLlm(), false);
configureLlm({ provider: "gemini" });
assert.equal(hasLlm(), false);
configureLlm({ provider: "gemini", key: "AIza-fake" });
assert.equal(hasLlm(), true);
configureLlm({ provider: "pollinations" });
assert.equal(hasLlm(), true);
configureLlm({ provider: "" });

// Provider chain: one key per provider, tried in order.
configureLlm({
  provider: "gemini",
  key: "AIza-fake",
  fallbacks: [{ provider: "groq", key: "gsk_fake" }, { provider: "cerebras", key: "csk-fake" }],
});
assert.equal(llmLabel(), "gemini/gemini-3.1-flash-lite -> groq/llama-3.3-70b-versatile -> cerebras/qwen-3-32b");

// Provider is guessed from the key prefix when it is omitted.
configureLlm({ key: "csk-abc" });
assert.equal(llmLabel(), "cerebras/qwen-3-32b");
configureLlm({ key: "gsk_abc" });
assert.equal(llmLabel(), "groq/llama-3.3-70b-versatile");
configureLlm({ key: "AQ.abc" });
assert.equal(llmLabel(), "gemini/gemini-3.1-flash-lite");

// A profile without a key cannot run (pollinations is the keyless exception).
configureLlm({ provider: "groq" });
assert.equal(hasLlm(), false);
configureLlm({ provider: "gemini", key: "AIza-fake", fallbacks: [{ provider: "groq" }] });
assert.equal(llmLabel(), "gemini/gemini-3.1-flash-lite");
configureLlm({ provider: "" });

console.log("PASS: LLM reply parsing and provider gating");