import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { isUntradeable } from "../database/items";
import { OnDialogRequest, OnPlayPositioned, OnTextOverlay } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";

export function handleDrop(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const itemId = parseInt((kv.itemID || "0").trim(), 10);
  if (!itemId || itemId === 18 || itemId === 32) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTextOverlay(session, "You'd be sorry if you lost that!");
    return;
  }
  const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!slot) return;

  const def = ctx.itemsDb.get(itemId);
  if (!def || isUntradeable(def)) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTextOverlay(session, "You can't drop that.");
    return;
  }

  const world = session.world;
  if (!world) return;

  // Check obstruction in front of player BEFORE opening dialog (matches GTPS3 Source.cpp:3501-3514)
  const playerTileX = Math.floor((session.x + 10) / 32);
  const playerTileY = Math.floor((session.y + 15) / 32);
  const targetTileX = Math.max(
    0,
    Math.min(world.width - 1, playerTileX + (session.facingLeft ? -1 : 1))
  );
  const targetTile = world.tiles[playerTileY * world.width + targetTileX];
  const targetFg = targetTile ? targetTile.fg : 0;
  const targetFgDef = targetFg ? ctx.itemsDb.get(targetFg) : undefined;

  if (targetFgDef) {
    const isSolid = targetFgDef.collisionType === 1;
    const isWhiteDoor = targetFg === 6 || targetFgDef.actionType === 13;
    const isEntrance = targetFgDef.isDoor || targetFgDef.actionType === 2 || targetFgDef.actionType === 13;
    const isClosedToggle = targetFgDef.actionType === 21 && (targetTile.flags & 0x0040) === 0;

    if (isSolid || isWhiteDoor || isEntrance || isClosedToggle) {
      OnPlayPositioned(session, "audio/punch_locked.wav");
      OnTextOverlay(
        session,
        isWhiteDoor
          ? "You can't drop items on the white door."
          : "You can't drop that here, face somewhere with open space."
      );
      return;
    }
  }

  const name = stripGtColors(def.name);

  const dialog = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`wDrop ${name}\`\``, itemId)
    .addTextbox("How many to drop?")
    .addTextInput("drop_count", "", String(slot.count), 5)
    .embedData("itemID", itemId)
    .endDialog("drop_item", "Cancel", "OK");

  OnDialogRequest(session, dialog);
}
