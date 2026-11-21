import { isSuperSupporter } from "../progression/service";
import { recycleValue } from "../progression/recycling";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { isUndestroyable } from "../database/items";
import { OnDialogRequest, OnPlayPositioned, OnTextOverlay } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";

// Dialog matches Gurotopia include/action/trash.cpp byte-for-byte:
//   label  "`4Recycle`` `w{item}``" (icon = item id)
//   body   "How many to `4destroy``? (you have {count})"
//   input  "count"  +  embed_data|itemID  ->  end_dialog|trash_item
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
  if (!def || isUndestroyable(def)) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTextOverlay(session, "You'd be sorry if you lost that!");
    return;
  }
  const name = stripGtColors(def.name);

  // Non-supporters still destroy but earn nothing; the dialog label is the
  // authentic Growtopia "Recycle" either way (Gurotopia trash.cpp).
  void isSuperSupporter;
  void recycleValue;

  const dialog = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`4Recycle\`\` \`w${name}\`\``, itemId)
    .addTextbox(`How many to \`4destroy\`\`? (you have ${slot.count})`)
    .addTextInput("count", "", String(slot.count), 5)
    .embedData("itemID", itemId)
    .endDialog("trash_item", "Cancel", "OK");

  OnDialogRequest(session, dialog);
}
