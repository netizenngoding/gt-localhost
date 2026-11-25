import type { ServerContext } from "../database/context";
import { isIllegalItem, isUntradeable } from "../database/items";
import { liveSessions, type PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";
import { OnConsoleMessage, OnModernDialogRequest, OnPlayPositioned, OnTalkBubble } from "../onVariant";
import type { WorldTile } from "../proton/packet";
import { hasPermission } from "../ranks";
import { deliverMailToAccount, sendSidebarHudState } from "../sidebar/service";
import { ModernDialog, type ModernPickerItem } from "../tools/modern_dialog";

export interface ActiveAuction {
  id: string;
  key: string; // "world:x,y" or "personal:<userId>"
  worldName: string;
  tileX: number;
  tileY: number;
  sellerUserId: number;
  sellerName: string;
  itemId: number;
  itemName: string;
  startingPriceWl: number;
  currentBidWl: number;
  highBidderUserId: number;
  highBidderName: string;
  startedAt: number;
  endsAt: number;
  settled: boolean;
}

const activeAuctions = new Map<string, ActiveAuction>();
let sweepInstalled = false;

export function ensureAuctionSweep(ctx: ServerContext): void {
  if (sweepInstalled) return;
  sweepInstalled = true;
  const iv = setInterval(() => {
    try {
      settleExpiredAuctions(ctx);
    } catch (_) {}
  }, 5000);
  if (typeof iv.unref === "function") iv.unref();
}

export function getActiveTileAuction(worldName: string, tx: number, ty: number): ActiveAuction | undefined {
  const key = `tile:${worldName.toUpperCase()}:${tx},${ty}`;
  const auc = activeAuctions.get(key);
  if (!auc || auc.settled) return undefined;
  return auc;
}

export function settleAuctionNow(ctx: ServerContext, auc: ActiveAuction): void {
  if (auc.settled) return;
  auc.settled = true;
  activeAuctions.delete(auc.key);

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const sellerAcct = Array.from(ctx.accounts.values()).find((a) => a.userId === auc.sellerUserId);

  if (auc.highBidderUserId > 0) {
    const winnerAcct = Array.from(ctx.accounts.values()).find((a) => a.userId === auc.highBidderUserId);
    if (winnerAcct) {
      deliverMailToAccount(ctx, winnerAcct, {
        sender: "Auction House",
        subject: "Auction Won!",
        body: `\`2${auc.itemName}\`\` bought for \`5${auc.currentBidWl} WL\`\`!`,
        iconUrl: "/branding/modern-ui/auction_sold.png",
        rewardItemId: auc.itemId,
        rewardItemCount: 1,
        expiresAt: now + thirtyDaysMs,
      });
    }
    if (sellerAcct) {
      deliverMailToAccount(ctx, sellerAcct, {
        sender: "Auction House",
        subject: "Auction Sold!",
        body: `Your \`2${auc.itemName}\`\` was bought by \`w${auc.highBidderName}\`\` for \`5${auc.currentBidWl} WL\`\`!`,
        iconUrl: "/branding/modern-ui/auction_sold.png",
        rewardItemId: 242,
        rewardItemCount: auc.currentBidWl,
        expiresAt: now + thirtyDaysMs,
      });
    }
  } else {
    // 0 bids -> Auction Failed! (Matches image-27.png word for word!)
    if (sellerAcct) {
      deliverMailToAccount(ctx, sellerAcct, {
        sender: "Auction House",
        subject: "Auction Failed!",
        body: `There were no bids for your \`2${auc.itemName}\`\` in \`w${auc.worldName || "GROWTOPIA"}\`\`.`,
        iconItemId: 1432, // Exclamation Sign (!)
        rewardItemId: auc.itemId,
        rewardItemCount: 1,
        expiresAt: now + thirtyDaysMs,
      });
    }
  }

  for (const live of liveSessions) {
    if (live.account.userId === auc.sellerUserId || live.account.userId === auc.highBidderUserId) {
      sendSidebarHudState(ctx, live);
    }
  }
}

export function settleExpiredAuctions(ctx: ServerContext, now = Date.now()): void {
  for (const auc of Array.from(activeAuctions.values())) {
    if (!auc.settled && now >= auc.endsAt) {
      settleAuctionNow(ctx, auc);
    }
  }
}

function collectAuctionableItems(ctx: ServerContext, session: PlayerSession): ModernPickerItem[] {
  const list: ModernPickerItem[] = [];
  for (const slot of session.account.inventory) {
    if (slot.count <= 0) continue;
    if (slot.itemId === 18 || slot.itemId === 32 || slot.itemId === 242) continue;
    const def = ctx.itemsDb.get(slot.itemId);
    if (!def || isIllegalItem(def) || isUntradeable(def)) continue;
    list.push({
      itemId: slot.itemId,
      count: slot.count,
      name: def.name,
    });
  }
  return list;
}

function countWorldLocks(account: PlayerSession["account"]): number {
  const slot = account.inventory.find((s) => s.itemId === 242);
  return slot ? slot.count : 0;
}

function refundBidderWls(ctx: ServerContext, userId: number, amountWl: number, itemName: string): void {
  if (!userId || amountWl <= 0) return;
  const live = Array.from(liveSessions).find((s) => s.account.userId === userId);
  if (live) {
    ctx.giveInventoryItem(live, 242, amountWl, true);
    OnConsoleMessage(
      live,
      `\`6[Auction]\`\` You were outbid on \`2${itemName}\`\`! Refunded \`w${amountWl} World Lock(s)\`\`.`
    );
    return;
  }
  const acct = Array.from(ctx.accounts.values()).find((a) => a.userId === userId);
  if (acct) {
    deliverMailToAccount(ctx, acct, {
      sender: "Auction House",
      subject: "Outbid Refund",
      body: `Someone placed a higher bid on \`2${itemName}\`\`. Your \`5${amountWl} WL\`\` bid has been refunded.`,
      iconItemId: 242,
      rewardItemId: 242,
      rewardItemCount: amountWl,
    });
  }
}

export function openAuctionSetupModal(
  ctx: ServerContext,
  session: PlayerSession,
  targetKey: string,
  worldName: string,
  tx: number,
  ty: number,
  preselectedItemId = 0,
  errorMsg = ""
): void {
  ensureAuctionSweep(ctx);
  settleExpiredAuctions(ctx);

  const pickerItems = collectAuctionableItems(ctx, session);
  const selectedDef = preselectedItemId > 0 ? ctx.itemsDb.get(preselectedItemId) : undefined;

  const dlg = new ModernDialog("modern_auction_setup", { width: 700 })
    .setTitle("Auction Block", { itemId: 15546 })
    .embedData("auc_key", targetKey)
    .embedData("world_name", worldName)
    .embedData("tx", tx)
    .embedData("ty", ty)
    .addText(
      "Sell your items through auction. Once the auction starts you will not be able to cancel the auction. When the auction ends, whatever the final bid ends up being will be the sale price so choose your starting bid carefully.",
      { size: "sm" }
    )
    .addFormRow(
      "Set Item",
      {
        kind: "item_slot",
        name: "item_id",
        itemId: selectedDef ? selectedDef.id : 0,
        itemName: selectedDef ? selectedDef.name : "",
        errorText: errorMsg || undefined,
        pickerItems,
      },
      220
    )
    .addFormRow(
      "Set Duration",
      {
        kind: "segmented",
        name: "duration",
        value: "1h",
        options: [
          { value: "1h", label: "1 Hr" },
          { value: "3h", label: "3 Hr" },
          { value: "12h", label: "12 Hr" },
          { value: "2m", label: "2m" },
        ],
      },
      220
    )
    .addFormRow(
      "Set Start Price (WL)",
      {
        kind: "input",
        name: "start_price",
        value: "",
        maxLen: 7,
        numeric: true,
        widthDp: 220,
        trailingItemId: 242,
      },
      220
    )
    .addIncompleteHint(
      "You need to fill all the above sections before you can begin this auction.",
      ["item_id", "start_price"]
    )
    .addSpacer("sm")
    .addButtonRow(
      [
        {
          id: "start_auction",
          label: "Start Auction",
          color: "green",
          variant: "flat",
          requireFields: ["item_id", "start_price"],
        },
      ],
      { justify: "center" }
    );

  OnModernDialogRequest(session, dlg);
}

export function openAuctionBidModal(
  ctx: ServerContext,
  session: PlayerSession,
  auc: ActiveAuction
): void {
  ensureAuctionSweep(ctx);
  settleExpiredAuctions(ctx);
  if (auc.settled) {
    OnConsoleMessage(session, "`6[Auction]`` That auction has ended! Check your `wMailbox`` for results.");
    return;
  }

  const isHighest = auc.highBidderUserId === session.account.userId;
  const isOwner = auc.sellerUserId === session.account.userId;
  const availWl = countWorldLocks(session.account);
  const alreadyEscrowed = isHighest ? auc.currentBidWl : 0;
  const basePrice = auc.highBidderUserId > 0 ? auc.currentBidWl : auc.startingPriceWl;
  const remainingSec = Math.max(0, Math.ceil((auc.endsAt - Date.now()) / 1000));

  const bidIncrements = [1, 5, 10];
  const bidButtons = bidIncrements.map((inc) => {
    const newTotal = auc.highBidderUserId > 0 ? basePrice + inc : Math.max(auc.startingPriceWl, inc === 1 ? auc.startingPriceWl : auc.startingPriceWl + inc);
    const neededFromInv = newTotal - alreadyEscrowed;
    const canAfford = availWl >= neededFromInv;
    return {
      id: `bid_${inc}`,
      label: `+${inc}`,
      color: "green" as const,
      size: "sm" as const,
      disabled: isOwner || !canAfford || remainingSec <= 0,
    };
  });

  const currentBidLines: string[] = [];
  if (isHighest) {
    currentBidLines.push("`2You are the highest bidder``");
    currentBidLines.push(`\`w${auc.currentBidWl} WL\`\``);
  } else if (auc.highBidderUserId > 0) {
    currentBidLines.push(`\`oHighest Bidder: \`w${auc.highBidderName}\`\``);
    currentBidLines.push(`\`w${auc.currentBidWl} WL\`\``);
  } else {
    if (isOwner) currentBidLines.push("`oNo bids placed yet``");
    currentBidLines.push(`\`w${auc.startingPriceWl} WL\`\``);
  }

  const dlg = new ModernDialog("modern_auction_bid", { width: 700 })
    .setTitle("Auction Block", { itemId: 15546 })
    .embedData("auc_key", auc.key)
    .addText(
      "Buy items through this auction block.\n\nPlace your bids but remember, the final bid when the auction ends will be the sale price so choose your bid carefully. Once placed you can't withdraw your bid until the auction ends.",
      { size: "sm" }
    )
    .addFormRow(
      "Item",
      {
        kind: "item_slot",
        name: "view_item",
        itemId: auc.itemId,
        itemName: auc.itemName,
      },
      165
    )
    .addFormRow(
      "Current Bid",
      {
        kind: "value",
        lines: currentBidLines,
      },
      165
    )
    .addFormRow(
      "Place Bid",
      {
        kind: "bid_group",
        buttons: bidButtons,
        noteText: isOwner ? "You cannot bid on your own auction." : undefined,
        expiresInSec: remainingSec,
      },
      165
    );

  // Allow owner or staff to test immediate settlement in local dev / demo
  if (isOwner || hasPermission(session.account, "debug")) {
    dlg.addSpacer("sm").addButtonRow(
      [
        {
          id: "settle_demo_now",
          label: "Finish Auction Now (Test Mailbox)",
          color: "default",
          size: "sm",
        },
      ],
      { justify: "end" }
    );
  }

  OnModernDialogRequest(session, dlg);
}

export function openAuctionBlockDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  ensureAuctionSweep(ctx);
  settleExpiredAuctions(ctx);
  const key = `tile:${world.name.toUpperCase()}:${tx},${ty}`;
  const existing = activeAuctions.get(key);
  if (existing && !existing.settled) {
    openAuctionBidModal(ctx, session, existing);
    return;
  }

  // Only world lock owner or builder can set up a world tile Auction Block
  const worldOwnerId = world.ownerUserId || 0;
  if (worldOwnerId > 0 && worldOwnerId !== session.account.userId && !hasPermission(session.account, "moderate")) {
    const dlg = new ModernDialog("modern_auction_readonly", { width: 640 })
      .setTitle("Auction Block", { itemId: tile.fg || 15546 })
      .addCallout("There is no active auction on this Auction Block right now.", "info");
    OnModernDialogRequest(session, dlg);
    return;
  }

  openAuctionSetupModal(ctx, session, key, world.name, tx, ty);
}

export function openModernDialogPlayground(ctx: ServerContext, session: PlayerSession): void {
  const pickerItems = collectAuctionableItems(ctx, session);
  const dlg = new ModernDialog("modern_ui_playground", { width: 780 })
    .setTitle("Modern Dialog Playground", { itemId: 242 })
    .addText(
      "Ini adalah contoh engine `2OnModernDialogRequest`` (`wModernDialog``) yang bisa dipakai di `5mana saja``: Sidebar, Wrench Block, Slash Command, NPC, Shop, atau Quest!"
    )
    .addAccordion(
      "Cara Pakai di Server (Klik untuk lihat contoh kode)",
      "Cukup panggil `wOnModernDialogRequest(session, new ModernDialog('nama_dialog')...)`` di file server mana pun, lalu tangkap hasilnya di `wserver/action/dialog_return/`` sama persis seperti `OnDialogRequest` biasa!",
      { variant: "teal", defaultOpen: false }
    )
    .beginSection({ tone: "teal" })
    .addFormRow("Pilih Item", {
      kind: "item_slot",
      name: "demo_item",
      itemId: 242,
      itemName: ctx.itemsDb.get(242)?.name || "World Lock",
      pickerItems,
    })
    .addFormRow("Pilih Mode", {
      kind: "segmented",
      name: "demo_mode",
      value: "fast",
      options: [
        { value: "fast", label: "Fast" },
        { value: "normal", label: "Normal" },
        { value: "pro", label: "Pro" },
      ],
    })
    .addFormRow("Pesan Custom", {
      kind: "input",
      name: "demo_msg",
      value: "Halo dari Modern Dialog!",
      maxLen: 60,
    })
    .endSection()
    .addButtonRow(
      [
        { id: "open_dungeons", label: "Test Dungeons UI", color: "purple", iconUrl: "/branding/modern-ui/dungeon_scroll.png" },
        { id: "open_mailbox", label: "Test Mailbox UI", color: "default", iconItemId: 660 },
        { id: "open_auction", label: "Test Auction UI", color: "green", iconItemId: 15546 },
        { id: "submit_demo", label: "Kirim Input", color: "lightblue" },
      ],
      { justify: "between" }
    );

  OnModernDialogRequest(session, dlg);
}

export function handleAuctionDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): boolean {
  const dlgName = kv.dialog_name || "";
  const btn = kv.buttonClicked || "";

  if (dlgName === "modern_auction_setup") {
    if (btn !== "start_auction") return true;
    const key = kv.auc_key || `personal:${session.account.userId}`;
    const worldName = kv.world_name || session.world?.name || "START";
    const tx = parseInt(kv.tx || "0", 10) || 0;
    const ty = parseInt(kv.ty || "0", 10) || 0;
    const itemId = parseInt(kv.item_id || "0", 10) || 0;
    const startPrice = Math.max(0, Math.floor(Number(kv.start_price || "0") || 0));
    const durCode = kv.duration || "1h";

    if (activeAuctions.has(key) && !activeAuctions.get(key)!.settled) {
      OnConsoleMessage(session, "`4An auction is already active on this block!``");
      return true;
    }
    if (itemId <= 0 || startPrice <= 0) {
      openAuctionSetupModal(ctx, session, key, worldName, tx, ty, itemId, "Select an item and a valid WL price.");
      return true;
    }
    const def = ctx.itemsDb.get(itemId);
    if (!def || itemId === 18 || itemId === 32 || itemId === 242 || isIllegalItem(def) || isUntradeable(def)) {
      openAuctionSetupModal(ctx, session, key, worldName, tx, ty, 0, "This item cannot be auctioned.");
      return true;
    }
    if (!ctx.consumeInventoryItem(session, itemId, 1, true)) {
      openAuctionSetupModal(ctx, session, key, worldName, tx, ty, 0, "You don't have that item in your inventory.");
      return true;
    }

    const durationMs =
      durCode === "2m"
        ? 2 * 60 * 1000
        : durCode === "3h"
        ? 3 * 3600 * 1000
        : durCode === "12h"
        ? 12 * 3600 * 1000
        : 3600 * 1000;

    const now = Date.now();
    const auc: ActiveAuction = {
      id: `auc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      key,
      worldName,
      tileX: tx,
      tileY: ty,
      sellerUserId: session.account.userId,
      sellerName: session.account.name,
      itemId,
      itemName: def.name,
      startingPriceWl: startPrice,
      currentBidWl: startPrice,
      highBidderUserId: 0,
      highBidderName: "",
      startedAt: now,
      endsAt: now + durationMs,
      settled: false,
    };
    activeAuctions.set(key, auc);
    ctx.dirty = true;
    ctx.savePlayersNow();

    OnPlayPositioned(session, "audio/use_lock.wav", 0);
    OnConsoleMessage(
      session,
      `\`2[Auction]\`\` Started auction for \`w${def.name}\`\` at \`$${startPrice} WL\`\` (${durCode.toUpperCase()})!`
    );
    if (session.world) {
      OnTalkBubble(session, session.netId, `\`2Auction started: \`w${def.name}\`\` (${startPrice} WL)!\`\``, 0, true);
    }
    openAuctionBidModal(ctx, session, auc);
    return true;
  }

  if (dlgName === "modern_auction_bid") {
    const key = kv.auc_key || "";
    const auc = activeAuctions.get(key);
    if (!auc || auc.settled) {
      OnConsoleMessage(session, "`6[Auction]`` This auction has already ended.");
      return true;
    }

    if (btn === "settle_demo_now") {
      if (auc.sellerUserId === session.account.userId || hasPermission(session.account, "debug")) {
        settleAuctionNow(ctx, auc);
        OnPlayPositioned(session, "audio/cash_register.wav", 0);
        OnConsoleMessage(session, "`2[Auction]`` Auction finished! Open your `wMailbox`` to view the result card.");
      }
      return true;
    }

    if (btn.startsWith("bid_")) {
      settleExpiredAuctions(ctx);
      if (auc.settled) return true;
      if (auc.sellerUserId === session.account.userId) {
        OnConsoleMessage(session, "`4You cannot bid on your own auction!``");
        return true;
      }

      const inc = parseInt(btn.slice(4), 10) || 0;
      if (inc <= 0) return true;

      const isAlreadyHigh = auc.highBidderUserId === session.account.userId;
      const prevEscrow = isAlreadyHigh ? auc.currentBidWl : 0;
      const nextBid =
        auc.highBidderUserId > 0
          ? auc.currentBidWl + inc
          : inc === 1
          ? auc.startingPriceWl
          : auc.startingPriceWl + inc;
      const deltaWl = nextBid - prevEscrow;

      if (deltaWl <= 0 || !ctx.consumeInventoryItem(session, 242, deltaWl, true)) {
        OnConsoleMessage(session, `\`4You need ${deltaWl} more World Lock(s) to place that bid!\`\``);
        openAuctionBidModal(ctx, session, auc);
        return true;
      }

      if (!isAlreadyHigh && auc.highBidderUserId > 0) {
        refundBidderWls(ctx, auc.highBidderUserId, auc.currentBidWl, auc.itemName);
      }

      auc.currentBidWl = nextBid;
      auc.highBidderUserId = session.account.userId;
      auc.highBidderName = session.account.name;
      // Anti-snipe: if < 15s left, extend to 15s
      if (auc.endsAt - Date.now() < 15000) {
        auc.endsAt = Date.now() + 15000;
      }
      ctx.dirty = true;
      ctx.savePlayersNow();

      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(
        session,
        `\`2[Auction]\`\` You are now the highest bidder on \`w${auc.itemName}\`\` at \`$${nextBid} WL\`\`!`
      );
      openAuctionBidModal(ctx, session, auc);
      return true;
    }
    return true;
  }

  return false;
}

export function handleAuctionCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[]
): boolean {
  if (cmd === "auction") {
    ensureAuctionSweep(ctx);
    settleExpiredAuctions(ctx);
    const sub = (parts[1] || "").toLowerCase();

    // `/auction list` or `/auction bid`: join any active auction on the server!
    if (sub === "bid" || sub === "live") {
      const firstLive = Array.from(activeAuctions.values()).find((a) => !a.settled);
      if (!firstLive) {
        OnConsoleMessage(session, "`6[Auction]`` No active auctions right now. Starting setup dialog...");
      } else {
        openAuctionBidModal(ctx, session, firstLive);
        return true;
      }
    }

    // Check if player already has a personal demo auction running
    const pKey = `personal:${session.account.userId}`;
    const ownLive = activeAuctions.get(pKey);
    if (ownLive && !ownLive.settled) {
      openAuctionBidModal(ctx, session, ownLive);
      return true;
    }
    openAuctionSetupModal(ctx, session, pKey, session.world?.name || "START", 0, 0);
    return true;
  }

  if (cmd === "modui" || cmd === "moderndialog") {
    openModernDialogPlayground(ctx, session);
    return true;
  }

  return false;
}
