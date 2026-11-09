import { protocolFlags } from "../ranks";
import type { ENetServerPeer } from "../network/enet";
import {
  makeTextPacket,
  makeVariantPacket,
  NET_MESSAGE_GAME_MESSAGE,
  NET_MESSAGE_GENERIC_TEXT,
} from "../proton/packet";
import type { ServerContext } from "../database/context";
import { normalizeAccount, type PlayerAccount, type PlayerSession } from "../database/peer";
import { OnConsoleMessage, SetHasGrowID } from "../onVariant";
import { hashPassword, sanitizeAccountName, verifyPassword } from "../tools/string";

// Bound expensive password work even when an attacker reconnects with a new peer.
let authWindowStart = 0, authWindowCount = 0;
function allowPasswordAttempt(): boolean {
  const now = Date.now();
  if (now - authWindowStart >= 1000) { authWindowStart = now; authWindowCount = 0; }
  return ++authWindowCount <= 10;
}

function extractPersistentDeviceKey(peer: ENetServerPeer, kv: Record<string, string>): string {
  if (peer.clientDeviceId && peer.clientDeviceId.length >= 8) {
    return `cid:${peer.clientDeviceId}`;
  }
  const rid = (kv.rid || "").trim().toUpperCase();
  if (rid && rid.length >= 8 && !/^0+$/.test(rid)) {
    return `rid:${rid}`;
  }
  const mac = (kv.mac || "").trim().toLowerCase();
  if (mac && mac !== "02:00:00:00:00:00" && mac !== "00:00:00:00:00:00") {
    return `mac:${mac}`;
  }
  const wk = (kv.wk || "").trim().toUpperCase();
  if (wk && wk.length >= 8 && wk !== "NONE0" && !/^0+$/.test(wk)) {
    return `wk:${wk}`;
  }
  return "";
}

function extractGuestBaseName(rawRequested: string): string {
  const withoutTag = String(rawRequested || "").trim().replace(/_\d{3,4}$/, "");
  const cleanBase = withoutTag.replace(/[^A-Za-z0-9]/g, "").slice(0, 13);
  if (cleanBase.length < 2) {
    return "Guest";
  }
  return cleanBase;
}

function extractGuestSuffix(name: string): string {
  const m = /_(\d{3})$/.exec(name);
  return m ? m[1] : "";
}

function allocateGuestDisplayName(
  ctx: ServerContext,
  baseName: string,
  preferredSuffix = "",
  currentAccount?: PlayerAccount
): string {
  if (preferredSuffix && /^\d{3}$/.test(preferredSuffix)) {
    const candidate = `${baseName}_${preferredSuffix}`;
    const existing = ctx.accounts.get(candidate.toLowerCase());
    if (!existing || (currentAccount && existing.userId === currentAccount.userId)) {
      return candidate;
    }
  }
  for (let attempt = 0; attempt < 900; attempt++) {
    const digits = String(100 + Math.floor(Math.random() * 900));
    const candidate = `${baseName}_${digits}`;
    const existing = ctx.accounts.get(candidate.toLowerCase());
    if (!existing || (currentAccount && existing.userId === currentAccount.userId)) {
      return candidate;
    }
  }
  let seq = 100;
  while (ctx.accounts.has(`${baseName}_${seq}`.toLowerCase())) {
    seq++;
  }
  return `${baseName}_${seq}`;
}

function sendLogonFail(peer: ENetServerPeer, message: string): void {
  peer.sendPacket(0, makeVariantPacket(["OnConsoleMessage", message]), true);
  peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GAME_MESSAGE, "action|logon_fail\n"), true);
}

function sendSuperMainAccept(ctx: ServerContext, peer: ENetServerPeer): void {
  peer.sendPacket(
    0,
    makeVariantPacket([
      "OnSuperMainStartAcceptLogonHrdxs47254722215a",
      { type: "u32", value: ctx.itemsDb.itemsDatHash },
      "localhost",
      "cache/",
      "cc.cz.madkite.freedom org.aqua.gg",
      "proto=209|choosemusic=audio/mp3/about_theme.mp3|reprotocol=3|",
      "",
    ]),
    true
  );
}

function createSessionForAccount(
  ctx: ServerContext,
  peer: ENetServerPeer,
  account: PlayerAccount
): PlayerSession {
  ctx.ranks.apply(account);
  // Disconnect any stale duplicate session using the exact same account
  for (const existingSession of Array.from(ctx.sessions)) {
    if (existingSession.account.userId === account.userId && existingSession.peer !== peer) {
      ctx.leaveCurrentWorld(existingSession, false);
      ctx.sessions.delete(existingSession);
      existingSession.peer.userData = null;
      existingSession.peer.sendDisconnect();
    }
  }

  const session: PlayerSession = {
    peer,
    account,
    netId: ctx.nextNetId++,
    world: null,
    x: 48 * 32,
    y: 36 * 32,
    facingLeft: false,
    ...protocolFlags(account),
    cheats: { noclip: false, speed: false, fly: false },
    pendingEditTile: null,
    pendingTradeOffer: null,
    lastItemSearchQuery: "",
  };
  peer.userData = session;
  ctx.sessions.add(session);
  return session;
}

export function handleLogon(
  ctx: ServerContext,
  peer: ENetServerPeer,
  kv: Record<string, string>
): void {
  if (peer.userData) return; // A live session cannot be reauthenticated in-place.
  if (kv.tankIDName && !/^[A-Za-z0-9_]{3,18}$/.test(kv.tankIDName)) {
    sendLogonFail(peer, "`4Invalid GrowID or password.``"); return;
  }
  const deviceKey = extractPersistentDeviceKey(peer, kv);
  const rawTankId = sanitizeAccountName(kv.tankIDName || "", 18);
  const rawPass = kv.tankIDPass || "";

  // ------------------------------------------------------------------
  // Mode A: Registered GrowID Login (never auto-register or claim a guest by name)
  // ------------------------------------------------------------------
  if (rawTankId.length > 0) {
    if (!allowPasswordAttempt()) { sendLogonFail(peer, "`4Too many login attempts. Try again shortly.``"); return; }
    if (rawTankId.length < 3) {
      sendLogonFail(peer, "`4GrowID must be at least 3 characters long!``");
      return;
    }
    const key = rawTankId.toLowerCase();
    let acct = ctx.accounts.get(key);

    if (!acct || acct.isGuest || !verifyPassword(rawPass, acct.passwordHash)) {
      sendLogonFail(peer, "`4Invalid GrowID or password. Register using Get a GrowID from a guest account.``");
      return;
    }
    if (!acct.passwordHash.startsWith("scrypt$")) {
      acct.passwordHash = hashPassword(rawPass);
      ctx.savePlayersNow();
    }

    if (acct.banned) {
      peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GENERIC_TEXT, "`4This account is banned!``"), true);
      peer.sendDisconnect();
      return;
    }

    const session = createSessionForAccount(ctx, peer, acct);
    SetHasGrowID(session, true, acct.growId || acct.name, rawPass);
    sendSuperMainAccept(ctx, peer);
    return;
  }

  // ------------------------------------------------------------------
  // Mode B: Native Guest Account Login (`<nama>_<3 digits>`)
  //  - Always formats Guest display names as `<baseName>_<100..999>` (e.g. `Player_482`).
  //  - Persists Guest account strictly by `deviceKey` (`cid` / `rid` / `mac` / `wk`),
  //    preserving inventory, worn clothes, gems, and World Locks even if `baseName` changes!
  //  - Never hijacks another player's Guest or GrowID account by bare name!
  // ------------------------------------------------------------------
  const requestedBase = extractGuestBaseName(kv.requestedName || "");
  let guestAcct: PlayerAccount | undefined;

  if (deviceKey) {
    const byDev = ctx.accountsByDevice.get(deviceKey);
    if (byDev && byDev.isGuest) {
      guestAcct = byDev;
      const prevSuffix = extractGuestSuffix(guestAcct.name);
      const prevBase = extractGuestBaseName(guestAcct.name);
      const needsTagFormat = !prevSuffix;
      const baseChanged = prevBase !== requestedBase;

      if (needsTagFormat || baseChanged) {
        const updatedName = allocateGuestDisplayName(ctx, requestedBase, prevSuffix, guestAcct);
        if (updatedName !== guestAcct.name) {
          ctx.accounts.delete(guestAcct.name.toLowerCase());
          guestAcct.name = updatedName;
          ctx.accounts.set(guestAcct.name.toLowerCase(), guestAcct);
          ctx.savePlayersNow();
        }
      }
    }
  }

  if (!guestAcct) {
    const finalGuestName = allocateGuestDisplayName(ctx, requestedBase);
    guestAcct = normalizeAccount({
      userId: ctx.nextUserId++,
      name: finalGuestName,
      isGuest: true,
      growId: "",
      passwordHash: "",
      deviceKey,
    });
    ctx.accounts.set(finalGuestName.toLowerCase(), guestAcct);
    if (deviceKey) {
      ctx.accountsByDevice.set(deviceKey, guestAcct);
    }
    ctx.savePlayersNow();
  }

  if (guestAcct.banned) {
    peer.sendPacket(0, makeTextPacket(NET_MESSAGE_GENERIC_TEXT, "`4This Guest account is banned!``"), true);
    peer.sendDisconnect();
    return;
  }

  const session = createSessionForAccount(ctx, peer, guestAcct);
  // Tell client this is a Guest Account so PauseMenu shows `"Get GrowID (#It's free!)"`!
  SetHasGrowID(session, false, "", "");
  OnConsoleMessage(
    session,
    `\`2Logged in as \`#Guest Account\`2 (\`w${guestAcct.name}\`2)! Your items & clothes are saved automatically.\`\``
  );
  sendSuperMainAccept(ctx, peer);
}
