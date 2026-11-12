/**
 * Magplant 5000 (5638), Heart of Gaia (6948), & Unstable Tesseract (6946)
 * Directly reverse engineered from LyNnz01/GTPS3/SERVER/World.h (lines 10436, 12552-12750)
 */

import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import type { WorldInstance } from "../../database/world";
import { canModifyWorldTile } from "../../database/world";
import { makeTileUpdatePacket, makeVariantPacket, type WorldTile } from "../../proton/packet";
import { OnConsoleMessage, OnDialogRequest, OnTalkBubble } from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";

export function openSuckerDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  session.pendingEditTile = { x: tx, y: ty };
  if (!tile.extra || tile.extra.kind !== "sucker") {
    tile.extra = { kind: "sucker", itemId: 0, count: 0, enabled: true };
  }
  const extra = tile.extra;
  const def = ctx.itemsDb.get(tile.fg) || { name: "Item Sucker" };
  const machineName = stripGtColors(def.name);
  const maxCap = tile.fg === 5638 ? 5000 : 1500;

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${machineName}\`\``, tile.fg)
    .addSpacer("small")
    .embedData("tilex", tx)
    .embedData("tiley", ty);

  if (extra.itemId === 0) {
    dlg.addTextbox("`6The machine is empty.``");
    dlg.addItemPicker("selectitem", "`wChoose Item``", `Choose an item to put in the ${machineName}!`);
    const dlgStr = dlg.endDialog("itemsucker_block", "Close", "");
    OnDialogRequest(session, dlgStr);
    return;
  }

  const itemDef = ctx.itemsDb.get(extra.itemId);
  const itemName = itemDef ? stripGtColors(itemDef.name) : "Item";
  const backpackCount = session.account.inventory.find((s) => s.itemId === extra.itemId)?.count || 0;

  dlg.addLabelWithIcon("small", `\`2${itemName}\`\``, extra.itemId);
  if (extra.count === 0) {
    dlg.addTextbox("`6The machine is currently empty!``");
  } else {
    dlg.addTextbox(`The machine contains ${extra.count} \`2${itemName}\`\``);
  }

  if (backpackCount > 0) {
    if (extra.count >= maxCap) {
      dlg.addSmalltext("`4The machine is at maximum capacity!``");
    } else {
      dlg.addButton("additem", "Add Items to the machine");
    }
  }

  if (extra.count > 0) {
    dlg.addButton("retrieveitem", "Retrieve Item");
  } else {
    dlg.addButton("clearitem", "Change Item");
  }

  if (tile.fg === 5638) { // Magplant 5000
    const modeStr = extra.magnetron ? "`5ACTIVE" : "`6DISABLED";
    dlg.addTextbox(`Building mode: ${modeStr}\`\``);
    dlg.addTextbox(`Use the Magplant Remote to build \`2${itemName}\`\` directly from the ${machineName}'s storage.`);
    dlg.addButton("getplantationdevice", "Get Remote");
  }

  dlg.addCheckbox("chk_enablesucking", "Enable Collection.", Boolean(extra.enabled));
  const dlgStr = dlg.endDialog("itemsucker_block", "Close", "Update");
  OnDialogRequest(session, dlgStr);
}

export function handleSuckerDialogReturn(
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
  if (!tile || (tile.fg !== 5638 && tile.fg !== 6948 && tile.fg !== 6946)) return false;

  if (!canModifyWorldTile(session, world, tile, tx, ty)) {
    OnConsoleMessage(session, "`4You don't have permission to edit this block.``");
    return true;
  }

  if (!tile.extra || tile.extra.kind !== "sucker") {
    tile.extra = { kind: "sucker", itemId: 0, count: 0, enabled: true };
  }
  const extra = tile.extra;
  const maxCap = tile.fg === 5638 ? 5000 : 1500;
  const btn = kv.buttonClicked || "";

  // 1. Get Magplant Remote (5640)
  if (btn === "getplantationdevice" && tile.fg === 5638 && extra.itemId > 0) {
    const hasRemote = session.account.inventory.some((s) => s.itemId === 5640 && s.count > 0);
    if (!hasRemote) {
      if (ctx.giveInventoryItem(session, 5640, 1, true) <= 0) {
        OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
        OnConsoleMessage(session, "You don't have room in your backpack!");
        return true;
      }
    }
    session.magplantRemote = { x: tx, y: ty, itemId: extra.itemId };
    extra.magnetron = true;
    ctx.dirty = true;
    const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    const planterPkt = makeVariantPacket([
      "OnPlanterActivated",
      { type: "i32", value: extra.itemId },
      { type: "i32", value: tx },
      { type: "i32", value: ty },
    ]);
    session.peer.sendPacket(0, planterPkt, true);
    OnTalkBubble(session, session.netId, "You received a Magplant 5000 Remote.", 0, true);
    OnConsoleMessage(session, "You received a Magplant 5000 Remote.");
    return true;
  }

  // 2. Select Item from Picker
  if (kv.selectitem && extra.itemId === 0) {
    const selectedId = parseInt(kv.selectitem, 10);
    const itemDef = ctx.itemsDb.get(selectedId);
    if (!itemDef) return true;

    // Heart of Gaia (6948) cannot store seeds
    if (tile.fg === 6948 && itemDef.isSeed) {
      OnTalkBubble(session, session.netId, "You cannot store seeds in this machine.", 0, true);
      OnConsoleMessage(session, "You cannot store seeds in this machine.");
      return true;
    }
    // Unstable Tesseract (6946) can ONLY store seeds
    if (tile.fg === 6946 && !itemDef.isSeed) {
      OnTalkBubble(session, session.netId, "You can only store seeds in this machine.", 0, true);
      OnConsoleMessage(session, "You can only store seeds in this machine.");
      return true;
    }

    extra.itemId = selectedId;
    extra.enabled = true;
    ctx.dirty = true;
    const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    openSuckerDialog(ctx, session, world, tile, tx, ty);
    return true;
  }

  // 3. Add Items from backpack
  if (btn === "additem" && extra.itemId > 0) {
    if (extra.count >= maxCap) {
      OnTalkBubble(session, session.netId, "`4The machine is at maximum capacity!``", 0, true);
      return true;
    }
    const slot = session.account.inventory.find((s) => s.itemId === extra.itemId);
    if (slot && slot.count > 0) {
      const addable = Math.min(slot.count, maxCap - extra.count);
      if (addable > 0) {
        extra.count += addable;
        ctx.consumeInventoryItem(session, extra.itemId, addable, true);
        ctx.dirty = true;
        const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        openSuckerDialog(ctx, session, world, tile, tx, ty);
      }
    }
    return true;
  }

  // 4. Retrieve Items into backpack
  if (btn === "retrieveitem" && extra.itemId > 0 && extra.count > 0) {
    const take = Math.min(200, extra.count);
    const given = ctx.giveInventoryItem(session, extra.itemId, take, true);
    if (given > 0) {
      extra.count -= given;
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      openSuckerDialog(ctx, session, world, tile, tx, ty);
    } else {
      OnTalkBubble(session, session.netId, "You don't have room in your backpack!", 0, true);
    }
    return true;
  }

  // 5. Clear item
  if (btn === "clearitem" && extra.count === 0) {
    extra.itemId = 0;
    extra.enabled = true;
    extra.magnetron = false;
    const clearPkt = makeVariantPacket([
      "OnPlanterActivated",
      { type: "i32", value: 0 },
      { type: "i32", value: 0 },
      { type: "i32", value: 0 },
    ]);
    for (const p of world.peers) {
      if (p.magplantRemote && p.magplantRemote.x === tx && p.magplantRemote.y === ty) {
        p.magplantRemote = null;
        p.peer.sendPacket(0, clearPkt, true);
      }
    }
    ctx.dirty = true;
    const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    openSuckerDialog(ctx, session, world, tile, tx, ty);
    return true;
  }

  // 6. Toggle Enabled
  if (kv.chk_enablesucking !== undefined) {
    extra.enabled = kv.chk_enablesucking === "1";
    ctx.dirty = true;
    const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    return true;
  }

  return true;
}
