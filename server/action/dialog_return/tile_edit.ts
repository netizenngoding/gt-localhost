import { worldDestination } from "../../database/world-policy";
import { makeSendLockPacket, makeTileUpdatePacket } from "../../proton/packet";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import {
  applyAreaLock,
  canModifyWorldTile,
  type WorldInstance,
  type XenoniteState,
} from "../../database/world";
import {
  broadcastConsoleMessage,
  broadcastNameChanged,
  broadcastPositionedSfx,
  broadcastSetCurrentWeather,
  OnConsoleMessage,
  OnDialogRequest,
  OnPlayPositioned,
  OnTalkBubble,
} from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";

export const LOCK_CONVERT_CHAIN: number[] = [242, 1796, 7188, 11550];

export function convertPlacedLock(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tx: number,
  ty: number
): void {
  const tile = world.tiles[ty * world.width + tx];
  const curId = tile.fg;
  const idx = LOCK_CONVERT_CHAIN.indexOf(curId);
  if (idx === -1) return;
  const existingStack = session.account.inventory.some(
    (s) => s.itemId === curId && s.count > 0 && s.count < 200
  );
  const usedSlots = session.account.inventory.filter((s) => s.count > 0).length;
  if (!existingStack && usedSlots >= session.account.backpackSize) {
    OnConsoleMessage(session, "`4You don't have enough room in your backpack!``");
    return;
  }
  const nextId = LOCK_CONVERT_CHAIN[(idx + 1) % LOCK_CONVERT_CHAIN.length];
  ctx.giveInventoryItem(session, curId, 1, true);
  tile.fg = nextId;
  tile.extra = {
    kind: "lock",
    settings: tile.extra?.kind === "lock" ? tile.extra.settings : 0,
    ownerUserId: session.account.userId,
    adminIds: tile.extra?.kind === "lock" ? tile.extra.adminIds : [],
  };
  if (nextId === 242 || nextId === 1796 || nextId === 7188 || nextId === 11550) {
    world.ownerUserId = session.account.userId;
  }
  ctx.dirty = true;
  const upd = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, upd, true);
  broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
  OnConsoleMessage(
    session,
    `\`2Lock converted to \`w${ctx.itemsDb.get(nextId)?.name || "Lock"}\`\`!`
  );
}

export function openDoorSettingsDialog(session: PlayerSession, tx: number, ty: number): void {
  if (!session.world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const tile = session.world.tiles[ty * session.world.width + tx];
  if (tile.fg === 6) { session.pendingEditTile = null; OnConsoleMessage(session, "The Main Door always exits the world."); return; }
  const dest = tile.extra?.kind === "door" ? tile.extra.destination : "";
  const label = tile.extra?.kind === "door" ? tile.extra.label : "";

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wEdit Door``", tile.fg || 6)
    .addTextInput("door_dest", "Destination World:", dest, 24)
    .addTextInput("door_label", "Label:", label, 60)
    .endDialog("door_settings", "Cancel", "Apply");

  OnDialogRequest(session, dlg);
}

export function openSignEditDialog(session: PlayerSession, tx: number, ty: number): void {
  if (!session.world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const tile = session.world.tiles[ty * session.world.width + tx];
  const label = tile.extra?.kind === "sign" ? tile.extra.label : "";

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wEdit Sign``", tile.fg || 20)
    .addTextInput("tile_label", "Sign Text:", label.replace(/\|/g, ""), 100)
    .endDialog("save_tile_label", "Cancel", "Apply");

  OnDialogRequest(session, dlg);
}

export function openWeatherPickerDialog(
  session: PlayerSession,
  tx: number,
  ty: number,
  ctx?: ServerContext
): void {
  if (!session.world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const tile = session.world.tiles[ty * session.world.width + tx];
  const fg = tile?.fg || 0;

  if (fg === 3694) {
    const cur = tile.extra?.kind === "weatherBg" ? tile.extra : { r: 255, g: 120, b: 40 };
    const dlg = [
      "set_default_color|`o",
      `add_label_with_icon|big|\`wWeather Machine - Heatwave\`\`|left|3694|`,
      "add_spacer|small|",
      `embed_data|tilex|${tx}`,
      `embed_data|tiley|${ty}`,
      "add_textbox|Adjust the color of your heat wave here, by including 0-255 of Red, Green, and Blue.|left|",
      `add_text_input|red|Red|${cur.r ?? 255}|3|`,
      `add_text_input|green|Green|${cur.g ?? 120}|3|`,
      `add_text_input|blue|Blue|${cur.b ?? 40}|3|`,
      "end_dialog|weatherspcl|Cancel|Okay|",
    ].join("\n");
    OnDialogRequest(session, dlg);
    return;
  }

  if (fg === 5000 || fg === 3832) {
    const itemId =
      fg === 5000
        ? tile.extra?.kind === "weatherBg" && tile.extra.itemId
          ? tile.extra.itemId
          : 14
        : tile.extra?.kind === "weatherStuff" && tile.extra.itemId
        ? tile.extra.itemId
        : 2;
    const itemName = stripGtColors(ctx?.itemsDb.get(itemId)?.name || (fg === 5000 ? "Cave Background" : "Dirt"));
    const lines = [
      "set_default_color|`o",
      `add_label_with_icon|big|\`w${fg === 5000 ? "Weather Machine - Background" : "Weather Machine - Stuff"}\`\`|left|${fg}|`,
      "add_spacer|small|",
      `embed_data|tilex|${tx}`,
      `embed_data|tiley|${ty}`,
    ];
    if (fg === 5000) {
      lines.push("add_textbox|You can scan any Background Block to set it up in your weather machine.|left|");
      lines.push(`add_item_picker|choose|Item: \`2${itemName}\`\`|Select any Background Block|`);
    } else {
      const ws = tile.extra?.kind === "weatherStuff" ? tile.extra : { gravity: 50, spin: false, invert: false };
      lines.push(`add_item_picker|choose|Item: \`2${itemName}\`\`|Select any item to rain down|`);
      lines.push(`add_text_input|gravity|Gravity:|${ws.gravity ?? 50}|5|`);
      lines.push(`add_checkbox|spin|Spin Items|${ws.spin ? "1" : "0"}`);
      lines.push(`add_checkbox|invert|Invert Sky Colors|${ws.invert ? "1" : "0"}`);
    }
    lines.push("end_dialog|weatherspcl|Cancel|Okay|");
    OnDialogRequest(session, lines.join("\n"));
    return;
  }

  const wId = session.world.weatherId;
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wWeather Machine``", fg || 932)
    .addTextbox(`\`9Current World Weather ID: \`2#${wId}\`\``)
    .addTextInput("weather_id", "Weather ID (0-85):", String(wId), 4)
    .endDialog("weather_picker", "Cancel", "Apply");

  OnDialogRequest(session, dlg);
}

export function openXenoniteDialog(
  ctx: ServerContext,
  session: PlayerSession,
  tx: number,
  ty: number
): void {
  const world = session.world;
  if (!world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const x = world.xenonite || {
    enabled: true,
    doubleJump: 0,
    highJump: 0,
    heatResist: 0,
    strongPunch: 0,
    longPunch: 0,
    longBuild: 0,
    speedy: 0,
    powerups: 0,
  };
  const dlg = [
    "set_default_color|`o",
    "add_label_with_icon|big|`wXenonite Crystal``|left|2072|",
    "add_textbox|This crystal can either grant or block super powers for all players in your world! Any power that's unchecked will work as normal - people will have the power if they equip an item with it.|left|",
    "add_spacer|small|",
    `embed_data|tilex|${tx}`,
    `embed_data|tiley|${ty}`,
    `add_checkbox|checkbox_force_dbl|Force Double Jump|${x.doubleJump === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_dbl|Block Double Jump|${x.doubleJump === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_hig|Force High Jump|${x.highJump === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_hig|Block High Jump|${x.highJump === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_asb|Force Heat Resist|${x.heatResist === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_asb|Block Heat Resist|${x.heatResist === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_pun|Force Strong Punch|${x.strongPunch === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_pun|Block Strong Punch|${x.strongPunch === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_lng|Force Long Punch|${x.longPunch === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_lng|Block Long Punch|${x.longPunch === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_spd|Force Speedy|${x.speedy === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_spd|Block Speedy|${x.speedy === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_force_lngb|Force Long Build|${x.longBuild === 1 ? 1 : 0}`,
    `add_checkbox|checkbox_block_lngb|Block Long Build|${x.longBuild === 2 ? 1 : 0}`,
    "add_spacer|small|",
    `add_checkbox|checkbox_block_pwr|Block Use of Powerups|${x.powerups === 1 ? 1 : 0}`,
    "end_dialog|xenonite_edit|Cancel|Update|",
  ].join("\n");
  void ctx;
  OnDialogRequest(session, dlg);
}

export function openLockSettingsDialog(
  ctx: ServerContext,
  session: PlayerSession,
  tx: number,
  ty: number
): void {
  if (!session.world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const tile = session.world.tiles[ty * session.world.width + tx];
  if (tile.extra?.kind !== "lock") return;

  const lock = tile.extra;
  const name = stripGtColors(ctx.itemsDb.get(tile.fg)?.name || "Lock");
  const isOwnerOrDev = lock.ownerUserId === session.account.userId || session.account.rank === "developer";
  const isAdmin = lock.adminIds.includes(session.account.userId);
  if (!isOwnerOrDev && !isAdmin) {
    session.pendingEditTile = null;
    return;
  }

  // Non-owner admin gets "Remove My Access" only (GTPS3 World.h:15957)
  if (!isOwnerOrDev && isAdmin) {
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`w" + name + "``", tile.fg || 242)
      .raw(`embed_data|tilex|${tx}\nembed_data|tiley|${ty}\nadd_spacer|small|\n`)
      .addTextbox("You currently have access to this lock.")
      .raw("add_button|removeaccess|`wRemove My Access``|noflags|0|0|\n")
      .endDialog("lock_edit", "Cancel", "");
    OnDialogRequest(session, dlg);
    return;
  }

  const isAreaLock = tile.fg === 202 || tile.fg === 204 || tile.fg === 206 || tile.fg === 4994;
  const dlgBuilder = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wEdit " + name + "``", tile.fg || 242)
    .raw("add_popup_name|LockEdit|\nadd_label|small|`wAccess list:``|left\n")
    .raw(`embed_data|tilex|${tx}\nembed_data|tiley|${ty}\nadd_spacer|small|\n`);
  if (!lock.adminIds.length) {
    dlgBuilder.raw("add_label|small|Currently, you're the only one with access.``|left\n");
  }
  for (const id of lock.adminIds) {
    const account = ctx.findAccountByUserId(id);
    dlgBuilder.raw(`add_checkbox|acc_${id}|${(account?.name || String(id)).replace(/[|\r\n]/g, " ")}|1|\n`);
  }
  dlgBuilder.raw("add_spacer|small|\nadd_player_picker|playerNetID|`wAdd``|\n");
  const pubLabel = tile.fg === 4994 ? "Allow anyone to Build or Break" : "Allow anyone to Build and Break";
  dlgBuilder.raw(`add_checkbox|checkbox_public|${pubLabel}|${(lock.settings & 128) ? 1 : 0}|\n`);

  if (isAreaLock) {
    dlgBuilder
      .raw(`add_checkbox|checkbox_ignore|Ignore empty air|${lock.emptyAir ? 1 : 0}|\n`)
      .raw("add_button|recalcLock|`wRe-apply lock``|noflags|0|0|\n");
    if (tile.fg === 4994) {
      dlgBuilder
        .raw("add_spacer|small|\nadd_smalltext|This lock allows Building or Breaking.|left|\nadd_smalltext|(ONLY if 'Allow anyone to Build or Break' is checked above)!|left|\nadd_spacer|small|\nadd_smalltext|Leaving this box unchecked only allows Breaking.|left|\n")
        .raw(`add_checkbox|checkbox_buildonly|Only Allow Building!|${lock.buildOnly ? 1 : 0}|\n`)
        .raw("add_smalltext|People with lock access can both build and break unless you check below. The lock owner can always build and break.|left|\n")
        .raw(`add_checkbox|checkbox_admins|Admins Are Limited|${lock.limitAdmins ? 1 : 0}|\n`);
    }
  }
  // Shatter & Lock Upgrade UI intentionally omitted per design.
  const dlg = dlgBuilder.endDialog("lock_edit", "Cancel", "OK");
  OnDialogRequest(session, dlg);
}

export function handleTileEditDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  dlgName: string,
  kv: Record<string, string>
): boolean {
  if (!session.pendingEditTile || !session.world) return false;

  if (
    dlgName !== "save_tile_label" &&
    dlgName !== "door_settings" &&
    dlgName !== "weather_picker" &&
    dlgName !== "weatherspcl" &&
    dlgName !== "xenonite_edit" &&
    dlgName !== "lock_settings" &&
    dlgName !== "lock_edit"
  ) {
    return false;
  }

  const fallback = session.pendingEditTile;
  const x = kv.tilex !== undefined ? parseInt(kv.tilex, 10) : fallback.x;
  const y = kv.tiley !== undefined ? parseInt(kv.tiley, 10) : fallback.y;
  session.pendingEditTile = null;
  if (kv.buttonClicked === "Cancel") return true;

  const world = session.world;
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return true;
  const tile = world.tiles[y * world.width + x];
  if (!tile) return true;

  if (dlgName === "save_tile_label") {
    if (tile.extra?.kind === "sign" && canModifyWorldTile(session, world, tile, x, y, "wrench")) {
      tile.extra.label = (kv.tile_label || "").replace(/\|/g, "").slice(0, 120);
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(x, y, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    }
    return true;
  }

  if (dlgName === "door_settings") {
    if (tile.extra?.kind === "door" && canModifyWorldTile(session, world, tile, x, y, "wrench")) {
      if (tile.fg === 6) { OnConsoleMessage(session, "The Main Door always exits the world."); return true; }
      const dest = worldDestination(kv.door_dest || "");
      if (dest.kind === "invalid") { OnConsoleMessage(session, dest.reason); return true; }
      tile.extra.destination = dest.kind === "exit" ? "EXIT" : dest.name;
      if (kv.door_label !== undefined) {
        tile.extra.label = kv.door_label.replace(/\|/g, "").slice(0, 60);
      }
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(x, y, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      OnConsoleMessage(
        session,
        `\`2Door destination set to \`w${tile.extra.destination || "(EXIT)"}\`\`!`
      );
    }
    return true;
  }

  if (dlgName === "weatherspcl") {
    if (!canModifyWorldTile(session, world, tile, x, y, "wrench")) return true;
    if (tile.fg === 3694) {
      const r = Math.max(0, Math.min(255, parseInt((kv.red || "0").trim(), 10) || 0));
      const g = Math.max(0, Math.min(255, parseInt((kv.green || "0").trim(), 10) || 0));
      const b = Math.max(0, Math.min(255, parseInt((kv.blue || "0").trim(), 10) || 0));
      if (r < 40 && g < 40 && b < 40) {
        OnTalkBubble(session, session.netId, "You can't make a heatwave that dark (one of the colors must be 40+)!", 0, true);
        return true;
      }
      tile.extra = { kind: "weatherBg", itemId: 14, r, g, b };
    } else if (tile.fg === 5000) {
      const picked = parseInt((kv.choose || "14").trim(), 10);
      if (Number.isFinite(picked) && ctx.itemsDb.get(picked)) {
        tile.extra = { kind: "weatherBg", itemId: picked };
      }
    } else if (tile.fg === 3832) {
      const prev = tile.extra?.kind === "weatherStuff" ? tile.extra : { itemId: 2, gravity: 50, spin: false, invert: false };
      const picked = kv.choose !== undefined ? parseInt(kv.choose.trim(), 10) : prev.itemId;
      const nextItem = Number.isFinite(picked) && ctx.itemsDb.get(picked) ? picked : prev.itemId || 2;
      const rawGrav = kv.gravity !== undefined ? parseInt(kv.gravity.trim(), 10) : (prev.gravity ?? 50);
      const gravity = Number.isFinite(rawGrav) ? Math.max(-500, Math.min(500, rawGrav)) : (prev.gravity ?? 50);
      const spin = kv.spin !== undefined ? kv.spin === "1" : Boolean(prev.spin);
      const invert = kv.invert !== undefined ? kv.invert === "1" : Boolean(prev.invert);
      tile.extra = { kind: "weatherStuff", itemId: nextItem, gravity, spin, invert };
    } else {
      return true;
    }
    ctx.dirty = true;
    const upd = makeTileUpdatePacket(x, y, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
    return true;
  }

  if (dlgName === "weather_picker") {
    if (canModifyWorldTile(session, world, tile, x, y, "wrench")) {
      const wId = Math.max(0, Math.min(85, parseInt((kv.weather_id || "0").trim(), 10) || 0));
      world.weatherId = wId;
      ctx.dirty = true;
      broadcastSetCurrentWeather(world, wId);
      broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
      OnConsoleMessage(session, `\`2Weather set to #${wId}!\`\``);
    }
    return true;
  }

  if (dlgName === "xenonite_edit") {
    if (tile.fg !== 2072 || !canModifyWorldTile(session, world, tile, x, y, "wrench")) return true;
    const readPower = (forceKey: string, blockKey: string): number | null => {
      const f = kv[forceKey] === "1";
      const b = kv[blockKey] === "1";
      if (f && b) return null;
      return f ? 1 : b ? 2 : 0;
    };
    const doubleJump = readPower("checkbox_force_dbl", "checkbox_block_dbl");
    const highJump = readPower("checkbox_force_hig", "checkbox_block_hig");
    const heatResist = readPower("checkbox_force_asb", "checkbox_block_asb");
    const strongPunch = readPower("checkbox_force_pun", "checkbox_block_pun");
    const longPunch = readPower("checkbox_force_lng", "checkbox_block_lng");
    const speedy = readPower("checkbox_force_spd", "checkbox_block_spd");
    const longBuild = readPower("checkbox_force_lngb", "checkbox_block_lngb");
    const powerups = kv.checkbox_block_pwr === "1" ? 1 : 0;
    if (
      doubleJump === null ||
      highJump === null ||
      heatResist === null ||
      strongPunch === null ||
      longPunch === null ||
      speedy === null ||
      longBuild === null
    ) {
      OnTalkBubble(session, session.netId, "You can't force and block the same power!", 0, true);
      return true;
    }
    const nextXeno: XenoniteState = {
      enabled: true,
      doubleJump,
      highJump,
      heatResist,
      strongPunch,
      longPunch,
      longBuild,
      speedy,
      powerups,
    };
    world.xenonite = nextXeno;
    ctx.dirty = true;
    for (const p of world.peers) {
      ctx.sendCharacterState(p);
      OnTalkBubble(p, p.netId, "Xenonite has changed everyone's powers!", 0, true);
      OnConsoleMessage(p, "`5Xenonite has changed everyone's powers!``");
    }
    broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    return true;
  }

  if (dlgName === "lock_settings" || dlgName === "lock_edit") {
    if (tile.extra?.kind !== "lock") return true;
    const lock = tile.extra;
    const btn = kv.buttonClicked || "";
    const isOwnerOrDev = lock.ownerUserId === session.account.userId || session.account.rank === "developer";

    // Self-removal from admin list ("Remove My Access")
    if (btn === "removeaccess") {
      if (lock.adminIds.includes(session.account.userId)) {
        lock.adminIds = lock.adminIds.filter((id) => id !== session.account.userId);
        ctx.dirty = true;
        ctx.savePersistentState();
        OnPlayPositioned(session, "audio/dialog_cancel.wav");
        OnTalkBubble(session, session.netId, "I've removed my access!", 0, true);
        const lockName = stripGtColors(ctx.itemsDb.get(tile.fg)?.name || "Lock");
        broadcastConsoleMessage(world, `${session.account.name} removed their access from a ${lockName}`);
        broadcastNameChanged(session);
        const upd = makeTileUpdatePacket(x, y, tile, Date.now());
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      }
      return true;
    }

    if (!isOwnerOrDev) return true;

    if (dlgName === "lock_edit") {
      lock.adminIds = lock.adminIds.filter((id) => kv[`acc_${id}`] !== "0");
      if (kv.checkbox_public !== undefined) {
        lock.settings = kv.checkbox_public === "1" ? lock.settings | 128 : lock.settings & ~128;
      }
      if (kv.checkbox_ignore !== undefined) {
        lock.emptyAir = kv.checkbox_ignore === "1";
      }
      if (tile.fg === 4994) {
        if (kv.checkbox_buildonly !== undefined) lock.buildOnly = kv.checkbox_buildonly === "1";
        if (kv.checkbox_admins !== undefined) lock.limitAdmins = kv.checkbox_admins === "1";
      }
      const netId = Number(kv.playerNetID);
      const target = [...world.peers].find((p) => p.netId === netId);
      if (target && target.account.userId !== lock.ownerUserId && !lock.adminIds.includes(target.account.userId)) {
        lock.adminIds.push(target.account.userId);
      }
      if (btn === "recalcLock" && (tile.fg === 202 || tile.fg === 204 || tile.fg === 206 || tile.fg === 4994)) {
        const lockedIndices = applyAreaLock(world, x, y);
        const lockPkt = makeSendLockPacket(lock.ownerUserId, tile.fg, x, y, lockedIndices);
        for (const p of world.peers) p.peer.sendPacket(0, lockPkt, true);
        broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
      }
      ctx.dirty = true;
      ctx.savePersistentState();
      const upd = makeTileUpdatePacket(x, y, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      return true;
    }

    const adminName = (kv.lock_admin || "").trim();
    if (adminName) {
      const target = ctx.accounts.get(adminName.toLowerCase());
      if (target) {
        if (!tile.extra.adminIds.includes(target.userId)) {
          tile.extra.adminIds.push(target.userId);
        }
        ctx.dirty = true;
        OnConsoleMessage(session, `\`2Added \`w${target.name}\`2 to lock access!\`\``);
      } else {
        OnConsoleMessage(session, "`4Account not found!``");
      }
    }
    const upd = makeTileUpdatePacket(x, y, tile, Date.now());
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    return true;
  }

  return false;
}
