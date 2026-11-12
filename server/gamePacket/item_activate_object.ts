import { recordProgress } from "../progression/service";
import { logCctvEvent } from "../database/world";
import { makeItemCollectPacket, makeItemModifyObjectPacket } from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnPlayPositioned, OnSetBux } from "../onVariant";
import { stripGtColors } from "../tools/string";

const GEM_ITEM_ID = 112;

/**
 * Verified against ReGrowtopia-1.50.wasm Func #2766 @ 10420..10680 & Func #1737:
 * - Full pickup (`netId = session.netId`): client natively calls `PlayerItems::Add(itemId, count)`
 *   and plays `audio/object_collect.wav`! Do NOT also send `makeModifyInventoryPacket` on full pickup!
 * - Partial pickup (when inventory stack hits 200): shrinks ground stack in-place via `netId = -3`
 *   (`makeItemModifyObjectPacket`) and adds `canTake` via `giveInventoryItem(..., true)`.
 */
export function handleItemActivateObject(
  ctx: ServerContext,
  session: PlayerSession,
  uid: number
): void {
  const world = session.world;
  if (!world) return;

  const idx = world.objects.findIndex((o) => o.uid === uid);
  if (idx === -1) return;
  const obj = world.objects[idx];

  if (Math.hypot(session.x - obj.x, session.y - obj.y) > 160) return;

  // 1. Gems pickup
  if (obj.itemId === GEM_ITEM_ID) {
    world.objects.splice(idx, 1);
    session.account.gems += obj.count;
    recordProgress(ctx, session, undefined, 0);
    ctx.dirty = true;
    ctx.savePlayersNow();

    const collectPkt = makeItemCollectPacket(session.netId, obj.uid);
    for (const p of world.peers) p.peer.sendPacket(0, collectPkt, true);
    OnSetBux(session);
    return;
  }

  // 2. Inventory item pickup (up to 200 per stack)
  const existingSlot = session.account.inventory.find((s) => s.itemId === obj.itemId);
  let canTake = 0;
  if (existingSlot) {
    canTake = Math.max(0, 200 - existingSlot.count);
  } else if (session.account.inventory.length < session.account.backpackSize) {
    canTake = Math.min(200, obj.count);
  }
  if (canTake <= 0) return;

  const def = ctx.itemsDb.get(obj.itemId);
  const itemName = def ? stripGtColors(def.name) : `Item #${obj.itemId}`;

  // 2a. Partial stack pickup (ground stack has more than player can carry up to 200)
  if (canTake < obj.count) {
    obj.count -= canTake;
    ctx.giveInventoryItem(session, obj.itemId, canTake, true);
    ctx.dirty = true;

    const shrinkPkt = makeItemModifyObjectPacket(
      obj.uid,
      obj.itemId,
      obj.count,
      obj.x,
      obj.y,
      obj.flags
    );
    for (const p of world.peers) p.peer.sendPacket(0, shrinkPkt, true);
    OnPlayPositioned(session, "audio/object_collect.wav");
    OnConsoleMessage(session, `Collected \`w${canTake} ${itemName}\`\`.`);
    return;
  }

  // 2b. Full stack pickup
  const taken = obj.count;
  world.objects.splice(idx, 1);
  if (existingSlot) {
    existingSlot.count = Math.min(200, existingSlot.count + taken);
  } else {
    session.account.inventory.push({
      itemId: obj.itemId,
      count: Math.min(200, taken),
      equipped: false,
    });
  }
  ctx.dirty = true;
  ctx.savePlayersNow();

  const collectPkt = makeItemCollectPacket(session.netId, obj.uid);
  for (const p of world.peers) p.peer.sendPacket(0, collectPkt, true);
  logCctvEvent(world, session, "took", `${taken} ${itemName}`);
  OnConsoleMessage(session, `Collected \`w${taken} ${itemName}\`\`.`);
}
