import { isSuperSupporter, recordProgress } from "../../progression/service";
import { recycleValue } from "../../progression/recycling";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { OnConsoleMessage, OnSetBux } from "../../onVariant";
import { stripGtColors } from "../../tools/string";

/**
 * Destroys items; Supporters receive audited store-item recycling refunds.
 * Keeps audio 100% clean (no non-original `audio/trash.wav`).
 */
export function handleTrashItemReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  if (kv.buttonClicked === "Cancel") return;

  if (!/^\d+$/.test(kv.itemID || "") || !/^\d+$/.test(kv.trash_count || "")) return;
  const itemId = parseInt((kv.itemID || "0").trim(), 10);
  const rawAmt = parseInt((kv.trash_count || "").trim(), 10);
  if (!itemId || itemId === 18 || itemId === 32 || !Number.isFinite(rawAmt) || rawAmt <= 0) {
    return;
  }

  const amt = Math.min(200, rawAmt);
  const slot = session.account.inventory.find((s) => s.itemId === itemId);
  if (!slot || slot.count < amt) return;

  const definition = ctx.itemsDb.get(itemId);
  if (!definition || (definition.flags & 0x80) !== 0) return;
  if (!ctx.consumeInventoryItem(session, itemId, amt, true)) return;

  const reward = isSuperSupporter(session.account) ? recycleValue(itemId, amt) : 0;
  session.account.gems += reward;
  recordProgress(ctx, session, "items_trashed", amt);
  OnSetBux(session);

  const def = ctx.itemsDb.get(itemId);
  const name = def ? stripGtColors(def.name) : `Item #${itemId}`;
  OnConsoleMessage(
    session,
    `\`4${amt} \`w${name}\`4 recycled for \`2+${reward} Gems\`4.\`\``
  );
}
