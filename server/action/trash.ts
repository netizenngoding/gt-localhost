import { isSuperSupporter } from "../progression/service";
import { recycleValue } from "../progression/recycling";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnDialogRequest, OnPlayPositioned, OnTextOverlay } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";

export function handleTrash(
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
  const name = def ? stripGtColors(def.name) : `Item #${itemId}`;

  const supporter = isSuperSupporter(session.account);
  const dialog = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`4${supporter ? "Recycle" : "Trash"}\`\` \`w${name}\`\``, itemId)
    .addTextbox(`How many to destroy? (no undo${supporter ? ", " + recycleValue(itemId, 1) + " Gems per item" : ""})`)
    .addTextInput("trash_count", "", String(slot.count), 5)
    .embedData("itemID", itemId)
    .endDialog("trash_item", "Cancel", "OK");

  OnDialogRequest(session, dialog);
}
