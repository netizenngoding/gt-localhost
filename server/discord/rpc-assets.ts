import crypto from "node:crypto";
import { discordConfig } from "./service";

/**
 * Rich Presence only accepts uploaded application asset keys for large_image.
 * External URLs (including Discord CDN attachments) render as a question mark.
 * Upload each player's head once and cache the deterministic asset key.
 */
const DISCORD_API = "https://discord.com/api/v10";
const MAX_ASSETS = 120;
const assetKeyByHash = new Map<string, string>();
const pendingByHash = new Map<string, Promise<string | null>>();
let knownKeys: Set<string> | null = null;

function headHash(png: Buffer): string {
  return crypto.createHash("sha256").update(png).digest("hex");
}

function assetKeyForHash(hash: string): string {
  return `magnolia_head_${hash.slice(0, 16)}`;
}

export function getCachedRpcHeadAsset(png: Buffer | undefined): string | null {
  if (!png) return null;
  return assetKeyByHash.get(headHash(png)) || null;
}

async function listAssetKeys(): Promise<Set<string>> {
  if (knownKeys) return knownKeys;
  const cfg = discordConfig();
  knownKeys = new Set();
  if (!cfg.botToken || !cfg.clientId) return knownKeys;
  try {
    const res = await fetch(`${DISCORD_API}/applications/${cfg.clientId}/assets`, {
      headers: { Authorization: `Bot ${cfg.botToken}` },
    });
    if (res.ok) {
      const list = (await res.json()) as Array<{ key?: string }>;
      for (const asset of list) {
        if (asset?.key) knownKeys.add(asset.key);
      }
    }
  } catch {
    // The upload path will retry naturally on the next presence refresh.
  }
  return knownKeys;
}

async function uploadHeadAsset(png: Buffer, hash: string, key: string): Promise<string | null> {
  const cfg = discordConfig();
  if (!cfg.botToken || !cfg.clientId) return null;
  const keys = await listAssetKeys();
  if (keys.has(key)) {
    assetKeyByHash.set(hash, key);
    return key;
  }
  if (keys.size >= MAX_ASSETS) {
    console.warn(`[Discord RPC] asset limit reached (${keys.size}); using app logo`);
    return null;
  }

  try {
    const presign = await fetch(`${DISCORD_API}/applications/${cfg.clientId}/assets/upload`, {
      method: "POST",
      headers: { Authorization: `Bot ${cfg.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: `head-${hash.slice(0, 12)}.png`, file_size: png.length }),
    });
    if (!presign.ok) {
      console.warn(`[Discord RPC] asset presign HTTP ${presign.status}`);
      return null;
    }
    const upload = (await presign.json()) as { upload_url?: string; upload_filename?: string };
    if (!upload.upload_url || !upload.upload_filename) return null;

    const put = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Blob([png as unknown as BlobPart], { type: "image/png" }),
    });
    if (!put.ok) {
      console.warn(`[Discord RPC] asset upload HTTP ${put.status}`);
      return null;
    }

    const created = await fetch(`${DISCORD_API}/applications/${cfg.clientId}/assets`, {
      method: "POST",
      headers: { Authorization: `Bot ${cfg.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, upload_filename: upload.upload_filename }),
    });
    if (created.ok || created.status === 400) {
      // 400 usually means this deterministic key already exists.
      keys.add(key);
      assetKeyByHash.set(hash, key);
      return key;
    }
    console.warn(`[Discord RPC] asset create HTTP ${created.status}`);
  } catch (err) {
    console.warn("[Discord RPC] head asset upload failed:", err instanceof Error ? err.message : String(err));
  }
  return null;
}

export async function ensureRpcHeadAsset(png: Buffer | undefined): Promise<string | null> {
  if (!png) return null;
  const hash = headHash(png);
  const cached = assetKeyByHash.get(hash);
  if (cached) return cached;
  const pending = pendingByHash.get(hash);
  if (pending) return pending;
  const key = assetKeyForHash(hash);
  const job = uploadHeadAsset(png, hash, key).finally(() => pendingByHash.delete(hash));
  pendingByHash.set(hash, job);
  return job;
}
