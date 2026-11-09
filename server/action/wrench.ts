import { hasPermission, canModerate, displayName, rankOf, RANKS } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";

export function handleWrenchPlayer(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const world = session.world;
  if (!world) return;
  const targetNetId = parseInt((kv.netid || "0").trim(), 10);
  if (!targetNetId) return;

  const target = Array.from(world.peers).find((p) => p.netId === targetNetId);
  if (!target) {
    OnConsoleMessage(session, "`4Player not found!``");
    return;
  }

  // Self-wrench profile dialog (modeled on Gurotopia `action/wrench.cpp`)
  if (target === session) {
    const acct = session.account;
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", `${displayName(session)} (\`#${acct.isGuest ? "Guest Account" : "GrowID"}\`\`)`, 32)
      .addSmalltext(`\`9User ID: \`w${acct.userId}\`9 | Gems: \`2${acct.gems}\`9 | Backpack: \`w${acct.inventory.length}/${acct.backpackSize}\`\``)
      .addSpacer("small")
      .addButtonWithIcon("acct_find", "`2Item Finder (/find)``", 6016);
    dlg.addSmalltext(`Rank: ${RANKS[rankOf(acct)].label}`);
    if (hasPermission(acct, "debug")) dlg.addButtonWithIcon("acct_cheats", "`5Developer Tools``", 5480);

    if (acct.isGuest) {
      dlg.addButtonWithIcon("acct_growid", "`2Get Free GrowID!``", 206);
    }
    dlg.addQuickExit();
    OnDialogRequest(session, dlg.endDialog("self_wrench", "Close", ""));
    return;
  }

  // Wrenching another player in the world
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", displayName(target), 32)
    .addSmalltext(`\`9User ID: \`w${target.account.userId}\`9 | Gems: \`2${target.account.gems}\`\``)
    .addSpacer("small")
    .addButtonWithIcon(`trade_start_${target.netId}`, "`2Trade Item``", 1422);

  if (canModerate(session.account, target.account)) {
    dlg
      .addButtonWithIcon(`mod_pull_${target.netId}`, "Pull to Me", 32)
      .addButtonWithIcon(`mod_kick_${target.netId}`, "`4Kick``", 32, "staticRedFrame")
      .addButtonWithIcon(`mod_ban_${target.netId}`, "`4Ban``", 32, "staticRedFrame");
  }
  dlg.addQuickExit();
  OnDialogRequest(session, dlg.endDialog("target_wrench", "Close", ""));
}

export function openTradeOfferDialog(ctx: ServerContext, session: PlayerSession): void {
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wTrade Offer``", 1422)
    .addTextbox("`9Select an item from your inventory to offer:``")
    .addSpacer("small");

  let listed = 0;
  for (const slot of session.account.inventory) {
    if (slot.count <= 0 || slot.itemId === 18 || slot.itemId === 32) continue;
    const def = ctx.itemsDb.get(slot.itemId);
    if (!def || def.name.startsWith("null_")) continue;
    const clean = def.name.replace(/`.|``/g, "").replace(/\|/g, "");
    dlg.addButtonWithIcon(`trade_offer_${slot.itemId}`, `\`w1x ${clean}\`\``, slot.itemId, "staticBlueFrame", slot.count);
    listed++;
    if (listed >= 48) break;
  }
  if (listed === 0) {
    dlg.addTextbox("`4Your inventory has no tradeable items!``");
  }
  OnDialogRequest(session, dlg.endDialog("trade_offer", "Close", ""));
}

export function handleTradeStart(
  ctx: ServerContext,
  session: PlayerSession,
  targetNetId: number
): void {
  const world = session.world;
  if (!world) return;
  const target = Array.from(world.peers).find((p) => p.netId === targetNetId);
  if (!target || target === session) {
    OnConsoleMessage(session, "`4Player not found!``");
    return;
  }
  if (session.pendingTradeOffer || target.pendingTradeOffer) {
    OnConsoleMessage(session, "`4One of you is already in a trade!``");
    return;
  }
  session.pendingTradeOffer = {
    role: "offering",
    fromNetId: session.netId,
    toNetId: target.netId,
    itemId: 0,
  };
  target.pendingTradeOffer = {
    role: "awaiting",
    fromNetId: session.netId,
    toNetId: target.netId,
    itemId: 0,
  };
  openTradeOfferDialog(ctx, session);
}
