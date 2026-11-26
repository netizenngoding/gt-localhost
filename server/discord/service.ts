import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServerContext } from "../database/context";
import type { PlayerAccount, PlayerSession } from "../database/peer";
import { DISCORD_ICON_ITEM_ID } from "../database/items";
import { OnConsoleMessage, OnModernDialogRequest, OnSetBux, OnTalkBubble, OnTextOverlay } from "../onVariant";
import { ModernDialog } from "../tools/modern_dialog";
import { progression } from "../progression/service";
import { buildModernLinkedBanner } from "./banner";

interface DiscordConfig {
  botToken: string;
  clientId: string;
  publicBaseUrl: string;
  redirectUri: string;
  channelId: string;
  rpcHeadChannelId: string;
  guildInvite: string;
}

const DEFAULT_CHANNEL_ID = "1575034325945024593";
const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const DISCORD_FIRST_LINK_GEMS = 100;
const DISCORD_API = "https://discord.com/api/v10";

function readConfig(): DiscordConfig {
  let raw: Record<string, unknown> = {};
  try {
    const file = path.join(process.cwd(), "config", "discord.json");
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.warn("[Discord] config/discord.json tidak valid:", err instanceof Error ? err.message : String(err));
  }
  const str = (key: string, fallback = ""): string => {
    const env = process.env[key.toUpperCase()];
    if (typeof env === "string" && env.trim()) return env.trim();
    const value = raw[key];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  };
  const publicBaseUrl = str("publicBaseUrl", "http://127.0.0.1:3000").replace(/\/+$/, "");
  return {
    botToken: str("botToken"),
    clientId: str("clientId"),
    publicBaseUrl,
    redirectUri: str("redirectUri", `${publicBaseUrl}/discord/callback`),
    channelId: str("channelId", DEFAULT_CHANNEL_ID),
    rpcHeadChannelId: str("rpcHeadChannelId", ""),
    guildInvite: str("guildInvite", "https://discord.gg/magnolia"),
  };
}

const config = readConfig();
const playerHeads = new Map<string, Buffer>();
const playerHeadCanonical = new Map<string, Buffer>();
const HEAD_CACHE_FILE = path.join(process.cwd(), "data", "cache", "player-heads.json");
let headSaveTimer: NodeJS.Timeout | null = null;
const playerHeadUrls = new Map<string, string>();
const playerHeadUploads = new Map<string, Promise<string | null>>();
const headUploadRefs = new Map<string, { channelId: string; messageId: string; keys: string[] }>();
let headRefreshTimer: NodeJS.Timeout | null = null;
let discordCtx: ServerContext | null = null;


function loadStoredHeads(): void {
  try {
    if (!fs.existsSync(HEAD_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(HEAD_CACHE_FILE, "utf8")) as Record<string, string>;
    for (const [key, b64] of Object.entries(raw || {})) {
      if (typeof b64 !== "string" || b64.length < 64) continue;
      const png = Buffer.from(b64, "base64");
      if (png.length < 64 || png.length > 512 * 1024) continue;
      playerHeadCanonical.set(key, png);
      for (const k of headKeys(key)) playerHeads.set(k, png);
    }
  } catch (err) {
    console.warn("[Discord] gagal memuat cache head:", err instanceof Error ? err.message : String(err));
  }
}

function saveStoredHeads(): void {
  try {
    fs.mkdirSync(path.dirname(HEAD_CACHE_FILE), { recursive: true });
    const out: Record<string, string> = {};
    for (const [key, png] of playerHeadCanonical) out[key] = png.toString("base64");
    const tmp = HEAD_CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, HEAD_CACHE_FILE);
  } catch (err) {
    console.warn("[Discord] gagal menyimpan cache head:", err instanceof Error ? err.message : String(err));
  }
}

function scheduleHeadSave(): void {
  if (headSaveTimer) return;
  headSaveTimer = setTimeout(() => {
    headSaveTimer = null;
    saveStoredHeads();
  }, 500);
  if (typeof headSaveTimer.unref === "function") headSaveTimer.unref();
}

loadStoredHeads();

function headKeys(deviceKey: string): string[] {
  const raw = deviceKey.replace(/^cid:/, "");
  return [...new Set([deviceKey, raw, `cid:${raw}`])].filter(Boolean);
}

async function uploadHeadToDiscord(deviceKey: string, png: Buffer): Promise<string | null> {
  const channelId = config.rpcHeadChannelId || config.channelId;
  if (!config.botToken || !channelId) return null;

  const hash = crypto.createHash("sha256").update(png).digest("hex");
  const existing = playerHeadUploads.get(hash);
  if (existing) return existing;

  const upload = (async (): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: "", allowed_mentions: { parse: [] } }));
      form.append("files[0]", new Blob([png as unknown as BlobPart], { type: "image/png" }), `magnolia-head-${hash.slice(0, 10)}.png`);
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${config.botToken}` },
        body: form,
      });
      if (!res.ok) {
        console.warn(`[Discord RPC] head upload HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { id?: string; attachments?: Array<{ url?: string }> };
      const url = typeof json.attachments?.[0]?.url === "string" ? json.attachments[0].url : null;
      if (url) {
        const keys = headKeys(deviceKey);
        for (const key of keys) playerHeadUrls.set(key, url);
        if (json.id) headUploadRefs.set(hash, { channelId, messageId: json.id, keys });
        while (playerHeadUrls.size > 600) {
          const first = playerHeadUrls.keys().next().value;
          if (!first) break;
          playerHeadUrls.delete(first);
        }
      }
      return url;
    } catch (err) {
      console.warn("[Discord RPC] head upload failed:", err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      playerHeadUploads.delete(hash);
    }
  })();

  playerHeadUploads.set(hash, upload);
  return upload;
}

async function refreshHeadUrls(): Promise<void> {
  if (!config.botToken) return;
  for (const ref of headUploadRefs.values()) {
    try {
      const res = await fetch(`${DISCORD_API}/channels/${ref.channelId}/messages/${ref.messageId}`, {
        headers: { Authorization: `Bot ${config.botToken}` },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { attachments?: Array<{ url?: string }> };
      const url = typeof json.attachments?.[0]?.url === "string" ? json.attachments[0].url : null;
      if (url) for (const key of ref.keys) playerHeadUrls.set(key, url);
    } catch {
      // Keep the old URL; the next refresh can try again.
    }
  }
}

export function storePlayerHead(deviceKey: string, png: Buffer): void {
  if (!deviceKey || png.length < 64 || png.length > 512 * 1024) return;
  const copy = Buffer.from(png);
  playerHeadCanonical.set(deviceKey, copy);
  for (const key of headKeys(deviceKey)) playerHeads.set(key, copy);
  scheduleHeadSave();
  void uploadHeadToDiscord(deviceKey, copy);
  while (playerHeadCanonical.size > 600) {
    const first = playerHeadCanonical.keys().next().value;
    if (!first) break;
    playerHeadCanonical.delete(first);
    for (const key of headKeys(first)) playerHeads.delete(key);
  }
}

export function getPlayerHead(deviceKey: string): Buffer | undefined {
  if (!deviceKey) return undefined;
  const raw = deviceKey.replace(/^cid:/, "");
  return playerHeads.get(deviceKey) || playerHeads.get(`cid:${raw}`) || playerHeads.get(raw);
}

export function getPlayerHeadUrl(deviceKey: string): string | undefined {
  if (!deviceKey) return undefined;
  const raw = deviceKey.replace(/^cid:/, "");
  return playerHeadUrls.get(deviceKey) || playerHeadUrls.get(`cid:${raw}`) || playerHeadUrls.get(raw);
}

async function waitForPlayerHead(deviceKey: string, timeoutMs = 2500): Promise<Buffer | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const head = getPlayerHead(deviceKey);
    if (head) return head;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getPlayerHead(deviceKey);
}
let cachedApplicationId: string | null = config.clientId || null;
let applicationIdPromise: Promise<string | null> | null = null;

export function discordConfigured(): boolean {
  return !!config.botToken;
}

export function discordConfig(): Readonly<DiscordConfig> {
  return config;
}

export function discordStatus(account: PlayerAccount): { linked: boolean; id: string; username: string } {
  return {
    linked: !!(account.discordId && account.discordName),
    id: account.discordId || "",
    username: account.discordName || "",
  };
}

export function createDiscordLinkCode(account: PlayerAccount): string {
  const code = crypto.randomBytes(18).toString("base64url");
  account.discordLinkCode = code;
  account.discordLinkExpires = Date.now() + LINK_CODE_TTL_MS;
  return code;
}

export function discordLinkUrl(code: string): string {
  return `${config.publicBaseUrl}/discord/link?code=${encodeURIComponent(code)}`;
}

async function applicationId(): Promise<string | null> {
  if (cachedApplicationId) return cachedApplicationId;
  if (!config.botToken) return null;
  if (!applicationIdPromise) {
    applicationIdPromise = fetch(`${DISCORD_API}/applications/@me`, {
      headers: { Authorization: `Bot ${config.botToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`applications/@me HTTP ${res.status}`);
        const json = (await res.json()) as { id?: string };
        cachedApplicationId = typeof json.id === "string" ? json.id : null;
        return cachedApplicationId;
      })
      .catch((err) => {
        console.warn("[Discord] gagal membaca application id:", err instanceof Error ? err.message : String(err));
        applicationIdPromise = null;
        return null;
      });
  }
  return applicationIdPromise;
}

export async function discordAuthorizeUrl(code: string): Promise<string | null> {
  const clientId = await applicationId();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    scope: "identify",
    redirect_uri: config.redirectUri,
    state: code,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function linkDiscordAccount(
  ctx: ServerContext,
  code: string,
  discordId: string,
  discordName: string
): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{5,32}$/.test(discordId)) return { ok: false, message: "Discord ID tidak valid." };
  const cleanName = String(discordName || "").replace(/[^\w .#@-]/g, "").slice(0, 40) || "Discord User";
  const account = Array.from(ctx.accounts.values()).find(
    (a) => a.discordLinkCode === code && (a.discordLinkExpires || 0) > Date.now()
  );
  if (!account) return { ok: false, message: "Link sudah kedaluwarsa. Buat link baru dari dalam game." };
  for (const other of ctx.accounts.values()) {
    if (other.userId !== account.userId && other.discordId === discordId) {
      other.discordId = undefined;
      other.discordName = undefined;
      other.discordLinkedAt = undefined;
    }
  }
  const firstLink = !account.discordId;
  const firstEverLink = !account.discordFirstLinkRewarded;
  if (firstEverLink) {
    account.discordFirstLinkRewarded = true;
    account.gems = Math.max(0, Number(account.gems) || 0) + DISCORD_FIRST_LINK_GEMS;
  }
  account.discordId = discordId;
  account.discordName = cleanName;
  account.discordLinkedAt = Date.now();
  account.discordLinkCode = undefined;
  account.discordLinkExpires = undefined;
  ctx.dirty = true;
  ctx.savePlayersNow();
  if (firstLink) void sendLinkedAnnouncement(ctx, account).catch((err) => console.warn("[Discord] linked announcement gagal:", err instanceof Error ? err.message : String(err)));
  for (const session of ctx.sessions) {
    if (session.account.userId === account.userId) {
      OnConsoleMessage(session, firstEverLink
        ? `Discord account linked. First link reward: ${DISCORD_FIRST_LINK_GEMS} Gems.`
        : "Discord account linked.");
      OnTalkBubble(session, session.netId, firstEverLink
        ? `I've linked my Discord! +${DISCORD_FIRST_LINK_GEMS} Gems`
        : "I've linked my Discord!", 0, true);
      if (firstEverLink) OnSetBux(session);
      sendDiscordLinkDialog(session);
    }
  }
  return { ok: true, message: `Discord @${cleanName} berhasil terhubung.` };
}

async function discordMessage(
  channelId: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  if (!config.botToken || !channelId) return null;
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[Discord] send message HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { id?: string };
    return typeof json.id === "string" ? json.id : null;
  } catch (err) {
    console.warn("[Discord] send message gagal:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function deleteDiscordMessage(channelId: string, messageId: string): Promise<void> {
  if (!config.botToken || !channelId || !messageId) return;
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${config.botToken}` },
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[Discord] delete announcement HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("[Discord] delete announcement gagal:", err instanceof Error ? err.message : String(err));
  }
}

/** Upload the Growtopia-style linked banner as a real Discord attachment. */
async function discordUploadMessage(
  channelId: string,
  payload: Record<string, unknown>,
  png: Buffer
): Promise<string | null> {
  if (!config.botToken || !channelId) return null;
  try {
    const FormDataCtor = (globalThis as unknown as { FormData: new () => { append: (k: string, v: unknown, f?: string) => void } }).FormData;
    const BlobCtor = (globalThis as unknown as { Blob: new (parts: unknown[], opts: { type: string }) => unknown }).Blob;
    const form = new FormDataCtor();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new BlobCtor([new Uint8Array(png)], { type: "image/png" }), "magnolia-linked.png");
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${config.botToken}` },
      body: form as unknown as BodyInit,
    });
    if (!res.ok) {
      console.warn(`[Discord] upload message HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const json = (await res.json()) as { id?: string };
    return typeof json.id === "string" ? json.id : null;
  } catch (err) {
    console.warn("[Discord] upload message gagal:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function sendLinkedAnnouncement(ctx: ServerContext, account: PlayerAccount): Promise<void> {
  if (!discordConfigured() || !config.channelId || !account.discordId) return;
  const session = Array.from(ctx.sessions).find((s) => s.account.userId === account.userId);
  const level = progression(account).level;
  const world = session?.world?.name || account.homeWorld || "UNKNOWN";
  const growId = account.growId || account.name;
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date()).replace(" at ", " ");
  const head = account.deviceKey ? await waitForPlayerHead(account.deviceKey) : undefined;
  const banner = await buildModernLinkedBanner({
    growId,
    discordName: account.discordName || "user",
    level,
    world,
    headPng: head,
    baseUrl: `http://127.0.0.1:${process.env.PORT || 3000}`,
  });
  const content = `<@${account.discordId}> \`${growId}\` was linked to this Discord account from **World** \`${world}\` at \`${when}\` (Level ${level}, use the Unlink button below if that wasn't you)`;
  const payload = {
    content,
    allowed_mentions: { users: [account.discordId] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: "🔒 Unlink Discord",
            custom_id: `discord_unlink:${account.userId}`,
          },
        ],
      },
    ],
  };
  const messageId = banner ? await discordUploadMessage(config.channelId, payload, banner) : null;
  const finalId = messageId || await discordMessage(config.channelId, payload);
  if (finalId) {
    account.discordLinkMessageId = finalId;
    ctx.dirty = true;
    ctx.savePlayersNow();
  }

}

async function createDmChannel(discordId: string): Promise<string | null> {
  if (!config.botToken) return null;
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: discordId }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { id?: string };
    return typeof json.id === "string" ? json.id : null;
  } catch {
    return null;
  }
}

export function sendDiscordLinkDialog(session: PlayerSession): void {
  const acct = session.account;
  const status = discordStatus(acct);
  if (status.linked) {
    const dlg = new ModernDialog("discord_link_dialog", { width: "lg" })
      .setTitle("Discord", { itemId: DISCORD_ICON_ITEM_ID })
      .addText(`Your Discord account is linked as @${status.username}.`)
      .addSpacer("sm")
      .beginSection({ tone: "teal" })
        .addText("Link status", { size: "lg" })
        .addSpacer("sm")
        .addCounterRow({ iconItemId: DISCORD_ICON_ITEM_ID, text: "Discord account connected" })
        .addSpacer("sm")
        .addCounterRow({
          iconItemId: 112,
          text: acct.discordFirstLinkRewarded ? "First link reward: claimed" : "First link reward: not claimed",
        })
      .endSection()
      .addSpacer("md")
      .addSpacer("md")
      .addButtonRow([
        { id: "discord_profile", label: "Open Profile", color: "default", url: `https://discord.com/users/${status.id}` },
        { id: "discord_unlink", label: "Unlink Discord", color: "default" },
      ], { justify: "between", equalWidth: true });
    OnModernDialogRequest(session, dlg);
    return;
  }
  if (!discordConfigured()) {
    OnConsoleMessage(session, "Discord linking is not configured on this server.");
    return;
  }
  const code = createDiscordLinkCode(acct);
  const rewardAvailable = !acct.discordFirstLinkRewarded;
  const dlg = new ModernDialog("discord_link_dialog", { width: "lg" })
    .setTitle("Link Discord", { itemId: DISCORD_ICON_ITEM_ID })
    .addText("Connect your Discord account to Magnolia. It takes a few seconds and helps keep your account safe.")
    .addSpacer("sm")
    .beginSection({ tone: "teal" })
      .addText("Link benefits", { size: "lg" })
      .addSpacer("sm")
      .addCounterRow({
        iconItemId: 112,
        text: rewardAvailable ? `First link reward: ${DISCORD_FIRST_LINK_GEMS} Gems` : "First link reward: already claimed",
      })
    .endSection()
    .addSpacer("md")
    .addSmallText("The first link reward can only be claimed once per account.")
    .addSpacer("md")
    .addButtonRow([
      { id: "discord_open", label: "Open Discord", color: "green", url: discordLinkUrl(code) },
      { id: "discord_close", label: "Close", color: "default", closeOnClick: true },
    ], { justify: "between", equalWidth: true });
  OnModernDialogRequest(session, dlg);
}

export function resetDiscordLink(account: PlayerAccount): void {
  const announcementId = account.discordLinkMessageId;
  account.discordId = undefined;
  account.discordName = undefined;
  account.discordLinkedAt = undefined;
  account.discordLinkCode = undefined;
  account.discordLinkExpires = undefined;
  account.discordLinkMessageId = undefined;
  if (announcementId && config.channelId) {
    void deleteDiscordMessage(config.channelId, announcementId);
  }
}

// ---------------------------------------------------------------------------
// Discord message-component interactions (real buttons, no public webhook)
// ---------------------------------------------------------------------------
interface DiscordInteraction {
  id?: string;
  token?: string;
  type?: number;
  data?: { custom_id?: string };
  member?: { user?: { id?: string } };
  user?: { id?: string };
}

async function respondInteraction(interaction: DiscordInteraction, body: Record<string, unknown>): Promise<void> {
  if (!interaction.id || !interaction.token) return;
  try {
    const res = await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`[Discord] interaction response HTTP ${res.status}`);
  } catch (err) {
    console.warn("[Discord] interaction response gagal:", err instanceof Error ? err.message : String(err));
  }
}

async function handleDiscordInteraction(raw: unknown): Promise<void> {
  const interaction = raw as DiscordInteraction;
  if (!interaction || interaction.type !== 3) return;
  const customId = String(interaction.data?.custom_id || "");
  if (!customId.startsWith("discord_unlink:")) return;
  const userId = Number(customId.slice("discord_unlink:".length));
  const clickerId = interaction.member?.user?.id || interaction.user?.id || "";
  const ctx = discordCtx;
  if (!ctx || !Number.isSafeInteger(userId)) return;

  const account = Array.from(ctx.accounts.values()).find((candidate) => candidate.userId === userId);
  if (!account || !account.discordId) {
    await respondInteraction(interaction, {
      type: 4,
      data: { content: "This account is not linked to Discord anymore.", flags: 64 },
    });
    return;
  }
  if (account.discordId !== clickerId) {
    await respondInteraction(interaction, {
      type: 4,
      data: { content: "Only the Discord account linked to this GrowID can unlink it.", flags: 64 },
    });
    return;
  }

  const name = account.growId || account.name;
  // The button response edits this exact message in place, so don't let
  // resetDiscordLink delete it out from under the interaction response.
  account.discordLinkMessageId = undefined;
  resetDiscordLink(account);
  ctx.dirty = true;
  ctx.savePlayersNow();
  for (const session of ctx.sessions) {
    if (session.account.userId === account.userId) {
      OnConsoleMessage(session, "Discord account unlinked.");
      OnTextOverlay(session, "Discord account unlinked.");
      OnTalkBubble(session, session.netId, "I've removed my access!", 0, true);
      sendDiscordLinkDialog(session);
    }
  }

  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date()).replace(" at ", " ");
  await respondInteraction(interaction, {
    type: 7,
    data: {
      content: `\`${name}\` was unlinked from this Discord account at \`${when}\`.`,
      attachments: [],
      components: [],
      allowed_mentions: { parse: [] },
    },
  });
}

// ---------------------------------------------------------------------------
// Discord Gateway presence: "Watching <n> players online"
// ---------------------------------------------------------------------------
let presenceStarted = false;
let presenceSocket: import("ws").WebSocket | null = null;
let presenceHeartbeat: NodeJS.Timeout | null = null;
let presenceSeq = 0;
let presenceReconnect: NodeJS.Timeout | null = null;
let onlineCountProvider: (() => number) | null = null;

function presenceActivity(): Record<string, unknown> {
  const count = Math.max(0, Math.floor(onlineCountProvider ? onlineCountProvider() : 0));
  return {
    since: null,
    afk: false,
    status: "online",
    activities: [
      {
        name: `${count} player${count === 1 ? "" : "s"} online`,
        type: 3, // Watching
      },
    ],
  };
}

function sendPresenceUpdate(): void {
  const ws = presenceSocket;
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ op: 3, d: presenceActivity() }));
  } catch {
    // Reconnect loop owns recovery.
  }
}

async function connectDiscordGateway(): Promise<void> {
  if (!config.botToken || presenceStarted === false) return;
  try {
    const res = await fetch(`${DISCORD_API}/gateway/bot`, {
      headers: { Authorization: `Bot ${config.botToken}` },
    });
    if (!res.ok) throw new Error(`gateway/bot HTTP ${res.status}`);
    const data = (await res.json()) as { url?: string };
    const url = typeof data.url === "string" && data.url ? data.url : "wss://gateway.discord.gg";
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`${url}/?v=10&encoding=json`);
    presenceSocket = ws;

    ws.on("message", (raw) => {
      let packet: { op?: number; t?: string; d?: unknown; s?: number | null };
      try {
        packet = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
      } catch {
        return;
      }
      if (typeof packet.s === "number") presenceSeq = packet.s;
      if (packet.op === 0) {
        if (packet.t === "INTERACTION_CREATE") {
          void handleDiscordInteraction(packet.d).catch((err) =>
            console.warn("[Discord] interaction gagal:", err instanceof Error ? err.message : String(err))
          );
        } else if (packet.t === "READY") {
          console.log("[Discord] gateway presence ready");
        }
      }
      if (packet.op === 10) {
        const hello = packet.d as { heartbeat_interval?: number } | undefined;
        const interval = Math.max(5000, Number(hello?.heartbeat_interval) || 41250);
        if (presenceHeartbeat) clearInterval(presenceHeartbeat);
        presenceHeartbeat = setInterval(() => {
          if (ws.readyState === 1) {
            try { ws.send(JSON.stringify({ op: 1, d: presenceSeq })); } catch {}
          }
        }, interval);
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: config.botToken,
            intents: 0,
            properties: { os: process.platform, browser: "MagnoliaPS", device: "MagnoliaPS" },
            presence: presenceActivity(),
          },
        }));
      } else if (packet.op === 1) {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify({ op: 1, d: presenceSeq })); } catch {}
        }
      } else if (packet.op === 7) {
        ws.close();
      } else if (packet.op === 9) {
        ws.close();
      }
    });

    ws.on("close", () => {
      if (presenceHeartbeat) { clearInterval(presenceHeartbeat); presenceHeartbeat = null; }
      if (presenceSocket === ws) presenceSocket = null;
      if (presenceStarted && !presenceReconnect) {
        presenceReconnect = setTimeout(() => {
          presenceReconnect = null;
          void connectDiscordGateway();
        }, 10000);
      }
    });
    ws.on("error", () => {
      try { ws.close(); } catch {}
    });
  } catch (err) {
    console.warn("[Discord] gateway gagal:", err instanceof Error ? err.message : String(err));
    if (presenceStarted && !presenceReconnect) {
      presenceReconnect = setTimeout(() => {
        presenceReconnect = null;
        void connectDiscordGateway();
      }, 15000);
    }
  }
}

export function startDiscordPresence(getOnlineCount: () => number, ctx?: ServerContext): void {
  if (!config.botToken || presenceStarted) return;
  if (ctx) discordCtx = ctx;
  onlineCountProvider = getOnlineCount;
  presenceStarted = true;
  void connectDiscordGateway();
  const update = setInterval(() => {
    if (presenceSocket && presenceSocket.readyState === 1) sendPresenceUpdate();
  }, 15_000);
  if (typeof update.unref === "function") update.unref();
  if (!headRefreshTimer) {
    headRefreshTimer = setInterval(() => void refreshHeadUrls(), 6 * 60 * 60 * 1000);
    if (typeof headRefreshTimer.unref === "function") headRefreshTimer.unref();
  }
}
