import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { broadcastSetClothing, OnConsoleMessage, OnTalkBubble, OnPlayPositioned, OnSetClothing } from "../onVariant";

/**
 * Verified against ReGrowtopia-1.50.wasm:
 * - `Func #4836` (inventory double-click): sends `PACKET_ITEM_ACTIVATE_REQUEST` (`type = 10`, `value = itemId`)
 *   for `actionType == 20 || 107` (all 10 clothing slots `0..9`, including Ancestrals!) AND convertible locks (`242`, `1796`, `7188`).
 * - `Func #4579` (`OnSetClothing`):
 *   - Loop 1 clears bit 0 on all previously worn `m_clothes[0..9]` in `PlayerItems`.
 *   - Loop 2 sets `m_clothes[0..9]` and XORs `invSlot->flags ^= 1` (`0 ^ 1 = 1`) for every currently worn item!
 *   - Therefore we NEVER resend `PACKET_SEND_INVENTORY_STATE` during `toggleWearable`, and we immediately persist
 *     via `ctx.savePlayersNow()` so equipped clothes survive world switches, refreshes, and server restarts 100%!
 */
export function toggleWearableItem(
  ctx: ServerContext,
  session: PlayerSession,
  itemId: number
): void {
  const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  const def = ctx.itemsDb.get(itemId);
  if (!slot || !def || !def.isClothing) return;

  const targetSlotIndex = def.actionType === 107 ? 9 : def.clothingType; // 0..9 (`actionType == 107` -> 9)
  const equipping = !slot.equipped;

  if (equipping) {
    for (const other of session.account.inventory) {
      if (other !== slot && other.equipped) {
        const otherDef = ctx.itemsDb.get(other.itemId);
        if (otherDef && otherDef.isClothing && (otherDef.actionType === 107 ? 9 : otherDef.clothingType) === targetSlotIndex) {
          other.equipped = false;
        }
      }
    }
  }

  slot.equipped = equipping;
  ctx.savePlayersNow();

  if (session.world) {
    broadcastSetClothing(session.world, session, ctx.itemsDb, true);
  } else {
    OnSetClothing(session, session, ctx.itemsDb, true);
  }
  ctx.sendCharacterState(session);
}

export function handleItemActivateRequest(
  ctx: ServerContext,
  session: PlayerSession,
  itemId: number
): void {
  const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!slot) return;

  // Authentic Growtopia / Gurotopia (`gamePacket/item_activate.cpp`) Lock Compression:
  // 100 WL (242) <-> 1 DL (1796), 100 DL (1796) <-> 1 BGL (7188)
  if (itemId === 242 && slot.count >= 100) {
    if (ctx.giveInventoryItem(session, 1796, 1, true) > 0) {
      ctx.consumeInventoryItem(session, 242, 100, true);
      OnPlayPositioned(session, "audio/use_lock.wav");
      const message = "You compressed 100 `2World Lock`` into a `2Diamond Lock``!";
      OnTalkBubble(session, session.netId, message, 0, true);
      OnConsoleMessage(session, message);
    }
    return;
  }

  if (itemId === 1796) {
    if (slot.count >= 100) {
      if (ctx.giveInventoryItem(session, 7188, 1, true) > 0) {
        ctx.consumeInventoryItem(session, 1796, 100, true);
        OnPlayPositioned(session, "audio/use_lock.wav");
        OnConsoleMessage(session, "Compressed `w100 Diamond Locks`` into `e1 Blue Gem Lock``!");
        return;
      }
    }
    const existingWl = session.account.inventory.find((s) => s.itemId === 242)?.count || 0;
    if (existingWl <= 100 && (existingWl > 0 || session.account.inventory.length < session.account.backpackSize)) {
      ctx.consumeInventoryItem(session, 1796, 1, true);
      ctx.giveInventoryItem(session, 242, 100, true);
      OnPlayPositioned(session, "audio/use_lock.wav");
      const message = "You shattered a `2Diamond Lock`` into 100 `2World Lock``!";
      OnTalkBubble(session, session.netId, message, 0, true);
      OnConsoleMessage(session, message);
    } else {
      OnConsoleMessage(session, "`4You can't hold 100 more World Locks right now!``");
    }
    return;
  }

  if (itemId === 7188) {
    const existingDl = session.account.inventory.find((s) => s.itemId === 1796)?.count || 0;
    if (existingDl <= 100 && (existingDl > 0 || session.account.inventory.length < session.account.backpackSize)) {
      ctx.consumeInventoryItem(session, 7188, 1, true);
      ctx.giveInventoryItem(session, 1796, 100, true);
      OnPlayPositioned(session, "audio/use_lock.wav");
      OnConsoleMessage(session, "Converted `e1 Blue Gem Lock`` into `w100 Diamond Locks``!");
    } else {
      OnConsoleMessage(session, "`4You can't hold 100 more Diamond Locks right now!``");
    }
    return;
  }

  toggleWearableItem(ctx, session, itemId);
}
