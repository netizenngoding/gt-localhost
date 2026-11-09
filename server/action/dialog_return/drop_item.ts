import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { spawnOrMergeWorldDrop } from "../../database/world";
import { OnPlayPositioned, OnTextOverlay } from "../../onVariant";

/**
 * Verified against ReGrowtopia-1.50.wasm Func #1737 (`World::HandleObjectChangePacket`):
 * - `spawnOrMergeWorldDrop` merges same-item ground stacks at the target tile up to 200 via `netId = -3`
 *   (e.g. 1 WL + 1 WL -> single 2 WL icon!) and overflows any remainder > 200 into a new stack (`netId = -1`).
 * - Both `netId = -1` and `netId = -3` natively trigger `audio/object_spawn2.wav` on the client!
 * - NO extra non-original server SFX (`audio/drop.wav`) is sent!
 */
export function handleDropItemReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const world = session.world;
  if (!world) return;
  if (kv.buttonClicked === "Cancel") return;

  const itemId = parseInt((kv.itemID || "0").trim(), 10);
  const rawAmt = parseInt((kv.drop_count || "").trim(), 10);
  if (!itemId || itemId === 18 || itemId === 32 || !Number.isFinite(rawAmt) || rawAmt <= 0) {
    return;
  }

  const amt = Math.min(200, rawAmt);
  const slot = session.account.inventory.find((s) => s.itemId === itemId);
  if (!slot || slot.count < amt) {
    OnTextOverlay(session, "`4You don't have that many!``");
    return;
  }

  // Check if target tile in front of player is solid wall (matches Gurotopia `drop_item.cpp`)
  const playerTileX = Math.floor((session.x + 10) / 32);
  const playerTileY = Math.floor((session.y + 15) / 32);
  const targetTileX = Math.max(
    1,
    Math.min(world.width - 2, playerTileX + (session.facingLeft ? -1 : 1))
  );
  const targetTile = world.tiles[playerTileY * world.width + targetTileX];
  const targetFgDef = targetTile && targetTile.fg ? ctx.itemsDb.get(targetTile.fg) : undefined;
  if (targetFgDef && targetFgDef.collisionType === 1) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTextOverlay(session, "You can't drop that here, face somewhere with open space.");
    return;
  }

  const dropX = targetTileX * 32 + 6;
  const dropY = playerTileY * 32 + 6;

  if (!ctx.consumeInventoryItem(session, itemId, amt, true)) return;

  spawnOrMergeWorldDrop(world, itemId, amt, dropX, dropY, session.netId);
  ctx.dirty = true;
}
