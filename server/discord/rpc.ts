import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { getPlayerHead } from "./service";
import { ensureRpcHeadAsset, getCachedRpcHeadAsset } from "./rpc-assets";

/**
 * Optional local Discord Rich Presence bridge.
 *
 * Discord's RPC/IPC socket only exists on the machine where the Discord desktop
 * client is running. This server is normally run on the same Windows machine as
 * Discord, so it can publish the host's current Magnolia session directly to
 * Discord without any browser extension or companion app.
 *
 * When the server is hosted remotely there is no local Discord IPC pipe; the
 * bridge stays silent and the normal bot presence still works.
 */

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RECONNECT_MS = 15_000;
const UPDATE_MS = 10_000;
const RPC_LARGE_IMAGE = "magnolia_logo";
const RPC_BUTTON_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const RPC_DISCORD_URL = "https://discord.gg/rSyHNwqEE";
const activityStartedAt = new Map<number, number>();

let started = false;
let clientId = "";
let publicBaseUrl = "";
let context: ServerContext | null = null;
let socket: net.Socket | null = null;
let readBuffer = Buffer.alloc(0);
let handshakeDone = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let lastActivityJson = "";
let lastPipe = "";
let connectedOnce = false;
let readyLogged = false;

function discordPipes(): string[] {
  if (process.platform === "win32") {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const bases = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    "/tmp",
  ].filter((value): value is string => !!value);
  const unique = [...new Set(bases)];
  return unique.flatMap((base) =>
    Array.from({ length: 10 }, (_, i) => path.join(base, `discord-ipc-${i}`))
  );
}

function writeFrame(op: number, payload: unknown): void {
  if (!socket || socket.destroyed || !socket.writable) return;
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(json.length, 4);
  try {
    socket.write(Buffer.concat([header, json]));
  } catch {
    // close handler owns recovery
  }
}

function sessionIsLocal(session: PlayerSession): boolean {
  try {
    const socket = (session.peer as unknown as { ws?: { _socket?: { remoteAddress?: string } } })?.ws?._socket;
    const ip = String(socket?.remoteAddress || "");
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  } catch {
    return false;
  }
}

function latestSession(): PlayerSession | null {
  if (!context) return null;
  const preferred = String(process.env.DISCORD_RPC_PLAYER || "").trim().toLowerCase();
  let first: PlayerSession | null = null;
  let localLatest: PlayerSession | null = null;
  for (const session of context.sessions) {
    if (!session?.account) continue;
    if (!session.account.discordId) continue;
    if (!first) first = session;
    const name = String(session.account.name || "").toLowerCase();
    const growId = String(session.account.growId || "").toLowerCase();
    if (preferred && (name === preferred || growId === preferred)) return session;
    if (sessionIsLocal(session)) localLatest = session;
  }
  return localLatest || first;
}

function presenceActivity(): Record<string, unknown> | null {
  const session = latestSession();
  if (!session) return null;

  const world = session.world?.name || "World Select";
  const name = session.account.name || "Growtopian";
  const level = Number(session.account.progression?.level) || 1;
  const players = context?.sessions.size || 1;
  const head = getPlayerHead(session.account.deviceKey) || getPlayerHead(session.peer.clientDeviceId || "");
  const headAsset = getCachedRpcHeadAsset(head);
  if (head && !headAsset) {
    void ensureRpcHeadAsset(head).then(() => {
      lastActivityJson = "";
      sendActivity();
    });
  }
  let startedAt = activityStartedAt.get(session.account.userId);
  if (!startedAt) {
    startedAt = Date.now();
    activityStartedAt.set(session.account.userId, startedAt);
  }

  return {
    name: "Magnolia Growtopia",
    type: 0,
    details: `World: ${world}`.slice(0, 128),
    state: `Playing as ${name} • Level ${level} • ${players} online`.slice(0, 128),
    assets: { large_image: headAsset || RPC_LARGE_IMAGE, large_text: name, large_url: RPC_BUTTON_URL },
    details_url: RPC_BUTTON_URL,
    state_url: RPC_BUTTON_URL,
    timestamps: { start: startedAt },
    party: { id: "magnolia-server", size: [players, Math.max(players, 100)] },
    buttons: [{ label: "Join Server", url: RPC_BUTTON_URL }, { label: "Discord", url: RPC_DISCORD_URL }],
    instance: false,
  };
}

function sendActivity(): void {
  if (!handshakeDone) return;
  const activity = presenceActivity();
  const key = JSON.stringify(activity);
  if (key === lastActivityJson) return;
  lastActivityJson = key;
  writeFrame(OP_FRAME, {
    cmd: "SET_ACTIVITY",
    args: { pid: process.pid, activity },
    nonce: crypto.randomUUID(),
  });
}

function isPublicHttps(base: string): boolean {
  return /^https:\/\//i.test(base) && !/localhost|127\.0\.0\.1|\[::1\]/i.test(base);
}

function parseFrames(): void {
  while (readBuffer.length >= 8) {
    const op = readBuffer.readUInt32LE(0);
    const length = readBuffer.readUInt32LE(4);
    if (length > 2 * 1024 * 1024) {
      readBuffer = Buffer.alloc(0);
      try { socket?.destroy(); } catch { /* ignore */ }
      return;
    }
    if (readBuffer.length < 8 + length) return;
    const raw = readBuffer.subarray(8, 8 + length);
    readBuffer = readBuffer.subarray(8 + length);

    if (op === OP_PING) {
      let payload: unknown = {};
      try { payload = JSON.parse(raw.toString("utf8")); } catch { /* use empty */ }
      writeFrame(OP_PONG, payload);
      continue;
    }
    if (op !== OP_FRAME) continue;

    let message: { cmd?: string; evt?: string; data?: unknown } | null = null;
    try {
      message = JSON.parse(raw.toString("utf8")) as { cmd?: string; evt?: string; data?: unknown };
    } catch {
      continue;
    }
    if (message?.evt === "READY" || message?.cmd === "DISPATCH") {
      handshakeDone = true;
      lastActivityJson = "";
      if (!readyLogged) {
        readyLogged = true;
        console.log("[Discord RPC] activity bridge ready");
      }
      sendActivity();
    } else if (message?.evt === "ERROR") {
      console.warn("[Discord RPC] Discord menolak activity:", JSON.stringify(message.data ?? {}));
    }
  }
}

function scheduleReconnect(): void {
  if (!started || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNext(0);
  }, RECONNECT_MS);
  if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
}

function attach(next: net.Socket): void {
  socket = next;
  readBuffer = Buffer.alloc(0);
  handshakeDone = false;
  lastActivityJson = "";

  next.on("data", (chunk) => {
    readBuffer = Buffer.concat([readBuffer, chunk]);
    parseFrames();
  });
  next.on("error", () => {
    try { next.destroy(); } catch { /* ignore */ }
  });
  next.on("close", () => {
    if (socket === next) {
      socket = null;
      handshakeDone = false;
      lastActivityJson = "";
    }
    scheduleReconnect();
  });
}

function connectNext(index: number): void {
  if (!started) return;
  const pipes = discordPipes();
  if (index >= pipes.length) {
    scheduleReconnect();
    return;
  }

  const pipe = pipes[index];
  const next = net.createConnection(pipe);
  let opened = false;

  next.once("connect", () => {
    opened = true;
    lastPipe = pipe;
    attach(next);
    writeFrame(OP_HANDSHAKE, { v: 1, client_id: clientId });
    if (!connectedOnce) {
      connectedOnce = true;
      console.log("[Discord RPC] local rich presence connected");
    }
  });

  next.once("error", () => {
    if (opened) return;
    try { next.destroy(); } catch { /* ignore */ }
    connectNext(index + 1);
  });
}

/**
 * Starts the local Rich Presence bridge. Safe to call once at server startup.
 * Set `DISABLE_DISCORD_RPC=1` to turn it off.
 */
export function startLocalDiscordRpc(ctx: ServerContext, applicationId: string, publicUrl = ""): void {
  if (started || !applicationId || process.env.DISABLE_DISCORD_RPC === "1") return;
  context = ctx;
  clientId = String(applicationId).trim();
  publicBaseUrl = String(publicUrl || "").trim();
  started = true;
  connectNext(0);

  updateTimer = setInterval(() => {
    sendActivity();
  }, UPDATE_MS);
  if (typeof updateTimer.unref === "function") updateTimer.unref();

  console.log("[Discord RPC] looking for local Discord client...");
}

/** Push a fresh world/account state immediately after a world change. */
export function refreshLocalDiscordRpc(ctx?: ServerContext): void {
  if (ctx) context = ctx;
  sendActivity();
}

export function localDiscordRpcPipe(): string {
  return lastPipe;
}
