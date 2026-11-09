import { worldDestination } from "../../database/world-policy";
import { makeTileUpdatePacket } from "../../proton/packet";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { canModifyWorldTile, type WorldInstance } from "../../database/world";
import {
  broadcastConsoleMessage,
  broadcastPositionedSfx,
  broadcastSetCurrentWeather,
  OnConsoleMessage,
  OnDialogRequest,
} from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";

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
  const nextId = LOCK_CONVERT_CHAIN[(idx + 1) % LOCK_CONVERT_CHAIN.length];
  ctx.giveInventoryItem(session, curId, 1, true);
  tile.fg = nextId;
  tile.extra = {
    kind: "lock",
    settings: 0,
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

export function openWeatherPickerDialog(session: PlayerSession, tx: number, ty: number): void {
  if (!session.world) return;
  session.pendingEditTile = { x: tx, y: ty };
  const wId = session.world.weatherId;

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wWeather Machine``", 932)
    .addTextbox(`\`9Current World Weather ID: \`2#${wId}\`\``)
    .addTextInput("weather_id", "Weather ID (0-60):", String(wId), 4)
    .endDialog("weather_picker", "Cancel", "Apply");

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
  const owner = ctx.findAccountByUserId(tile.extra.ownerUserId);

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wEdit Lock``", tile.fg || 242)
    .addTextbox(`\`9Owner: \`w${owner ? owner.name : "Unknown"}\`\``)
    .addTextInput("lock_admin", "Add Access (Name):", "", 18)
    .addButtonWithIcon("lock_convert", "`2Cycle Lock Tier``", tile.fg || 242)
    .addButtonWithIcon("lock_remove", "`4Reclaim Lock``", 32, "staticRedFrame")
    .endDialog("lock_settings", "Cancel", "Apply");

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
    dlgName !== "lock_settings"
  ) {
    return false;
  }

  const { x, y } = session.pendingEditTile;
  session.pendingEditTile = null;
  if (kv.buttonClicked === "Cancel") return true;

  const world = session.world;
  const tile = world.tiles[y * world.width + x];
  if (!tile) return true;

  if (dlgName === "save_tile_label") {
    if (tile.extra?.kind === "sign" && canModifyWorldTile(session, world, tile)) {
      tile.extra.label = (kv.tile_label || "").replace(/\|/g, "").slice(0, 120);
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(x, y, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
    }
    return true;
  }

  if (dlgName === "door_settings") {
    if (tile.extra?.kind === "door" && canModifyWorldTile(session, world, tile)) {
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

  if (dlgName === "weather_picker") {
    if (canModifyWorldTile(session, world, tile)) {
      const wId = Math.max(0, Math.min(60, parseInt((kv.weather_id || "0").trim(), 10) || 0));
      world.weatherId = wId;
      ctx.dirty = true;
      broadcastSetCurrentWeather(world, wId);
      broadcastPositionedSfx(world, session.netId, "audio/switch.wav");
      OnConsoleMessage(session, `\`2Weather set to #${wId}!\`\``);
    }
    return true;
  }

  if (dlgName === "lock_settings") {
    if (tile.extra?.kind !== "lock" || tile.extra.ownerUserId !== session.account.userId) {
      return true;
    }
    const btn = kv.buttonClicked || "";
    if (btn === "lock_convert") {
      convertPlacedLock(ctx, session, world, x, y);
      return true;
    }
    if (btn === "lock_remove") {
      const lockId = tile.fg;
      tile.fg = 0;
      tile.extra = undefined;
      ctx.giveInventoryItem(session, lockId, 1, true);
      if (world.ownerUserId === session.account.userId) {
        world.ownerUserId = 0;
      }
      ctx.dirty = true;
      const upd = makeTileUpdatePacket(x, y, tile, Date.now());
      for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      broadcastConsoleMessage(world, `\`5World \`w${world.name}\`5 is no longer locked!\`\``);
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
