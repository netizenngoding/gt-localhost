/**
 * Vending Machine (2978) & DigiVend (9268) Logic
 * Directly reverse engineered from LyNnz01/GTPS3/SERVER/World.h (lines 10474, 10486, 13190-13760)
 */

import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import type { WorldInstance } from "../../database/world";
import { canManageVending, logCctvEvent } from "../../database/world";
import {
  buildTankPacket,
  makeParticleEffectPacket,
  makeTileUpdatePacket,
  PACKET_ITEM_EFFECT,
  type WorldTile,
} from "../../proton/packet";
import {
  broadcastConsoleMessage,
  broadcastPositionedSfx,
  OnConsoleMessage,
  OnDialogRequest,
  OnPlayPositioned,
  OnSetBux,
  OnTalkBubble,
} from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";

export function getPlayerWls(session: PlayerSession): number {
  let total = 0;
  for (const s of session.account.inventory) {
    if (s.itemId === 242) total += s.count;
    if (s.itemId === 1796) total += s.count * 100;
    if (s.itemId === 7188) total += s.count * 10000;
  }
  return total;
}

function freeCapacityForItem(session: PlayerSession, itemId: number, extraUsedSlots = 0): number {
  let cap = 0;
  for (const s of session.account.inventory) {
    if (s.itemId === itemId && s.count > 0 && s.count < 200) {
      cap += 200 - s.count;
    }
  }
  const usedSlots = session.account.inventory.filter((s) => s.count > 0).length + extraUsedSlots;
  const emptySlots = Math.max(0, session.account.backpackSize - usedSlots);
  return cap + emptySlots * 200;
}

export function deductPlayerWls(
  ctx: ServerContext,
  session: PlayerSession,
  costWls: number
): boolean {
  if (costWls <= 0 || getPlayerWls(session) < costWls) return false;

  // Plan the exact WL -> DL -> BGL breakdown before mutating inventory so we never over-break or drop change!
  const wlHave = session.account.inventory.find((s) => s.itemId === 242 && s.count > 0)?.count || 0;
  const dlHave = session.account.inventory.find((s) => s.itemId === 1796 && s.count > 0)?.count || 0;
  const bglHave = session.account.inventory.find((s) => s.itemId === 7188 && s.count > 0)?.count || 0;

  let rem = costWls;
  const spendWl = Math.min(wlHave, rem);
  rem -= spendWl;

  let spendDl = 0;
  let changeWl = 0;
  if (rem > 0) {
    const needDl = Math.min(dlHave, Math.ceil(rem / 100));
    spendDl = needDl;
    const paidFromDl = needDl * 100;
    if (paidFromDl >= rem) {
      changeWl = paidFromDl - rem;
      rem = 0;
    } else {
      rem -= paidFromDl;
    }
  }

  let spendBgl = 0;
  let changeDl = 0;
  if (rem > 0) {
    const needBgl = Math.min(bglHave, Math.ceil(rem / 10000));
    if (needBgl * 10000 < rem) return false;
    spendBgl = needBgl;
    const leftover = needBgl * 10000 - rem;
    changeDl = Math.floor(leftover / 100);
    changeWl += leftover % 100;
    rem = 0;
  }

  // Verify backpack room for change after accounting for freed WL/DL/BGL slots
  const freedSlots =
    (spendWl > 0 && spendWl === wlHave ? 1 : 0) +
    (spendDl > 0 && spendDl === dlHave ? 1 : 0) +
    (spendBgl > 0 && spendBgl === bglHave ? 1 : 0);
  if (changeDl > 0) {
    const dlFreeAfter = (spendDl > 0 ? spendDl : 0) + freeCapacityForItem(session, 1796, -freedSlots);
    if (dlFreeAfter < changeDl) return false;
  }
  if (changeWl > 0) {
    const usedNewForDl = changeDl > 0 && dlHave === 0 ? 1 : 0;
    const wlFreeAfter = (spendWl > 0 ? spendWl : 0) + freeCapacityForItem(session, 242, -freedSlots + usedNewForDl);
    if (wlFreeAfter < changeWl) return false;
  }

  if (spendWl > 0) ctx.consumeInventoryItem(session, 242, spendWl, true);
  if (spendDl > 0) ctx.consumeInventoryItem(session, 1796, spendDl, true);
  if (spendBgl > 0) ctx.consumeInventoryItem(session, 7188, spendBgl, true);
  if (changeDl > 0) ctx.giveInventoryItem(session, 1796, changeDl, true);
  if (changeWl > 0) ctx.giveInventoryItem(session, 242, changeWl, true);

  ctx.savePlayersNow();
  return true;
}

export function openVendingOwnerDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  session.pendingEditTile = { x: tx, y: ty };
  const extra = tile.extra?.kind === "vending" ? tile.extra : { itemId: 0, price: 0, count: 0, wl: 0 };
  const machineDef = ctx.itemsDb.get(tile.fg) || { name: "Vending Machine" };
  const maxCapacity = tile.fg === 2978 ? 5199 : 9999;
  const itemDef = extra.itemId ? ctx.itemsDb.get(extra.itemId) : null;
  const itemName = itemDef ? stripGtColors(itemDef.name) : "";

  let backpackCount = 0;
  if (extra.itemId) {
    backpackCount = session.account.inventory.find((s) => s.itemId === extra.itemId)?.count || 0;
  }

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${stripGtColors(machineDef.name)}\`\``, tile.fg)
    .addSpacer("small")
    .embedData("tilex", tx)
    .embedData("tiley", ty);

  if (extra.itemId === 0) {
    dlg.addTextbox("This machine is empty.");
    dlg.addItemPicker("stockitem", "`wPut an item in``", "Choose an item to put in the machine!");
  } else {
    dlg.addLabelWithIcon("small", `The machine contains a total of ${extra.count} \`2${itemName}\`\`.`, extra.itemId);
    if (extra.price === 0) {
      dlg.addSpacer("small");
      dlg.addTextbox("Not currently for sale!");
      if (backpackCount > 0 && extra.count < maxCapacity) {
        dlg.addSmalltext(`You have ${backpackCount} ${itemName} in your backpack.`);
        dlg.addButton("addstocks", "Add them to the machine");
      }
      dlg.addButton("pullstocks", "Empty the machine");
    } else {
      dlg.addSpacer("small");
      dlg.addTextbox("For a cost of:");
      dlg.addLabelWithIcon("small", `${extra.price < 0 ? 1 : extra.price} x \`8World Lock\`\``, 242);
      dlg.addSpacer("small");
      dlg.addTextbox("You will get:");
      dlg.addLabelWithIcon("small", `${extra.price < 0 ? Math.abs(extra.price) : 1} x \`2${itemName}\`\``, extra.itemId);
      dlg.addSpacer("small");
      if (backpackCount > 0 && extra.count < maxCapacity) {
        dlg.addSmalltext(`You have ${backpackCount} ${itemName} in your backpack.`);
        dlg.addButton("addstocks", "Add them to the machine");
      }
      dlg.addButton("pullstocks", "Empty the machine");
    }

    if (extra.price < 0 && Math.abs(extra.price) > extra.count) {
      dlg.addSmalltext("`4(You need to add more items or people can't purchase at this price!)``");
    }
    dlg.addSmalltext(`\`5(${stripGtColors(machineDef.name)} will not function when price is set to 0)\`\``);
    dlg.addTextInput("setprice", "Price", String(Math.abs(extra.price)), 5);
    dlg.addCheckbox("chk_peritem", "World Locks per Item", extra.price >= 0);
    dlg.addCheckbox("chk_perlock", "Items per World Lock", extra.price < 0);
  }

  if (extra.wl > 0) {
    dlg.addSmalltext(`You have earned ${extra.wl} World Locks.`);
    dlg.addButton("withdraw", "Withdraw World Locks");
  }

  if (tile.fg === 2978) {
    dlg.addSmalltext("Upgrade to a DigiVend Machine for `44,000 Gems``.");
    dlg.addButton("upgradedigital", "Upgrade to DigiVend");
  }

  dlg.addSpacer("small");
  const dlgStr = dlg.endDialog("vending", "Close", extra.itemId !== 0 ? "Update" : "");
  OnDialogRequest(session, dlgStr);
}

export function openVendingBuyerDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  session.pendingEditTile = { x: tx, y: ty };
  const extra = tile.extra?.kind === "vending" ? tile.extra : { itemId: 0, price: 0, count: 0, wl: 0 };
  const machineDef = ctx.itemsDb.get(tile.fg) || { name: "Vending Machine" };
  const itemDef = extra.itemId ? ctx.itemsDb.get(extra.itemId) : null;
  const itemName = itemDef ? stripGtColors(itemDef.name) : "";

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${stripGtColors(machineDef.name)}\`\``, tile.fg)
    .addSpacer("small")
    .embedData("tilex", tx)
    .embedData("tiley", ty);

  if (extra.itemId === 0 || extra.price === 0) {
    dlg.addTextbox("This machine is out of order.");
    const dlgStr = dlg.endDialog("vending", "Close", "");
    OnDialogRequest(session, dlgStr);
    return;
  }

  dlg.addLabelWithIcon("small", `The machine contains a total of ${extra.count} \`2${itemName}\`\`.`, extra.itemId);
  dlg.addSpacer("small");
  dlg.addTextbox("For a cost of:");
  dlg.addLabelWithIcon("small", `${extra.price < 0 ? 1 : extra.price} x \`8World Lock\`\``, 242);
  dlg.addSpacer("small");
  dlg.addTextbox("You will get:");
  dlg.addLabelWithIcon("small", `${extra.price < 0 ? Math.abs(extra.price) : 1} x \`2${itemName}\`\``, extra.itemId);
  dlg.addSpacer("small");

  if (extra.price < 0 && Math.abs(extra.price) > extra.count) {
    dlg.addTextbox("You'll need to wait for the owner to stock up to at least 1 World Lock's worth before you can buy.");
    const dlgStr = dlg.endDialog("vending", "Close", "");
    OnDialogRequest(session, dlgStr);
    return;
  }

  const myWls = getPlayerWls(session);
  dlg.addTextbox(`You have ${myWls} World Locks.`);
  dlg.addTextInput("buycount", "How many would you like to buy?", "0", 3);
  dlg.embedData("expectprice", extra.price);
  dlg.embedData("expectitem", extra.itemId);
  const buyerDlgStr = dlg.endDialog("vending", "Close", "Buy");
  OnDialogRequest(session, buyerDlgStr);
}

export function handleVendingDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): boolean {
  const world = session.world;
  if (!world) return false;
  const tx = parseInt(kv.tilex || "0", 10);
  const ty = parseInt(kv.tiley || "0", 10);
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return false;

  const tile = world.tiles[ty * world.width + tx];
  if (!tile || (tile.fg !== 2978 && tile.fg !== 9268)) return false;

  if (!tile.extra || tile.extra.kind !== "vending") {
    tile.extra = { kind: "vending", itemId: 0, price: 0, count: 0, wl: 0 };
  }
  const extra = tile.extra;
  const isOwner = canManageVending(session, world, tile);
  const btn = kv.buttonClicked || "";

  // 1. Owner Actions
  if (isOwner) {
    // Put item in machine from picker
    if (kv.stockitem && extra.itemId === 0) {
      const selectedId = parseInt(kv.stockitem, 10);
      const selectedDef = ctx.itemsDb.get(selectedId);
      const slot = session.account.inventory.find((s) => s.itemId === selectedId);
      if (slot && slot.count > 0) {
        if (
          !selectedDef ||
          selectedDef.isLock ||
          selectedId === 242 ||
          selectedId === 1796 ||
          selectedId === 7188 ||
          selectedId === 1424 ||
          selectedId === 5816 ||
          selectedDef.actionType === 64 ||
          (selectedDef.flags & 0x0080) !== 0
        ) {
          const rejectMsg = (selectedDef?.isLock || selectedId === 1424 || selectedId === 5816)
            ? "No no no."
            : `Can't put that in a ${stripGtColors(ctx.itemsDb.get(tile.fg)?.name || "Vending Machine")}.`;
          OnTalkBubble(session, session.netId, rejectMsg, 0, true);
          OnConsoleMessage(session, rejectMsg);
          return true;
        }
        const maxCapacity = tile.fg === 2978 ? 5199 : 9999;
        const putCount = Math.min(slot.count, maxCapacity);
        extra.itemId = selectedId;
        extra.count = putCount;
        ctx.consumeInventoryItem(session, selectedId, putCount, true);
        ctx.dirty = true;
        const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        const effectPkt = buildTankPacket({
          type: PACKET_ITEM_EFFECT,
          netId: session.netId,
          x: tx * 32 + 16,
          y: ty * 32 + 16,
          punchX: extra.itemId,
          punchY: session.netId,
          value: 100,
        });
        for (const p of world.peers) p.peer.sendPacket(0, effectPkt, true);
        broadcastPositionedSfx(world, session.netId, "audio/cash_register.wav");
        openVendingOwnerDialog(ctx, session, world, tile, tx, ty);
        return true;
      }
    }

    // Add stocks from inventory
    if (btn === "addstocks") {
      if (extra.itemId) {
        const slot = session.account.inventory.find((s) => s.itemId === extra.itemId);
        if (slot && slot.count > 0) {
          const maxCapacity = tile.fg === 2978 ? 5199 : 9999;
          const addable = Math.min(slot.count, maxCapacity - extra.count);
          if (addable > 0) {
            extra.count += addable;
            ctx.consumeInventoryItem(session, extra.itemId, addable, true);
            ctx.dirty = true;
            const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
            for (const p of world.peers) p.peer.sendPacket(0, upd, true);
            const effectPkt = buildTankPacket({
              type: PACKET_ITEM_EFFECT,
              netId: session.netId,
              x: tx * 32 + 16,
              y: ty * 32 + 16,
              punchX: extra.itemId,
              punchY: session.netId,
              value: 100,
            });
            for (const p of world.peers) p.peer.sendPacket(0, effectPkt, true);
            broadcastPositionedSfx(world, session.netId, "audio/cash_register.wav");
            OnTalkBubble(session, session.netId, `Added ${addable} items to the machine.`, 0, true);
            OnConsoleMessage(session, `Added ${addable} items to the machine.`);
          }
        }
      }
      return true;
    }

    // Pull stocks (empty machine, partial stack aware per GTPS3 World.h:13370)
    if (btn === "pullstocks") {
      if (extra.itemId && extra.count > 0) {
        const invSlot = session.account.inventory.find((s) => s.itemId === extra.itemId && s.count > 0);
        const haveInInv = invSlot?.count || 0;
        const canFitInSlot = invSlot ? Math.max(0, 200 - haveInInv) : (freeCapacityForItem(session, extra.itemId) >= 1 || session.account.inventory.length < session.account.backpackSize ? 200 : 0);
        const take = Math.min(canFitInSlot, extra.count);
        if (take > 0 && ctx.giveInventoryItem(session, extra.itemId, take, true) > 0) {
          const itemName = stripGtColors(ctx.itemsDb.get(extra.itemId)?.name || "Items");
          extra.count -= take;
          if (extra.count <= 0) {
            extra.itemId = 0;
            extra.price = 0;
          }
          ctx.dirty = true;
          const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
          for (const p of world.peers) p.peer.sendPacket(0, upd, true);
          const msg = `You took ${take} ${itemName} from the machine.`;
          OnTalkBubble(session, session.netId, msg, 0, true);
          OnConsoleMessage(session, msg);
        } else {
          OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
          OnConsoleMessage(session, "You don't have room in your backpack!");
        }
      }
      return true;
    }

    // Withdraw World Locks (WL-first, otherwise DLs + remainder WLs per GTPS3 World.h:13420)
    if (btn === "withdraw") {
      if (extra.wl > 0) {
        const wlSlot = session.account.inventory.find((s) => s.itemId === 242 && s.count > 0);
        const wlSpace = freeCapacityForItem(session, 242);
        let collected = 0;
        let msg = "";

        if (extra.wl < 100 && wlSpace >= extra.wl) {
          collected = extra.wl;
          extra.wl = 0;
          ctx.giveInventoryItem(session, 242, collected, true);
          msg = `You collected ${collected} World Locks.`;
        } else if (extra.wl < 100 && wlSpace > 0 && wlSlot) {
          collected = Math.min(extra.wl, wlSpace);
          extra.wl -= collected;
          ctx.giveInventoryItem(session, 242, collected, true);
          msg = `You collected ${collected} World Locks.`;
        } else {
          const dls = Math.floor(extra.wl / 100);
          const wls = extra.wl % 100;
          const dlHave = session.account.inventory.find((s) => s.itemId === 1796 && s.count > 0)?.count || 0;
          if (dls > 0 && freeCapacityForItem(session, 1796) < dls) {
            OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
            OnConsoleMessage(session, "You don't have room in your backpack!");
            return true;
          }
          const needNewDlSlot = dls > 0 && dlHave === 0 ? 1 : 0;
          if (wls > 0 && freeCapacityForItem(session, 242, needNewDlSlot) < wls) {
            OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
            OnConsoleMessage(session, "You don't have room in your backpack!");
            return true;
          }
          collected = extra.wl;
          extra.wl = 0;
          if (dls > 0) ctx.giveInventoryItem(session, 1796, dls, true);
          if (wls > 0) ctx.giveInventoryItem(session, 242, wls, true);
          msg = dls > 0 && wls > 0
            ? `You collected ${dls} Diamond Locks and ${wls} World Locks.`
            : dls > 0
            ? `You collected ${dls} Diamond Locks.`
            : `You collected ${wls} World Locks.`;
        }

        ctx.dirty = true;
        const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        OnTalkBubble(session, session.netId, msg, 0, true);
        OnConsoleMessage(session, msg);
      }
      return true;
    }

    // Upgrade to DigiVend
    if (btn === "upgradedigital" && tile.fg === 2978) {
      if ((session.account.gems || 0) >= 4000) {
        session.account.gems -= 4000;
        ctx.savePlayersNow();
        OnSetBux(session);
        tile.fg = 9268; // DigiVend
        ctx.dirty = true;
        const fxPkt = makeParticleEffectPacket(44, tx * 32 + 16, ty * 32 + 16);
        const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
        for (const p of world.peers) {
          p.peer.sendPacket(0, fxPkt, true);
          p.peer.sendPacket(0, upd, true);
        }
        OnTalkBubble(session, session.netId, "Machine upgraded to DigiVend!", 0, true);
      } else {
        OnTalkBubble(session, session.netId, "You don't have enough gems!.", 0, true);
      }
      return true;
    }

    // Update Price / Mode
    if (kv.setprice !== undefined) {
      if (kv.chk_peritem === "1" && kv.chk_perlock === "1") {
        OnTalkBubble(session, session.netId, "You can't have it both ways.", 0, true);
        OnConsoleMessage(session, "You can't have it both ways.");
        return true;
      }
      const rawStr = (kv.setprice || "0").trim();
      const priceVal = parseInt(rawStr, 10);
      if (!Number.isFinite(priceVal) || priceVal < 0 || priceVal > 20000 || (!/^\d+$/.test(rawStr) && rawStr !== "")) {
        OnTalkBubble(session, session.netId, "Well, that's a silly price.", 0, true);
        return true;
      }
      const perLock = kv.chk_perlock === "1";
      if (perLock && priceVal > 0) {
        if (priceVal > extra.count) {
          OnTalkBubble(session, session.netId, "You don't have enough in there for anyone to buy at that price!", 0, true);
          OnConsoleMessage(session, "You don't have enough in there for anyone to buy at that price!");
          return true;
        }
        if (priceVal > 200) {
          OnTalkBubble(session, session.netId, "That price is so low, nobody can carry a World Lock worth of items!", 0, true);
          OnConsoleMessage(session, "That price is so low, nobody can carry a World Lock worth of items!");
          return true;
        }
      }
      extra.price = perLock && priceVal > 0 ? -priceVal : priceVal;
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      const particle = makeParticleEffectPacket(44, tx * 32 + 16, ty * 32 + 16);
      for (const p of world.peers) p.peer.sendPacket(0, particle, true);
      broadcastPositionedSfx(world, session.netId, "audio/terraform.wav");
      const itemName = stripGtColors(ctx.itemsDb.get(extra.itemId)?.name || "Item");
      const msg = extra.price === 0
        ? `\`7[\`\`${session.account.name} disabled the Vending Machine.\`\`\`7]\`\``
        : extra.price < 0
        ? `\`7[\`\`${session.account.name} changed the price of \`2${itemName}\`\` to \`6${Math.abs(extra.price)} per World Lock.\`\`\`7]\`\``
        : `\`7[\`\`${session.account.name} changed the price of \`2${itemName}\`\` to \`5${extra.price} World Locks each.\`\`\`7]\`\``;
      OnTalkBubble(session, session.netId, msg, 0, false);
      broadcastConsoleMessage(world, msg);
      return true;
    }
  }

  // 2. Buyer Actions
  const expectPrice = parseInt(kv.expectprice || "0", 10);
  const expectItem = parseInt(kv.expectitem || "0", 10);
  const buyCount = parseInt(kv.buycount || "0", 10);

  if (expectPrice !== extra.price || expectItem !== extra.itemId) {
    OnConsoleMessage(session, "`4Vending price or stock changed!``");
    return true;
  }
  if (Math.abs(tx * 32 - session.x) > 24 || Math.abs(ty * 32 - session.y) > 24) {
    OnTalkBubble(session, session.netId, "Get closer!", 0, false);
    return true;
  }
  if (!Number.isFinite(buyCount)) return true;
  if (buyCount < 0) {
    OnTalkBubble(session, session.netId, "NEGATIVE, DOES NOT COMPUTE", 0, false);
    return true;
  }
  if (buyCount === 0) return true;

  const isPerLock = extra.price < 0;
  const itemsPerLock = Math.abs(extra.price);
  if (isPerLock && buyCount < itemsPerLock) {
    OnTalkBubble(session, session.netId, "You have to buy at least 1 World Lock's worth.", 0, true);
    OnConsoleMessage(session, "You have to buy at least 1 World Lock's worth.");
    return true;
  }
  const totalCostWls = isPerLock ? Math.floor(buyCount / itemsPerLock) : buyCount * extra.price;
  const actualItems = isPerLock ? totalCostWls * itemsPerLock : buyCount;

  if (actualItems <= 0 || actualItems > extra.count) {
    OnTalkBubble(session, session.netId, "There aren't enough available to fulfill your order!", 0, true);
    OnConsoleMessage(session, "There aren't enough available to fulfill your order!");
    return true;
  }

  // Show Purchase Confirmation if verify is not set
  if (kv.verify !== "1") {
    const itemDef = ctx.itemsDb.get(extra.itemId);
    const itemName = itemDef ? stripGtColors(itemDef.name) : "Item";
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wPurchase Confirmation``", 1366)
      .addSpacer("small")
      .embedData("tilex", tx)
      .embedData("tiley", ty)
      .addSpacer("small")
      .addTextbox("`4You'll give:``")
      .addSpacer("small")
      .addLabelWithIcon("small", `(\`w${totalCostWls}\`\`) \`8World Locks\`\``, 242)
      .addSpacer("small")
      .addTextbox("`2You'll get:``")
      .addSpacer("small")
      .addLabelWithIcon("small", `(\`w${actualItems}\`\`) \`2${itemName}\`\``, extra.itemId)
      .addSpacer("small")
      .addTextbox("Are you sure you want to make this purchase?")
      .embedData("verify", "1")
      .embedData("buycount", buyCount)
      .embedData("expectprice", extra.price)
      .embedData("expectitem", extra.itemId)
      .endDialog("vending", "Cancel", "OK");
    OnDialogRequest(session, dlg);
    return true;
  }

  // Execute Purchase (verify room in backpack BEFORE deducting World Locks!)
  if (getPlayerWls(session) < totalCostWls) {
    OnTalkBubble(session, session.netId, "You can't afford that many!", 0, true);
    OnConsoleMessage(session, "You can't afford that many!");
    return true;
  }

  if (freeCapacityForItem(session, extra.itemId) < actualItems) {
    OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
    OnConsoleMessage(session, "You don't have room in your backpack!");
    return true;
  }

  if (!deductPlayerWls(ctx, session, totalCostWls)) {
    OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
    OnConsoleMessage(session, "`4Transaction failed (check backpack space for change).``");
    return true;
  }

  ctx.giveInventoryItem(session, extra.itemId, actualItems, true);
  extra.count -= actualItems;
  extra.wl += totalCostWls;
  if (extra.count <= 0) {
    extra.itemId = 0;
    extra.price = 0;
  }
  ctx.dirty = true;

  // Broadcast animation and SFX
  const itemDef = ctx.itemsDb.get(expectItem);
  const itemName = itemDef ? stripGtColors(itemDef.name) : "Item";
  broadcastPositionedSfx(world, session.netId, "audio/cash_register.wav");
  const effectPkt = buildTankPacket({
    type: PACKET_ITEM_EFFECT,
    netId: session.netId,
    x: tx * 32 + 16,
    y: ty * 32 + 16,
    punchX: expectItem,
    punchY: session.netId,
    value: 100,
  });
  for (const p of world.peers) p.peer.sendPacket(0, effectPkt, true);
  const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, upd, true);

  const purchaseMsg = `\`7[\`\`\`9${session.account.name} bought ${actualItems} ${itemName} for ${totalCostWls} World Locks.\`\`\`7]\`\``;
  broadcastConsoleMessage(world, purchaseMsg);
  logCctvEvent(world, session, "bought", `${actualItems} ${itemName} for ${totalCostWls} World Locks`);
  return true;
}
