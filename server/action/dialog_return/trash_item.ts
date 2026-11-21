import { isSuperSupporter, recordProgress } from "../../progression/service";
import { recycleValue } from "../../progression/recycling";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { isUndestroyable } from "../../database/items";
import { OnConsoleMessage, OnPlayPositioned, OnSetBux, OnTextOverlay } from "../../onVariant";
import { stripGtColors } from "../../tools/string";

/**
 * Destroys items; Supporters receive audited store-item recycling refunds.
 * Message matches Gurotopia include/action/dialog_return/trash_item.cpp:
 *   "{count} `w{item}`` recycled, `w{gems}`` gems earned."
 * Plays audio/trash.wav (an original client asset) on every recycle.
 */
export function handleTrashItemReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  if (kv.buttonClicked === "Cancel") return;

  // Accept both the authentic "count" field (Gurotopia trash.cpp) and the
  // legacy "trash_count" key so old dialogs still parse.
  const rawAmt = (kv.count ?? kv.trash_count ?? "").trim();
  const rawId = (kv.itemID ?? "").trim();
  if (!/^\d+$/.test(rawId) || !/^\d+$/.test(rawAmt)) return;

  const itemId = parseInt(rawId, 10);
  const rawCount = parseInt(rawAmt, 10);
  if (!itemId || itemId === 18 || itemId === 32 || !Number.isFinite(rawCount) || rawCount <= 0) {
    return;
  }

  const definition = ctx.itemsDb.get(itemId);
  if (!definition || isUndestroyable(definition)) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTextOverlay(session, "You'd be sorry if you lost that!");
    return;
  }

  const amt = Math.min(200, rawCount);
  const slot = session.account.inventory.find((s) => s.itemId === itemId);
  if (!slot || slot.count < amt) return;

  if (!ctx.consumeInventoryItem(session, itemId, amt, true)) return;

  const reward = isSuperSupporter(session.account) ? recycleValue(itemId, amt) : 0;
  session.account.gems += reward;
  recordProgress(ctx, session, "items_trashed", amt);
  OnSetBux(session);

  const def = ctx.itemsDb.get(itemId);
  const name = def ? stripGtColors(def.name) : `Item #${itemId}`;

  // Gurotopia trash_item.cpp: "{count} `w{item}`` recycled, `w{gems}`` gems earned."
  OnConsoleMessage(session, `${amt} \`w${name}\`\` recycled, \`w${reward}\`\` gems earned.`);
  OnPlayPositioned(session, "audio/trash.wav");
}
