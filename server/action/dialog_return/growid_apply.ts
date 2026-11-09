import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import {
  broadcastNameChanged,
  OnConsoleMessage,
  OnPlayPositioned,
  OnTextOverlay,
  SetHasGrowID,
} from "../../onVariant";
import { hashPassword, sanitizeAccountName } from "../../tools/string";
import { showGrowIdApplyModal } from "../growid";

export function applyGrowIdUpgrade(
  ctx: ServerContext,
  session: PlayerSession,
  rawName: string,
  rawPass: string,
  rawPassVerify: string
): void {
  if (!session.account.isGuest) {
    OnConsoleMessage(session, "`4This account already has a GrowID.``"); return;
  }
  const cleanName = sanitizeAccountName(rawName, 18);

  if (rawName !== cleanName || cleanName.length < 3 || cleanName.length > 18) {
    showGrowIdApplyModal(
      session,
      "GrowID name must be between 3 and 18 letters/numbers!",
      cleanName
    );
    return;
  }

  if (rawPass.length < 8 || rawPass.length > 18 || /^\s*$/.test(rawPass)) {
    showGrowIdApplyModal(
      session,
      "Password must be between 8 and 18 characters!",
      cleanName
    );
    return;
  }

  if (rawPass !== rawPassVerify) {
    showGrowIdApplyModal(
      session,
      "Passwords do not match! Please re-enter both password fields.",
      cleanName
    );
    return;
  }

  const lowerTarget = cleanName.toLowerCase();
  const existing = ctx.accounts.get(lowerTarget);
  if (existing && existing.userId !== session.account.userId) {
    showGrowIdApplyModal(
      session,
      `Sorry, the GrowID \`w${cleanName}\`4 is already taken! Try another name.`,
      cleanName
    );
    return;
  }

  const oldKey = session.account.name.toLowerCase();
  if (oldKey !== lowerTarget) {
    ctx.accounts.delete(oldKey);
  }
  if (session.account.deviceKey) {
    ctx.accountsByDevice.delete(session.account.deviceKey);
  }

  // Upgrade account IN-PLACE so userId (World Lock ownership!), inventory, worn clothes, and gems stay 100% intact!
  session.account.name = cleanName;
  session.account.growId = cleanName;
  session.account.isGuest = false;
  session.account.passwordHash = hashPassword(rawPass);
  ctx.ranks.apply(session.account);
  ctx.accounts.set(lowerTarget, session.account);
  ctx.savePlayersNow();

  // Save credentials into client's Save.dat + IDBFS via SetHasGrowID!
  SetHasGrowID(session, true, cleanName, rawPass);
  OnPlayPositioned(session, "audio/piano_nice.wav");
  OnTextOverlay(session, `\`2GrowID \`w${cleanName}\`2 Created!\`\``);
  OnConsoleMessage(
    session,
    `\`2Account upgraded! Your new GrowID \`w${cleanName}\`2 has been created and saved with all your items & clothes!\`\``
  );

  if (session.world) {
    broadcastNameChanged(session.world, session);
  }
}

export function handleGrowIdApplyReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  if (kv.buttonClicked === "Cancel") return;
  const logon = (kv.logon || "").trim();
  const pass = kv.password || "";
  const verify = kv.password_verify !== undefined ? kv.password_verify : pass;
  if (!logon && !pass) return;
  applyGrowIdUpgrade(ctx, session, logon, pass, verify);
}
