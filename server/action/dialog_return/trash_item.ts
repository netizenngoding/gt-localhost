import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { OnConsoleMessage, OnSetBux } from "../../onVariant";
import { stripGtColors } from "../../tools/string";

/**
 * Destroys items from inventory with +2 Gems recycling bonus.
 * Keeps audio 100% clean (no non-original `audio/trash.wav`).
 */
export function handleTrashItemReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  if (kv.buttonClicked === "Cancel") return;

  const itemId = parseInt((kv.itemID || "0").trim(), 10);
  const rawAmt = parseInt((kv.trash_count || "").trim(), 10);
  if (!itemId || itemId === 18 || itemId === 32 || !Number.isFinite(rawAmt) || rawAmt <= 0) {
    return;
  }

  const amt = Math.min(200, rawAmt);
  const slot = session.account.inventory.find((s) => s.itemId === itemId);
  if (!slot || slot.count < amt) return;

  if (!ctx.consumeInventoryItem(session, itemId, amt, true)) return;

  const reward = amt * 2;
  session.account.gems += reward;
  ctx.savePlayersNow();
  OnSetBux(session);

  const def = ctx.itemsDb.get(itemId);
  const name = def ? stripGtColors(def.name) : `Item #${itemId}`;
  OnConsoleMessage(
    session,
    `\`4${amt} \`w${name}\`4 recycled for \`2+${reward} Gems\`4.\`\``
  );
}
