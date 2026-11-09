import crypto from "node:crypto";
import { normalizeGtSkinColor, parseKvText } from "../proton/packet";

export { normalizeGtSkinColor, parseKvText };
export const DEFAULT_SKIN_COLOR = 0x8295c3ff;

export const SKIN_TONE_SWATCHES: Array<{ id: string; label: string; hex: string; color: number }> = [
  { id: "classic", label: "Classic Tan", hex: "C39582", color: 0x8295c3ff },
  { id: "light", label: "Porcelain", hex: "FCE5CD", color: 0xcde5fcff },
  { id: "peach", label: "Warm Peach", hex: "F6B26B", color: 0x6bb2f6ff },
  { id: "olive", label: "Golden Olive", hex: "D4A373", color: 0x73a3d4ff },
  { id: "bronze", label: "Deep Bronze", hex: "8D5524", color: 0x24558dff },
  { id: "espresso", label: "Espresso", hex: "4A2C11", color: 0x112c4aff },
  { id: "zombie", label: "Zombie Green", hex: "6AA84F", color: 0x4fa86aff },
  { id: "frost", label: "Ice Blue", hex: "6FA8DC", color: 0xdca86fff },
  { id: "demon", label: "Crimson Red", hex: "E06666", color: 0x6666e0ff },
  { id: "shadow", label: "Shadow Void", hex: "222222", color: 0x222222ff },
];

export function rgbHexToGtSkinColor(hex6: string): number {
  const r = parseInt(hex6.slice(0, 2), 16) & 0xff;
  const g = parseInt(hex6.slice(2, 4), 16) & 0xff;
  const b = parseInt(hex6.slice(4, 6), 16) & 0xff;
  return (((b << 24) | (g << 16) | (r << 8) | 0xff) >>> 0);
}

export function gtSkinColorToRgbHex(color: number): string {
  const u = color >>> 0;
  const b = (u >>> 24) & 0xff;
  const g = (u >>> 16) & 0xff;
  const r = (u >>> 8) & 0xff;
  return [r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!password || password.length > 128 || !stored) return false;
  let candidate: Buffer, expected: Buffer;
  if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored)) {
    const [, salt, digest] = stored.split("$");
    candidate = crypto.scryptSync(password, salt, 32);
    expected = Buffer.from(digest, "hex");
  } else if (/^[a-f0-9]{64}$/.test(stored)) {
    // Upgrade old SHA256 accounts only after successful verification.
    candidate = crypto.createHash("sha256").update("gt_v150_salt:" + password).digest();
    expected = Buffer.from(stored, "hex");
  } else return false; // Never accept plaintext or a missing password hash.
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function cleanName(raw: string): string {
  return String(raw || "").replace(/`.|``/g, "").replace(/\|/g, "");
}

export const stripGtColors = cleanName;

export function sanitizeMsg(msg: string): string {
  return String(msg || "").replace(/\|/g, "").replace(/[\r\n]+/g, " ");
}

export function sanitizeChatText(msg: string, maxLen = 120): string {
  return sanitizeMsg(msg).slice(0, maxLen);
}

export function sanitizeAccountName(raw: string, maxLen = 18): string {
  return String(raw || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, maxLen);
}

export function isAlphaNumUnderscore(str: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(str);
}

export function rawTextIsCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}
