import type { ServerContext } from "../../database/context";
import type { ItemDef } from "../../database/items";
import type { PlayerSession } from "../../database/peer";
import { GTPS3_CRYSTAL_RECIPES, GTPS3_GRINDER_RECIPES } from "../../database/recipes";
import { canModifyWorldTile, getWorldLockTile, spawnOrMergeWorldDrop, type WorldInstance } from "../../database/world";
import {
  buildTankPacket,
  makeParticleEffectPacket,
  makeTileUpdatePacket,
  PACKET_ITEM_EFFECT,
  TILE_FLAG_EXTRA_VISUAL,
  TILE_FLAG_HAS_WLS,
  TILE_FLAG_LOCKED,
  TILE_FLAG_PUBLIC,
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

export const DISPLAY_SHELF_IDS = new Set([3794, 10190, 10552]);
export const DONATION_BOX_IDS = new Set([1452, 10784]);
export const MAILBOX_IDS = new Set([656, 1006]);
export const BULLETIN_BOARD_IDS = new Set([658, 3524]);
export const STORAGE_BOX_IDS = new Set([4516, 6286, 6288, 6290, 8878]);
export const CAMERA_IDS = new Set([1436, 8246, 10258]);
export const BOOMBOX_IDS = new Set([62, 2282]);
export const MANNEQUIN_IDS = new Set([1420, 6214, 10072, 10074, 10076, 10078]);
export const AUTO_ACTION_IDS = new Set([6950, 6952]);
export const GRINDER_IDS = new Set([4582, 12196]);
export const CRYSTAL_IDS = new Set([2242, 2244, 2246, 2248, 2250]);

function getStorageBoxCapacity(itemId: number): number {
  if (itemId === 6288) return 40;
  if (itemId === 6290) return 90;
  return 20;
}

function isUntradeable(def?: ItemDef): boolean {
  return (
    !def ||
    def.id === 18 ||
    def.id === 32 ||
    def.id === 1424 ||
    def.id === 5816 ||
    def.id === 6336 ||
    def.id === 8430 ||
    (def.flags & 0x0010) !== 0
  );
}

function broadcastTileUpdate(world: WorldInstance, tx: number, ty: number, tile: WorldTile): void {
  const pkt = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}

function sendFlyEffect(target: PlayerSession, world: WorldInstance, tx: number, ty: number, itemId: number, broadcast = false): void {
  const pkt = buildTankPacket({
    type: PACKET_ITEM_EFFECT,
    netId: target.netId,
    x: tx * 32 + 16,
    y: ty * 32 + 16,
    punchX: itemId,
    punchY: target.netId,
    value: 500,
  });
  if (broadcast) {
    for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
  } else {
    target.peer.sendPacket(0, pkt, true);
  }
}

function hasOwnerAccess(session: PlayerSession, world: WorldInstance, tile: WorldTile): boolean {
  const uid = session.account.userId;
  if (session.account.rank === "developer" || world.ownerUserId === uid) return true;
  if ((tile.flags & TILE_FLAG_LOCKED) !== 0 && tile.parentIndex > 0) {
    const lt = world.tiles[tile.parentIndex];
    return lt?.extra?.kind === "lock" && lt.extra.ownerUserId === uid;
  }
  return world.ownerUserId === 0;
}

function canAdminAccess(session: PlayerSession, world: WorldInstance, tile: WorldTile): boolean {
  const uid = session.account.userId;
  if (hasOwnerAccess(session, world, tile)) return true;
  const wl = getWorldLockTile(world);
  if (wl?.extra?.kind === "lock" && wl.extra.adminIds.includes(uid)) return true;
  if ((tile.flags & TILE_FLAG_LOCKED) !== 0 && tile.parentIndex > 0) {
    const lt = world.tiles[tile.parentIndex];
    if (lt?.extra?.kind === "lock" && lt.extra.adminIds.includes(uid)) return true;
  }
  return false;
}

function cleanName(def?: ItemDef): string {
  return def ? stripGtColors(def.name) : "Item";
}

function hasInvRoom(session: PlayerSession, itemId: number, count = 1): boolean {
  let cap = 0;
  for (const s of session.account.inventory) {
    if (s.itemId === itemId && s.count > 0 && s.count < 200) cap += 200 - s.count;
  }
  const usedSlots = session.account.inventory.filter((s) => s.count > 0).length;
  const freeSlots = Math.max(0, session.account.backpackSize - usedSlots);
  return cap + freeSlots * 200 >= count;
}

// ----------------------------------------------------------------------------
// 1. Display Block (2946)
// ----------------------------------------------------------------------------

export function useItemOnDisplayBlock(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (tile.fg !== 2946) return false;
  if (world.ownerUserId === 0 && (tile.flags & TILE_FLAG_LOCKED) === 0) {
    OnTalkBubble(session, session.netId, "This area must be locked to put your item on display!", 0, true);
    return true;
  }
  if (!hasOwnerAccess(session, world, tile)) {
    OnTalkBubble(session, session.netId, "Only the block's owner can place items in it.", 0, true);
    return true;
  }
  if (tile.extra?.kind !== "display") tile.extra = { kind: "display", itemId: 0 };
  if (tile.extra.itemId !== 0) {
    OnTalkBubble(session, session.netId, "Remove what's in there first!", 0, true);
    return true;
  }
  const def = ctx.itemsDb.get(itemId);
  if (isUntradeable(def)) {
    OnTalkBubble(session, session.netId, "You can't display untradeable items!", 0, true);
    return true;
  }
  if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;
  tile.extra = { kind: "display", itemId };
  ctx.dirty = true;
  broadcastTileUpdate(world, tx, ty, tile);
  OnTalkBubble(session, session.netId, `You put \`5${cleanName(def)}\`\` on display!`, 0, true);
  return true;
}

export function openDisplayBlockDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (tile.extra?.kind !== "display") tile.extra = { kind: "display", itemId: 0 };
  const displayedId = tile.extra.itemId;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${fgName}\`\``, tile.fg)
    .addSpacer("small")
    .embedData("tilex", tx)
    .embedData("tiley", ty)
    .addTextbox(
      displayedId
        ? `A ${cleanName(ctx.itemsDb.get(displayedId))} is on display here.`
        : "The Display Block is empty. Use an item on it to display the item!"
    );
  const canTake = displayedId !== 0 && hasOwnerAccess(session, world, tile);
  OnDialogRequest(
    session,
    dlg.endDialog("displayblock", canTake ? "Leave it" : "Okay", canTake ? "Pick it up" : "")
  );
}

// ----------------------------------------------------------------------------
// 2. Display Shelf (3794, 10190, 10552)
// ----------------------------------------------------------------------------

export function openDisplayShelfDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
    OnTalkBubble(session, session.netId, "`4Only builders with access can manage this Display Shelf.``", 0, true);
    return;
  }
  if (tile.extra?.kind !== "displayShelf") {
    tile.extra = { kind: "displayShelf", s1: 0, s2: 0, s3: 0, s4: 0 };
  }
  const ex = tile.extra;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const slotLine = (pickerKey: string, label: string, itemId: number): string =>
    itemId
      ? `add_item_picker|${pickerKey}|${label}: \`2${cleanName(ctx.itemsDb.get(itemId))}\`\`|Select any item to display|`
      : `add_item_picker|${pickerKey}|\`4Display an item\`\`|Select any item to display|`;

  const canTake = ex.s1 !== 0 || ex.s2 !== 0 || ex.s3 !== 0 || ex.s4 !== 0;
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    "add_spacer|small|",
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
    slotLine("replace2", "Item 1", ex.s2),
    slotLine("replace1", "Item 2", ex.s1),
    slotLine("replace3", "Item 3", ex.s3),
    slotLine("replace4", "Item 4", ex.s4),
  ];
  if (canTake) lines.push("add_button|remove|Take All Items|noflags|0|0|");
  lines.push("end_dialog|dispshelf|Okay||");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 3. Donation Box (1452, 10784)
// ----------------------------------------------------------------------------

export function useItemOnDonationBox(
  ctx: ServerContext,
  session: PlayerSession,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (!DONATION_BOX_IDS.has(tile.fg)) return false;
  if (tile.extra?.kind !== "donation") tile.extra = { kind: "donation", donates: [] };

  const invSlot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!invSlot) return true;

  const def = ctx.itemsDb.get(itemId);
  if (isUntradeable(def)) {
    OnTalkBubble(session, session.netId, "`7[```4You can't place that in the box, you need it!`7]``", 0, false);
    return true;
  }
  if ((def?.rarity ?? 0) <= 1) {
    OnTalkBubble(session, session.netId, "`7[```4This box only accepts items rarity 2+ or greater`7]``", 0, false);
    return true;
  }
  if (tile.extra.donates.length >= 20) {
    OnTalkBubble(session, session.netId, "You aren't able to fit another gift inside, it's jammed full.", 0, false);
    return true;
  }

  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;
  session.lastChoosenItem = itemId;

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `${cleanName(def)}\`\``, itemId)
    .addTextbox("How many to put in the box as a gift? (Note: You will `4LOSE`` the items you give!)")
    .addTextInput("count", "Count:", String(invSlot.count), 5)
    .addTextInput("sign_text", "Optional Note:", "", 128)
    .addSpacer("small")
    .addButton("give", "`4Give the item(s)``")
    .addSpacer("small")
    .addButton("cancel", "`wCancel``")
    .endDialog("give_item", "", "");
  OnDialogRequest(session, dlg);
  return true;
}

export function openDonationBoxDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (tile.extra?.kind !== "donation") tile.extra = { kind: "donation", donates: [] };
  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;
  const donates = tile.extra.donates;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const isOwner = canModifyWorldTile(session, world, tile, tx, ty, "wrench");

  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
  ];
  if (isOwner) {
    if (donates.length === 0) {
      lines.push("add_textbox|The box is currently empty.|left|");
    } else {
      lines.push(`add_textbox|You have \`w${donates.length}\`\` gift waiting:|left|`);
      donates.forEach((d, idx) => {
        const dName = cleanName(ctx.itemsDb.get(d.itemId));
        const note = d.text ? `\`#- "${d.text}"\`\`` : "";
        lines.push(`add_checkbox|gift_${idx}|${dName} (\`w${d.count}\`\`) from \`w${d.name}\`\`${note}|0`);
      });
      lines.push("add_spacer|small|");
      lines.push("add_button|clear_selected|`4Retrieve Selected Gifts``|noflags|0|0|");
      lines.push("add_button|takeall|`4Retrieve All Gifts``|noflags|0|0|");
    }
  } else {
    lines.push(
      donates.length > 0
        ? `add_textbox|You see \`w${donates.length}\`\` gift in the box!|left|`
        : "add_textbox|The box is currently empty.|left|"
    );
    lines.push("add_textbox|Want to leave a gift for the owner?|left|");
  }
  if (donates.length >= 20) {
    lines.push("add_textbox|This box already has `w20`` gifts in it, can't add more until you clear them.|left|");
  } else {
    lines.push("add_spacer|small|");
    lines.push("add_item_picker|itemid|`wGive Gift`` (Min rarity: `52``)|Choose an item to give|");
  }
  lines.push("end_dialog|donation_box_edit|Cancel||");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 4. Bulletin Board (658, 3524) & Mailbox (656, 1006)
// ----------------------------------------------------------------------------

export function openBulletinOrMailboxDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;
  const isMailbox = MAILBOX_IDS.has(tile.fg);
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const isOwner = canModifyWorldTile(session, world, tile, tx, ty, "wrench");

  const settings = (world.bulletinSettings || []).find((s) => s.x === tx && s.y === ty);
  const publicCanAdd = settings ? settings.publicCanAdd : true;
  const hideNames = settings ? settings.hideNames : false;

  const entries = (world.bulletin || []).filter((b) => b.x === tx && b.y === ty);
  const ownCount = entries.filter((e) => e.name === session.account.name).length;

  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    "add_spacer|small|",
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
  ];

  const entryLines: string[] = [];
  entries.forEach((e, idx) => {
    if (!isMailbox) {
      if (hideNames) {
        entryLines.push(`add_label|small|\`2${e.text}\`\`|left|`);
      } else if (isOwner) {
        entryLines.push(`add_label_with_icon_button|small|${e.name}: \`2${e.text}\`\`|left|660|edit${idx + 1}|`);
      } else {
        entryLines.push(`add_label_with_icon|small|${e.name}: \`2${e.text}\`\`|left|660|`);
      }
    } else {
      entryLines.push(`add_label_with_icon|small|\`#"${e.text}" - \`w${e.name}\`\`|left|660|`);
      entryLines.push("add_spacer|small|");
    }
  });

  if (!isMailbox) {
    lines.push(entries.length === 0 ? `add_textbox|The ${fgName} is empty.|left|` : entryLines.join("\n"));
    if (isOwner) {
      lines.push("add_textbox|Add to conversation?|left|");
      lines.push("add_text_input|sign_text|||128|");
      lines.push("add_spacer|small|");
      lines.push("add_button|send|`2Add``|noflags|0|0|");
      lines.push("add_spacer|small|");
      lines.push("add_label_with_icon|big|`wOwner Options|left|242|");
      lines.push("add_spacer|small|");
      lines.push("add_textbox|To remove an individual comment, press the icon to the left of it.|left|");
      lines.push("add_spacer|small|");
      if (entries.length > 0) lines.push("add_button|clear|`4Clear Board``|noflags|0|0|");
      lines.push(`add_checkbox|checkbox_locked|Public can add|${publicCanAdd ? 1 : 0}`);
      lines.push(`add_checkbox|checkbox_hide|Hide names|${hideNames ? 1 : 0}`);
      lines.push("end_dialog|bulletin_edit|Cancel|OK|");
    } else {
      if (publicCanAdd) {
        if (ownCount >= 3) {
          lines.push("add_textbox|You already have `03`` posts up, take a break!|left|");
        } else {
          lines.push("add_textbox|Add to conversation?|left|");
          lines.push("add_text_input|sign_text|||128|");
          lines.push("add_spacer|small|");
          lines.push("add_button|send|`2Add``|noflags|0|0|");
        }
      }
      lines.push("end_dialog|bulletin_edit|Cancel||");
    }
  } else {
    if (isOwner) {
      if (entries.length === 0) {
        lines.push("add_textbox|Your mailbox is currently empty.|left|");
      } else {
        lines.push(`add_textbox|You have \`w${entries.length}\`\` letters:|left|`);
        lines.push("add_spacer|small|");
        lines.push(entryLines.join("\n"));
        lines.push("add_spacer|small|");
        lines.push("add_button|clear|`4Empty Mailbox``|noflags|0|0|");
      }
      if (entries.length >= 20) {
        lines.push("add_textbox|This mailbox already has `w20`` letters in it.  Try again later.|left|");
      } else {
        lines.push("add_textbox|Write a letter to yourself?|left|");
        lines.push("add_text_input|sign_text|||128|");
        lines.push("add_spacer|small|");
        lines.push("add_button|send|`2Send Letter``|noflags|0|0|");
      }
    } else {
      if (entries.length >= 20) {
        lines.push("add_textbox|This mailbox already has `w20`` letters in it.  Try again later.|left|");
      } else if (ownCount >= 3) {
        lines.push("add_textbox|You've already crammed `w3 ``of your letters into the mailbox, better wait.|left|");
      } else {
        lines.push("add_textbox|Want to leave a message for the owner?|left|");
        lines.push("add_text_input|sign_text|||128|");
        lines.push("add_spacer|small|");
        lines.push("add_button|send|`2Send Letter``|noflags|0|0|");
      }
    }
    lines.push("end_dialog|bulletin_edit|Cancel||");
  }
  lines.push("add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 5. Storage Box Xtreme (6286..6290, 4516) & Safe Vault (8878)
// ----------------------------------------------------------------------------

function renderStorageBoxDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const boxCap = getStorageBoxCapacity(tile.fg);
  const stored = (world.storageItems || []).filter((s) => s.x === tx && s.y === ty);
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
  ];
  if (stored.length > 0) {
    lines.push("add_spacer|small|");
    lines.push("text_scaling_string|aaaaaaaaaaaaaaa|");
    stored.forEach((entry, idx) => {
      const iName = cleanName(ctx.itemsDb.get(entry.itemId));
      lines.push(`add_button_with_icon|itm${idx + 1}|${iName}|frame|${entry.itemId}|${entry.count}|`);
    });
    lines.push("add_button_with_icon||END_LIST|noflags|0||");
  }
  lines.push(`add_textbox|\`w${stored.length}/${boxCap}\`\` items stored.|left|`);
  if (stored.length < boxCap) {
    lines.push("add_spacer|small|");
    lines.push("add_item_picker|itemid|`wDeposit Item``|Choose an item to store|");
  }
  if (tile.fg === 8878) {
    const pw = tile.extra?.kind === "storage" ? tile.extra.password || "" : "";
    lines.push(`add_textbox|This Safe Vault is ${pw ? "`2" : "not `4"}password protected\`\`!|left|`);
    lines.push("add_spacer|small|");
    lines.push("add_textbox|Change your password.|left|");
    lines.push("add_button|change_password|`wUpdate Password``|noflags|0|0|");
  }
  lines.push("end_dialog|storageboxxtreme|Exit||");
  lines.push("add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

export function openStorageBoxDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (!canAdminAccess(session, world, tile)) {
    OnTalkBubble(session, session.netId, "`4Only world owner or admins can access this storage!``", 0, true);
    return;
  }
  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;
  if (tile.extra?.kind !== "storage") tile.extra = { kind: "storage" };

  if (tile.fg === 8878 && tile.extra.password) {
    const lines = [
      "set_default_color|`o",
      "add_label_with_icon|big|`wSafe Vault``|left|8878|",
      `embed_data|tilex|${tx}`,
      `embed_data|tiley|${ty}`,
      "add_textbox|Please enter your password to access the Safe Vault.|left|",
      `add_text_input_password|storage_password||${session.account.rank === "developer" ? tile.extra.password : ""}|12|`,
      "add_button|check_password|`wEnter Password``|noflags|0|0|",
      "add_button|show_recoveryanswer|`wRecover Password``|noflags|0|0|",
      "end_dialog|storageboxpassword|Exit||",
      "add_quick_exit|",
    ];
    OnDialogRequest(session, lines.join("\n"));
    return;
  }
  renderStorageBoxDialog(ctx, session, world, tile, tx, ty);
}

// ----------------------------------------------------------------------------
// 6. Security Camera / CCTV (1436, 8246, 10258)
// ----------------------------------------------------------------------------

export function openCameraDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (!canAdminAccess(session, world, tile)) return;
  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;

  world.cctvSettings = world.cctvSettings || [];
  let s = world.cctvSettings.find((c) => c.x === tx && c.y === ty);
  if (!s) {
    s = {
      x: tx,
      y: ty,
      showTaking: false,
      showDropping: false,
      showEnter: true,
      showExit: false,
      hideOwner: false,
      hideAdmins: false,
      hideNoAccess: false,
      showVend: false,
    };
    world.cctvSettings.push(s);
    ctx.dirty = true;
  }

  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const logs = (world.cctvLogs || []).filter((l) => l.x === tx && l.y === ty);
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
    "add_spacer|small|",
  ];
  if (logs.length === 0) {
    lines.push("add_textbox|The camera log is empty.|left|");
  } else {
    for (const entry of logs) {
      lines.push(`add_label_with_icon|small|${entry.log}\`\`|left|${entry.icon}|`);
    }
    lines.push("add_spacer|small|");
  }
  lines.push(
    `add_checkbox|checkbox_showpick|Show Item Taking|${s.showTaking ? 1 : 0}`,
    `add_checkbox|checkbox_itemdrop|Show Item Dropping|${s.showDropping ? 1 : 0}`,
    `add_checkbox|checkbox_showenter|Show People Entering|${s.showEnter ? 1 : 0}`,
    `add_checkbox|checkbox_showexit|Show People Exiting|${s.showExit ? 1 : 0}`,
    `add_checkbox|checkbox_noshowowner|Don't Show Owner|${s.hideOwner ? 1 : 0}`,
    `add_checkbox|checkbox_noshowadmin|Don't Show Admins|${s.hideAdmins ? 1 : 0}`,
    `add_checkbox|checkbox_noshowother|Don't Show People Without Access|${s.hideNoAccess ? 1 : 0}`,
    `add_checkbox|checkbox_vendlogs|Show Vending Machine Logs|${s.showVend ? 1 : 0}`
  );
  if (logs.length > 0) lines.push("add_button|clear|`4Clear Log``|noflags|0|0|");
  lines.push("end_dialog|camera_edit||OK|");
  lines.push("add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 7. Boombox (62, 2282) & Switcheroo / Public Toggleables
// ----------------------------------------------------------------------------

export function openToggleableDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  const id = tile.fg || tile.bg;
  const def = ctx.itemsDb.get(id);
  if (!def) return;
  const fgName = cleanName(def);
  const canEdit = canModifyWorldTile(session, world, tile, tx, ty, "wrench");
  const isBoombox = BOOMBOX_IDS.has(id);
  const dlgName = isBoombox ? "boombox_edit" : "switcheroo_edit";

  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`wEdit ${fgName}\`\`|left|${id}|`,
  ];
  if (!canEdit) {
    lines.push("add_textbox|This object has additional properties to edit if in a locked area.|left|");
  } else {
    const publicLabel = def.actionType === 9 ? "Is open to public" : "Usable by public";
    lines.push(`add_checkbox|checkbox_public|${publicLabel}|${(tile.flags & TILE_FLAG_PUBLIC) !== 0 ? 1 : 0}`);
    if (isBoombox) {
      lines.push(`add_checkbox|checkbox_silence|Silenced|${(tile.flags & TILE_FLAG_HAS_WLS) !== 0 ? 1 : 0}`);
    }
  }
  lines.push(`embed_data|tilex|${tx}`, `embed_data|tiley|${ty}`, `end_dialog|${dlgName}|Cancel|OK|`);
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 8. Mannequin (1420, 6214, 10072..10078)
// ----------------------------------------------------------------------------

type MannequinExtra = Extract<NonNullable<WorldTile["extra"]>, { kind: "mannequin" }>;

function mannequinSlotField(clothingType: number): keyof Pick<
  MannequinExtra,
  "hair" | "shirt" | "pants" | "feet" | "face" | "hand" | "back" | "mask" | "neck"
> | null {
  switch (clothingType) {
    case 0: return "hair";
    case 1: return "shirt";
    case 2: return "pants";
    case 3: return "feet";
    case 4: return "face";
    case 5: return "hand";
    case 6: return "back";
    case 7: return "mask";
    case 8: return "neck";
    default: return null;
  }
}

export function useClothingOnMannequin(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (!MANNEQUIN_IDS.has(tile.fg)) return false;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  if (world.ownerUserId === 0 && (tile.flags & TILE_FLAG_LOCKED) === 0) {
    OnTalkBubble(session, session.netId, `\`5[\`2It's not safe to use an unlocked ${fgName}!\`\`]\`\``, 0, false);
    return true;
  }
  if (!canModifyWorldTile(session, world, tile, tx, ty, "place")) {
    return true;
  }
  const def = ctx.itemsDb.get(itemId);
  if (!def || !def.isClothing) {
    OnTalkBubble(session, session.netId, `\`5[\`2That would just be weird.  Try putting clothes on your ${fgName} instead!\`\`]\`\``, 0, false);
    return true;
  }
  if (isUntradeable(def)) {
    OnTalkBubble(session, session.netId, `\`5[\`2You cannot place ${cleanName(def)} on ${fgName}!\`\`]\`\``, 0, false);
    return true;
  }
  const field = mannequinSlotField(def.actionType === 107 ? 9 : def.clothingType);
  if (!field) {
    OnTalkBubble(session, session.netId, `\`5[\`2It's not safe to place ${cleanName(def)} on ${fgName}!\`\`]\`\``, 0, false);
    return true;
  }
  if (tile.extra?.kind !== "mannequin") {
    tile.extra = { kind: "mannequin", label: "", skinColor: session.account.skinColor, hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, neck: 0 };
  }
  if (tile.extra[field] === itemId) {
    OnTalkBubble(session, session.netId, "`5[`2You giggle as you swap two identical items``]``", 0, false);
    return true;
  }
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${cleanName(def)}\`\``, itemId)
    .addTextbox(`Do you really want to put your ${cleanName(def)} on the ${fgName}?`)
    .embedData("tilex", tx)
    .embedData("tiley", ty)
    .embedData("put", itemId)
    .endDialog("mannequin_edit", "No", "Yes");
  OnDialogRequest(session, dlg);
  return true;
}

export function openMannequinDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
    OnTalkBubble(session, session.netId, "`4Only builders with access can edit this Mannequin.``", 0, true);
    return;
  }
  if (tile.extra?.kind !== "mannequin") {
    tile.extra = { kind: "mannequin", label: "", skinColor: 0, hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, neck: 0 };
  }
  const mq = tile.extra;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const worn = [mq.face, mq.shirt, mq.pants, mq.feet, mq.mask, mq.hand, mq.back, mq.hair, mq.neck].filter((id) => id > 0);
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`wEdit ${fgName}\`\`|left|${tile.fg}|`,
    "add_textbox|To dress, select a clothing item then use on the mannequin. To remove clothes, punch it or select which item to remove.<CR><CR>It will go into your backpack if you have room.|",
  ];
  for (const wid of worn) {
    lines.push(`add_checkbox|checkbox_${wid}|${cleanName(ctx.itemsDb.get(wid))}|0|`);
  }
  if (worn.length > 0) {
    lines.push("add_spacer|small|");
    lines.push("add_button|clear_selected|`4Remove Selected Items``|noflags|0|0|");
    lines.push("add_button|clear|`4Remove All Items``|noflags|0|0|");
  }
  lines.push(
    "add_textbox|<CR><CR>What would you like to write on its sign?``|left|",
    `add_text_input|sign_text||${mq.label || ""}|128|`,
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
    "end_dialog|mannequin_edit|Cancel|OK|"
  );
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 9. Auto Action Block (6950 Heart of Gaia, 6952 Tesseract Manipulator)
// ----------------------------------------------------------------------------

export function openAutoActionBlockDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (tile.extra?.kind !== "autoAction") tile.extra = { kind: "autoAction", fuel: 0, targetItemId: 0, enabled: false };
  const ex = tile.extra;
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const isOwner = hasOwnerAccess(session, world, tile);

  const lines = [
    `add_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|`,
    "add_spacer|small|",
    "add_smalltext|The device will consume 2300 Gems/hr while active!|left|",
    `add_smalltext|Current Fuel = \`w${ex.fuel}/8,000\`\`|left|`,
  ];
  if (!isOwner) {
    lines.push("end_dialog|autoactionblock|Close||", "add_quick_exit|");
    OnDialogRequest(session, lines.join("\n"));
    return;
  }
  if (ex.fuel < 8000) {
    lines.push("add_smalltext|Refuel this with gems!|left|");
    lines.push("add_text_input|refillfuel|Add Gems:|0|5|");
    lines.push("add_button|addfuel|`wAdd Gems``|noflags|0|0|");
  }
  lines.push("add_spacer|small|");
  lines.push(
    `add_smalltext|${ex.targetItemId === 0 ? "No block type selected!" : `Target block is: \`2${cleanName(ctx.itemsDb.get(ex.targetItemId))}\`\``}|left|`
  );
  lines.push("add_item_picker|selecttarget|`wChoose Target Item``|Choose the target item!|");
  lines.push("add_spacer|small|", `embed_data|tilex|${tx}`, `embed_data|tiley|${ty}`, "end_dialog|autoactionblock|Close|OK|", "add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// 10. Food Grinder (4582, 12196)
// ----------------------------------------------------------------------------

export function useItemOnGrinder(
  ctx: ServerContext,
  session: PlayerSession,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (!GRINDER_IDS.has(tile.fg)) return false;
  const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!slot) return true;
  const recipe = GTPS3_GRINDER_RECIPES[itemId];
  if (!recipe) {
    OnTalkBubble(session, session.netId, "`5[`2That's not grindable``]``", 0, false);
    return true;
  }
  if (slot.count < recipe.count) {
    OnTalkBubble(session, session.netId, `\`5[\`2I need ${recipe.count} of those to grind them!\`\`]\`\``, 0, false);
    return true;
  }
  session.lastWrenchX = tx;
  session.lastWrenchY = ty;
  session.lastWrenchB = tile.fg;
  session.lastChoosenItem = itemId;
  const def = ctx.itemsDb.get(itemId);
  const maxTimes = Math.floor(slot.count / recipe.count);
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`wGrind ${cleanName(def)}\`\``, itemId)
    .addTextbox(
      `You have ${slot.count} ${cleanName(def)}. It takes ${recipe.count} per grind. How many times will you grind (max ${maxTimes})?`
    )
    .addTextbox("`4Beware:`` If you don't have room in your inventory for the resulting items, they will drop on the floor.")
    .addTextInput("count", "", String(maxTimes), 5)
    .endDialog("grinder", "Cancel", "OK");
  OnDialogRequest(session, dlg);
  return true;
}

export function openGrinderDialog(ctx: ServerContext, session: PlayerSession, tile: WorldTile): void {
  const fgName = cleanName(ctx.itemsDb.get(tile.fg));
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${fgName}\`\``, tile.fg)
    .addTextbox("Use items on here to try to grind them up into tasty food. Only certain things can be ground up.")
    .addTextbox("You might be surprised what you can grind!")
    .endDialog("grinder", "Thanks for the info!", "");
  OnDialogRequest(session, dlg);
}

// ----------------------------------------------------------------------------
// 11. Crystal Exchange (2242..2250)
// ----------------------------------------------------------------------------

export function useCrystalOnCrystal(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number,
  itemId: number
): boolean {
  if (!CRYSTAL_IDS.has(tile.fg) || !CRYSTAL_IDS.has(itemId)) return false;
  if (!canModifyWorldTile(session, world, tile, tx, ty, "place")) return true;
  if (!ctx.consumeInventoryItem(session, itemId, 1, true)) return true;

  if (tile.extra?.kind !== "crystal") {
    tile.extra = { kind: "crystal", crystals: { [tile.fg]: 1 } };
  }
  tile.extra.crystals[itemId] = (tile.extra.crystals[itemId] || 0) + 1;
  ctx.dirty = true;

  const summary = [2242, 2244, 2246, 2248, 2250]
    .map((cid, idx) => `${tile.fg === cid ? (tile.extra as any).crystals[cid] || 1 : (tile.extra as any).crystals[cid] || 0}x \`$${["R", "G", "B", "W", "Bk"][idx]}\`\``)
    .join(", ");
  OnTalkBubble(session, session.netId, `Mixed! (${summary})`, 0, true);
  broadcastPositionedSfx(world, session.netId, "audio/crystal.wav");
  return true;
}

export function openCrystalExchangeDialog(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tile: WorldTile,
  tx: number,
  ty: number
): void {
  if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) return;
  if (tile.extra?.kind !== "crystal") tile.extra = { kind: "crystal", crystals: { [tile.fg]: 1 } };
  const counts: Record<number, number> = { 2242: 0, 2244: 0, 2246: 0, 2248: 0, 2250: 0, ...tile.extra.crystals };
  if (!counts[tile.fg]) counts[tile.fg] = 1;

  const summary = [2242, 2244, 2246, 2248, 2250]
    .map((cid, idx) => `${counts[cid]}x \`$${["R", "G", "B", "W", "B"][idx]}\`\``)
    .join(", ");

  const available = GTPS3_CRYSTAL_RECIPES.filter((r) =>
    Object.entries(r.requirements).every(([cid, need]) => (counts[Number(cid)] || 0) >= need)
  );

  const lines = [
    "set_default_color|`o",
    "add_label_with_icon|big|`wCrystal Shattering``|left|5104|",
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
    `add_label_with_icon|small|This crystal is currently mixed with ${summary}.|left|5274|`,
  ];
  if (available.length === 0) {
    lines.push("add_textbox|No recipes are available. Mix more various crystals to see available recipes.|left|");
  } else {
    lines.push("add_spacer|small|");
    for (const r of available) {
      lines.push(`add_button|${r.result[0]}|\`$Craft ${cleanName(ctx.itemsDb.get(r.result[0]))}\`\`|noflags|0|0|`);
    }
  }
  lines.push("end_dialog|crystal_exchange|Cancel||");
  OnDialogRequest(session, lines.join("\n"));
}

// ----------------------------------------------------------------------------
// Unified Dialog Return Dispatcher for All World Blocks
// ----------------------------------------------------------------------------

export function handleWorldBlockDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  dlgName: string,
  kv: Record<string, string>
): boolean {
  const world = session.world;
  if (!world) return false;
  const btn = kv.buttonClicked || "";
  const tx = Number.parseInt(kv.tilex ?? String(session.lastWrenchX ?? -1), 10);
  const ty = Number.parseInt(kv.tiley ?? String(session.lastWrenchY ?? -1), 10);
  const validTile = Number.isSafeInteger(tx) && Number.isSafeInteger(ty) && tx >= 0 && tx < world.width && ty >= 0 && ty < world.height;
  const tile = validTile ? world.tiles[ty * world.width + tx] : undefined;

  // --- Display Block ---
  if (dlgName === "displayblock" && tile && tile.fg === 2946) {
    if (!hasOwnerAccess(session, world, tile) || tile.extra?.kind !== "display" || tile.extra.itemId === 0) return true;
    const itemId = tile.extra.itemId;
    if (ctx.giveInventoryItem(session, itemId, 1, true) > 0) {
      const def = ctx.itemsDb.get(itemId);
      tile.extra = { kind: "display", itemId: 0 };
      ctx.dirty = true;
      broadcastTileUpdate(world, tx, ty, tile);
      OnTalkBubble(session, session.netId, `You removed \`5${cleanName(def)}\`\` from the Display Block.`, 0, false);
    } else {
      OnTalkBubble(session, session.netId, "You don't have room to pick that up!", 0, false);
    }
    return true;
  }

  // --- Display Shelf ---
  if (dlgName === "dispshelf" && tile && DISPLAY_SHELF_IDS.has(tile.fg)) {
    if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) return true;
    if (tile.extra?.kind !== "displayShelf") tile.extra = { kind: "displayShelf", s1: 0, s2: 0, s3: 0, s4: 0 };
    const ex = tile.extra;
    const slots: Array<["replace1" | "replace2" | "replace3" | "replace4", "s1" | "s2" | "s3" | "s4"]> = [
      ["replace1", "s1"],
      ["replace2", "s2"],
      ["replace3", "s3"],
      ["replace4", "s4"],
    ];

    if (btn === "remove") {
      for (const [, field] of slots) {
        if (ex[field] !== 0) {
          if (ctx.giveInventoryItem(session, ex[field], 1, true) > 0) {
            OnConsoleMessage(session, `Picked up 1 ${cleanName(ctx.itemsDb.get(ex[field]))}.`);
            ex[field] = 0;
          } else {
            OnTalkBubble(session, session.netId, `No room to take ${cleanName(ctx.itemsDb.get(ex[field]))}.`, 0, false);
            break;
          }
        }
      }
      ctx.dirty = true;
      broadcastTileUpdate(world, tx, ty, tile);
      return true;
    }

    for (const [pickerKey, field] of slots) {
      if (!kv[pickerKey]) continue;
      const newId = Number.parseInt(kv[pickerKey], 10);
      if (!Number.isSafeInteger(newId) || newId <= 0) continue;
      const def = ctx.itemsDb.get(newId);
      if (isUntradeable(def)) {
        OnTalkBubble(session, session.netId, "You can't display untradeable items.", 0, false);
        return true;
      }
      if (ex[field] !== 0) {
        if (ctx.giveInventoryItem(session, ex[field], 1, true) > 0) {
          OnConsoleMessage(session, `Picked up 1 ${cleanName(ctx.itemsDb.get(ex[field]))}.`);
          ex[field] = 0;
        } else {
          OnTalkBubble(session, session.netId, `No room to take ${cleanName(ctx.itemsDb.get(ex[field]))}.`, 0, false);
          return true;
        }
      }
      if (ctx.consumeInventoryItem(session, newId, 1, true)) {
        ex[field] = newId;
        OnConsoleMessage(session, `Put ${cleanName(def)} on display.`);
      }
    }
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    return true;
  }

  // --- Donation Box ---
  if (dlgName === "donation_box_edit" && tile && DONATION_BOX_IDS.has(tile.fg)) {
    if (tile.extra?.kind !== "donation") tile.extra = { kind: "donation", donates: [] };
    if (kv.itemid) {
      const itemId = Number.parseInt(kv.itemid, 10);
      if (itemId > 0) useItemOnDonationBox(ctx, session, tile, tx, ty, itemId);
      return true;
    }
    if ((btn === "takeall" || btn === "clear_selected") && canModifyWorldTile(session, world, tile, tx, ty, "wrench")) {
      let took = false;
      let fullInv = false;
      const remaining: typeof tile.extra.donates = [];
      tile.extra.donates.forEach((d, idx) => {
        const selected = btn === "takeall" || kv[`gift_${idx}`] === "1";
        if (!selected) {
          remaining.push(d);
          return;
        }
        if (hasInvRoom(session, d.itemId, d.count) && ctx.giveInventoryItem(session, d.itemId, d.count, true) === d.count) {
          took = true;
          const dName = cleanName(ctx.itemsDb.get(d.itemId));
          broadcastConsoleMessage(
            world,
            `\`7[\`\`${session.account.name} receives \`5${d.count}\`\` \`w${dName}\`\` from \`w${d.name}\`\`, how nice!\`7]\`\``
          );
        } else {
          fullInv = true;
          remaining.push(d);
        }
      });
      tile.extra.donates = remaining;
      if (remaining.length === 0) tile.flags &= ~TILE_FLAG_EXTRA_VISUAL;
      ctx.dirty = true;
      broadcastTileUpdate(world, tx, ty, tile);
      if (fullInv) OnTalkBubble(session, session.netId, "I don't have enough room in my backpack to get the item(s) from the box!", 0, false);
      else if (took) OnTalkBubble(session, session.netId, "`2Box emptied.``", 0, false);
    }
    return true;
  }

  if (dlgName === "give_item" && tile && DONATION_BOX_IDS.has(tile.fg)) {
    if (btn !== "give") return true;
    const itemId = session.lastChoosenItem || 0;
    const count = Number.parseInt(kv.count || "0", 10);
    const note = (kv.sign_text || "").replace(/[|\r\n]/g, "").slice(0, 128);
    if (tile.extra?.kind !== "donation") tile.extra = { kind: "donation", donates: [] };
    if (tile.extra.donates.length >= 20) return true;
    const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
    const def = ctx.itemsDb.get(itemId);
    if (!slot || count <= 0 || count > slot.count || isUntradeable(def)) {
      OnTalkBubble(session, session.netId, slot && count > slot.count ? "You don't have that to give!" : "`7[```4You can't place that in the box, you need it!`7]``", 0, false);
      return true;
    }
    if (!ctx.consumeInventoryItem(session, itemId, count, true)) return true;
    tile.extra.donates.push({ itemId, count, name: session.account.name, text: note });
    tile.flags |= TILE_FLAG_EXTRA_VISUAL;
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    const msg = `\`7[\`\`\`5[\`\`\`w${session.account.name}\`\` places \`5${count}\`\` \`2${cleanName(def)}\`\` into the ${cleanName(ctx.itemsDb.get(tile.fg))}\`5]\`\`\`7]\`\``;
    broadcastConsoleMessage(world, msg);
    OnTalkBubble(session, session.netId, msg, 0, false);
    return true;
  }

  // --- Bulletin Board & Mailbox ---
  if (dlgName === "bulletin_edit" && tile && (MAILBOX_IDS.has(tile.fg) || BULLETIN_BOARD_IDS.has(tile.fg))) {
    const isMailbox = MAILBOX_IDS.has(tile.fg);
    const isOwner = canModifyWorldTile(session, world, tile, tx, ty, "wrench");
    world.bulletin = world.bulletin || [];
    world.bulletinSettings = world.bulletinSettings || [];

    if (btn === "clear" && isOwner) {
      world.bulletin = world.bulletin.filter((b) => !(b.x === tx && b.y === ty));
      tile.flags &= ~TILE_FLAG_EXTRA_VISUAL;
      ctx.dirty = true;
      broadcastTileUpdate(world, tx, ty, tile);
      OnTalkBubble(session, session.netId, isMailbox ? "`2Mailbox emptied.``" : "`2Text cleared.``", 0, false);
      return true;
    }

    if (btn.startsWith("edit") && isOwner) {
      const idxNum = Number.parseInt(btn.slice(4), 10);
      const list = world.bulletin.filter((b) => b.x === tx && b.y === ty);
      const target = list[idxNum - 1];
      if (target) {
        session.lastChoosenNr = idxNum;
        session.lastWrenchX = tx;
        session.lastWrenchY = ty;
        OnDialogRequest(
          session,
          `set_default_color|\`o\nadd_label_with_icon|small|Remove\`\` "\`w${target.text}"\`\` from your board?|left|${tile.fg}|\nend_dialog|remove_bulletin|Cancel|OK|`
        );
      }
      return true;
    }

    if (btn === "send") {
      const text = (kv.sign_text || "").replace(/[|\r\n]/g, "").trim();
      if (text.length <= 2 || text.length >= 100) {
        OnTalkBubble(session, session.netId, "That's not interesting enough to post.", 0, false);
        return true;
      }
      const settings = world.bulletinSettings.find((s) => s.x === tx && s.y === ty);
      const publicCanAdd = settings ? settings.publicCanAdd : true;
      if (!isOwner && !isMailbox && !publicCanAdd) return true;
      const existing = world.bulletin.filter((b) => b.x === tx && b.y === ty);
      if (!isOwner && existing.filter((b) => b.name === session.account.name).length >= 3) return true;
      if (existing.length >= 20) {
        const firstIdx = world.bulletin.findIndex((b) => b.x === tx && b.y === ty);
        if (firstIdx !== -1) world.bulletin.splice(firstIdx, 1);
      }
      world.bulletin.push({ x: tx, y: ty, name: session.account.name, text });
      if (isMailbox) tile.flags |= TILE_FLAG_EXTRA_VISUAL;
      ctx.dirty = true;
      broadcastTileUpdate(world, tx, ty, tile);
      OnTalkBubble(session, session.netId, isMailbox ? "`2You place your letter in the mailbox.``" : "`2Bulletin posted.``", 0, false);
      return true;
    }

    if (!isMailbox && isOwner && (kv.checkbox_locked !== undefined || kv.checkbox_hide !== undefined)) {
      let s = world.bulletinSettings.find((c) => c.x === tx && c.y === ty);
      if (!s) {
        s = { x: tx, y: ty, publicCanAdd: true, hideNames: false };
        world.bulletinSettings.push(s);
      }
      if (kv.checkbox_locked !== undefined) s.publicCanAdd = kv.checkbox_locked === "1";
      if (kv.checkbox_hide !== undefined) s.hideNames = kv.checkbox_hide === "1";
      ctx.dirty = true;
    }
    return true;
  }

  if (dlgName === "remove_bulletin" && validTile) {
    const idxNum = session.lastChoosenNr || 0;
    let count = 0;
    world.bulletin = (world.bulletin || []).filter((b) => {
      if (b.x !== tx || b.y !== ty) return true;
      count++;
      return count !== idxNum;
    });
    ctx.dirty = true;
    OnTalkBubble(session, session.netId, "`2Bulletin removed.``", 0, false);
    return true;
  }

  // --- Storage Box Xtreme & Safe Vault ---
  if (dlgName === "storageboxxtreme" && tile && STORAGE_BOX_IDS.has(tile.fg)) {
    if (!canAdminAccess(session, world, tile)) return true;
    world.storageItems = world.storageItems || [];
    const fgName = cleanName(ctx.itemsDb.get(tile.fg));

    if (kv.itemid) {
      const itemId = Number.parseInt(kv.itemid, 10);
      const def = ctx.itemsDb.get(itemId);
      const untradeableOnly = tile.fg === 4516;
      if (!untradeableOnly && isUntradeable(def)) {
        OnTalkBubble(session, session.netId, "You can't store Untradeable items there!", 0, false);
        return true;
      }
      if (untradeableOnly && !isUntradeable(def)) {
        OnTalkBubble(session, session.netId, "You can't store Tradeable items there!", 0, false);
        return true;
      }
      const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
      if (!slot) return true;
      session.lastChoosenItem = itemId;
      OnDialogRequest(
        session,
        `set_default_color|\`o\nadd_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|\nadd_textbox|You have ${slot.count} ${cleanName(def)}. How many to store?|left|\nadd_text_input|itemcount||${slot.count}|3|\nadd_spacer|small|\nadd_button|do_add|Store Items|noflags|0|0|\nend_dialog|storageboxxtreme|Cancel||`
      );
      return true;
    }

    if (btn === "do_add") {
      const itemId = session.lastChoosenItem || 0;
      const count = Number.parseInt(kv.itemcount || "0", 10);
      const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
      if (!slot || count <= 0 || count > slot.count) {
        OnTalkBubble(session, session.netId, "You don't have that many!", 0, false);
        return true;
      }
      const existing = world.storageItems.filter((s) => s.x === tx && s.y === ty);
      const mergeTarget = existing.find((s) => s.itemId === itemId && s.count + count <= 200);
      if (!mergeTarget && existing.length >= getStorageBoxCapacity(tile.fg)) {
        OnTalkBubble(session, session.netId, "Storage box is full!", 0, false);
        return true;
      }
      if (!ctx.consumeInventoryItem(session, itemId, count, true)) return true;
      if (mergeTarget) {
        mergeTarget.count += count;
      } else {
        world.storageItems.push({ x: tx, y: ty, itemId, count });
      }
      const iName = cleanName(ctx.itemsDb.get(itemId));
      OnTalkBubble(session, session.netId, `Stored \`w${count} ${iName}\`\` in ${fgName}.`, 0, false);
      OnConsoleMessage(session, `Stored \`w${count} ${iName}\`\` in the ${fgName}.`);
      ctx.dirty = true;
      renderStorageBoxDialog(ctx, session, world, tile, tx, ty);
      return true;
    }

    if (btn.startsWith("itm")) {
      const nr = Number.parseInt(btn.slice(3), 10);
      const list = world.storageItems.filter((s) => s.x === tx && s.y === ty);
      const entry = list[nr - 1];
      if (entry) {
        session.lastChoosenNr = nr;
        const iName = cleanName(ctx.itemsDb.get(entry.itemId));
        OnDialogRequest(
          session,
          `set_default_color|\`o\nadd_label_with_icon|big|\`w${fgName}\`\`|left|${tile.fg}|\nadd_textbox|You have \`w${entry.count} ${iName}\`\` stored.|left|\nadd_textbox|Withdraw how many?|left|\nadd_text_input|itemcount||${entry.count}|3|\nadd_spacer|small|\nadd_button|do_take|Remove Items|noflags|0|0|\nadd_button|cancel|Back|noflags|0|0|\nend_dialog|storageboxxtreme|Exit||`
        );
      }
      return true;
    }

    if (btn === "do_take") {
      const nr = session.lastChoosenNr || 0;
      const take = Number.parseInt(kv.itemcount || "0", 10);
      const list = world.storageItems.filter((s) => s.x === tx && s.y === ty);
      const entry = list[nr - 1];
      if (!entry || take <= 0 || take > entry.count) return true;
      if (!hasInvRoom(session, entry.itemId, take) || ctx.giveInventoryItem(session, entry.itemId, take, true) < take) {
        OnTalkBubble(session, session.netId, "You don't have enough room in your backpack!", 0, false);
        return true;
      }
      entry.count -= take;
      if (entry.count <= 0) {
        world.storageItems = world.storageItems.filter((s) => s !== entry);
      }
      const iName = cleanName(ctx.itemsDb.get(entry.itemId));
      sendFlyEffect(session, world, tx, ty, entry.itemId);
      OnTalkBubble(session, session.netId, `Removed \`w${take} ${iName}\`\` in ${fgName}.`, 0, true);
      OnConsoleMessage(session, `Removed \`w${take} ${iName}\`\` in the ${fgName}.`);
      ctx.dirty = true;
      return true;
    }

    if (btn === "cancel") {
      renderStorageBoxDialog(ctx, session, world, tile, tx, ty);
      return true;
    }

    if (btn === "change_password" && tile.fg === 8878) {
      OnDialogRequest(
        session,
        `set_default_color|\`o\nadd_label_with_icon|big|\`wSafe Vault\`\`|left|8878|\nembed_data|tilex|${tx}\nembed_data|tiley|${ty}\nadd_smalltext|Enter your \`2password\`\` and \`2recovery answer\`\` (max 12 alphanumeric characters).|left|\nadd_textbox|Enter a new password.|left|\nadd_text_input_password|storage_newpassword|||18|\nadd_textbox|Enter a recovery answer.|left|\nadd_text_input|storage_recoveryanswer|||12|\nadd_button|set_password|Update Password|noflags|0|0|\nend_dialog|storageboxpassword|Exit||\nadd_quick_exit|`
      );
      return true;
    }
    return true;
  }

  if (dlgName === "storageboxpassword" && tile && tile.fg === 8878) {
    if (!hasOwnerAccess(session, world, tile)) return true;
    if (tile.extra?.kind !== "storage") tile.extra = { kind: "storage" };
    if (btn === "set_password") {
      const pw = (kv.storage_newpassword || "").trim();
      const rec = (kv.storage_recoveryanswer || "").trim();
      if (!/^[A-Za-z0-9]{1,12}$/.test(pw) || !/^[A-Za-z0-9]{1,12}$/.test(rec)) {
        OnTalkBubble(session, session.netId, "`4Password & recovery answer must be 1-12 alphanumeric characters!``", 0, true);
        return true;
      }
      tile.extra.password = pw;
      tile.extra.recoveryAnswer = rec;
      ctx.dirty = true;
      OnTalkBubble(session, session.netId, "`2Your password has been updated!``", 0, true);
      return true;
    }
    if (btn === "check_password") {
      const pw = (kv.storage_password || "").trim();
      if (pw === (tile.extra.password || "")) {
        renderStorageBoxDialog(ctx, session, world, tile, tx, ty);
      } else {
        OnTalkBubble(session, session.netId, "`4The password you entered did not match!``", 0, true);
      }
      return true;
    }
    if (btn === "show_recoveryanswer") {
      OnDialogRequest(
        session,
        `set_default_color|\`o\nadd_label_with_icon|big|\`wSafe Vault\`\`|left|8878|\nembed_data|tilex|${tx}\nembed_data|tiley|${ty}\nadd_textbox|Enter your recovery answer to remove the password.|left|\nadd_text_input|recovery_input|||12|\nadd_button|verify_recovery|Recover|noflags|0|0|\nend_dialog|storageboxpassword|Exit||`
      );
      return true;
    }
    if (btn === "verify_recovery") {
      if ((kv.recovery_input || "").trim() === (tile.extra.recoveryAnswer || "") && tile.extra.recoveryAnswer) {
        tile.extra.password = "";
        ctx.dirty = true;
        OnTalkBubble(session, session.netId, "`2Password cleared! Opening Safe Vault.``", 0, true);
        renderStorageBoxDialog(ctx, session, world, tile, tx, ty);
      } else {
        OnTalkBubble(session, session.netId, "`4Recovery answer did not match!``", 0, true);
      }
      return true;
    }
    return true;
  }

  // --- Camera / CCTV ---
  if (dlgName === "camera_edit" && tile && CAMERA_IDS.has(tile.fg)) {
    if (!canAdminAccess(session, world, tile)) return true;
    world.cctvSettings = world.cctvSettings || [];
    let s = world.cctvSettings.find((c) => c.x === tx && c.y === ty);
    if (!s) {
      s = { x: tx, y: ty, showTaking: false, showDropping: false, showEnter: true, showExit: false, hideOwner: false, hideAdmins: false, hideNoAccess: false, showVend: false };
      world.cctvSettings.push(s);
    }
    if (btn === "clear") {
      world.cctvLogs = (world.cctvLogs || []).filter((l) => !(l.x === tx && l.y === ty));
      ctx.dirty = true;
      OnTalkBubble(session, session.netId, "`2Camera log cleared.``", 0, false);
      return true;
    }
    if (kv.checkbox_showpick !== undefined) s.showTaking = kv.checkbox_showpick === "1";
    if (kv.checkbox_itemdrop !== undefined) s.showDropping = kv.checkbox_itemdrop === "1";
    if (kv.checkbox_showenter !== undefined) s.showEnter = kv.checkbox_showenter === "1";
    if (kv.checkbox_showexit !== undefined) s.showExit = kv.checkbox_showexit === "1";
    if (kv.checkbox_noshowowner !== undefined) s.hideOwner = kv.checkbox_noshowowner === "1";
    if (kv.checkbox_noshowadmin !== undefined) s.hideAdmins = kv.checkbox_noshowadmin === "1";
    if (kv.checkbox_noshowother !== undefined) s.hideNoAccess = kv.checkbox_noshowother === "1";
    if (kv.checkbox_vendlogs !== undefined) s.showVend = kv.checkbox_vendlogs === "1";
    ctx.dirty = true;
    return true;
  }

  // --- Boombox & Switcheroo / Public Toggleables ---
  if ((dlgName === "boombox_edit" || dlgName === "switcheroo_edit") && tile) {
    if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) return true;
    if (kv.checkbox_public !== undefined) {
      if (kv.checkbox_public === "1") tile.flags |= TILE_FLAG_PUBLIC;
      else tile.flags &= ~TILE_FLAG_PUBLIC;
    }
    if (kv.checkbox_silence !== undefined) {
      if (kv.checkbox_silence === "1") tile.flags |= TILE_FLAG_HAS_WLS;
      else tile.flags &= ~TILE_FLAG_HAS_WLS;
    }
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    return true;
  }

  // --- Mannequin ---
  if (dlgName === "mannequin_edit" && tile && MANNEQUIN_IDS.has(tile.fg)) {
    if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) return true;
    if (tile.extra?.kind !== "mannequin") {
      tile.extra = { kind: "mannequin", label: "", skinColor: 0, hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, neck: 0 };
    }
    const mq = tile.extra;
    if (kv.put) {
      const putId = Number.parseInt(kv.put, 10);
      const def = ctx.itemsDb.get(putId);
      const field = def ? mannequinSlotField(def.actionType === 107 ? 9 : def.clothingType) : null;
      if (!def || !def.isClothing || isUntradeable(def) || !field || mq[field] === putId) return true;
      const oldId = mq[field];
      if (oldId !== 0 && (!hasInvRoom(session, oldId, 1) || ctx.giveInventoryItem(session, oldId, 1, true) === 0)) {
        OnTalkBubble(session, session.netId, "`5[`2You don't have inventory space!``]``", 0, false);
        return true;
      }
      if (!ctx.consumeInventoryItem(session, putId, 1, true)) return true;
      mq[field] = putId;
      mq.skinColor = session.account.skinColor;
      ctx.dirty = true;
      broadcastPositionedSfx(world, session.netId, "audio/change_clothes.wav");
      broadcastTileUpdate(world, tx, ty, tile);
      return true;
    }

    const clearAll = btn === "clear";
    const slotFields: Array<keyof Pick<MannequinExtra, "hair" | "shirt" | "pants" | "feet" | "face" | "hand" | "back" | "mask" | "neck">> = [
      "face", "shirt", "pants", "feet", "mask", "hand", "back", "hair", "neck",
    ];
    for (const f of slotFields) {
      const cid = mq[f];
      if (!cid) continue;
      if (clearAll || kv[`checkbox_${cid}`] === "1") {
        if (ctx.giveInventoryItem(session, cid, 1, true) > 0) {
          mq[f] = 0;
        } else {
          OnTalkBubble(session, session.netId, "`5[`2You don't have inventory space!``]``", 0, false);
          break;
        }
      }
    }
    if (kv.sign_text !== undefined) {
      mq.label = kv.sign_text.replace(/[|\r\n`%]/g, "").slice(0, 128);
    }
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    return true;
  }

  // --- Auto Action Block (Heart of Gaia / Tesseract Manipulator) ---
  if (dlgName === "autoactionblock" && tile && AUTO_ACTION_IDS.has(tile.fg)) {
    if (!hasOwnerAccess(session, world, tile)) return true;
    if (tile.extra?.kind !== "autoAction") tile.extra = { kind: "autoAction", fuel: 0, targetItemId: 0, enabled: false };
    const ex = tile.extra;
    if (kv.refillfuel && ex.fuel < 8000) {
      const req = Math.max(0, Number.parseInt(kv.refillfuel, 10) || 0);
      const add = Math.min(req, session.account.gems, 8000 - ex.fuel);
      if (add > 0) {
        session.account.gems -= add;
        ex.fuel += add;
        OnSetBux(session);
      }
    }
    if (kv.selecttarget) {
      const tid = Number.parseInt(kv.selecttarget, 10);
      if (tid > 0) ex.targetItemId = tid;
    }
    ex.enabled = ex.fuel > 0 && ex.targetItemId > 0;
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    return true;
  }

  // --- Food Grinder ---
  if (dlgName === "grinder" && tile && GRINDER_IDS.has(tile.fg)) {
    const itemId = session.lastChoosenItem || 0;
    const recipe = GTPS3_GRINDER_RECIPES[itemId];
    const times = Number.parseInt(kv.count || "0", 10);
    const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
    if (!recipe || !slot || times <= 0 || times * recipe.count > slot.count) return true;
    if (!ctx.consumeInventoryItem(session, itemId, times * recipe.count, true)) return true;

    const inName = cleanName(ctx.itemsDb.get(itemId));
    const outName = cleanName(ctx.itemsDb.get(recipe.prize));
    const msg = `Ground up ${times * recipe.count} ${inName} into ${times} ${outName}!`;
    OnConsoleMessage(session, msg);
    OnTalkBubble(session, session.netId, msg, 0, true);
    sendFlyEffect(session, world, tx, ty, recipe.prize);
    const pPkt = makeParticleEffectPacket(221, tx * 32 + 16, ty * 32 + 16, itemId, 221);
    session.peer.sendPacket(0, pPkt, true);

    if (!hasInvRoom(session, recipe.prize, times) || ctx.giveInventoryItem(session, recipe.prize, times, true) < times) {
      spawnOrMergeWorldDrop(world, recipe.prize, times, session.x, session.y, -1);
    }
    ctx.dirty = true;
    return true;
  }

  // --- Crystal Exchange ---
  if (dlgName === "crystal_exchange" && tile && CRYSTAL_IDS.has(tile.fg)) {
    if (!canModifyWorldTile(session, world, tile, tx, ty, "wrench")) return true;
    const targetId = Number.parseInt(btn, 10);
    if (!targetId) return true;
    if (tile.extra?.kind !== "crystal") return true;
    const counts: Record<number, number> = { 2242: 0, 2244: 0, 2246: 0, 2248: 0, 2250: 0, ...tile.extra.crystals };
    if (!counts[tile.fg]) counts[tile.fg] = 1;
    const recipe = GTPS3_CRYSTAL_RECIPES.find(
      (r) =>
        r.result[0] === targetId &&
        Object.entries(r.requirements).every(([cid, need]) => (counts[Number(cid)] || 0) >= need)
    );
    if (!recipe) return true;

    const pPkt = makeParticleEffectPacket(97, tx * 32 + 16, ty * 32 + 16, tile.fg, 97);
    for (const p of world.peers) p.peer.sendPacket(0, pPkt, true);
    OnTalkBubble(session, session.netId, `The crystal shatters and drops ${cleanName(ctx.itemsDb.get(recipe.result[0]))}!`, 0, true);
    spawnOrMergeWorldDrop(world, recipe.result[0], recipe.result[1], tx * 32 + 6, ty * 32 + 6, -1);
    tile.fg = 0;
    tile.extra = undefined;
    tile.flags = 0;
    tile.damage = 0;
    ctx.dirty = true;
    broadcastTileUpdate(world, tx, ty, tile);
    return true;
  }

  return false;
}
