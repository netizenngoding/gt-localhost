import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";

export function handleInfo(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const itemId = parseInt((kv.itemID || "0").trim(), 10);
  const def = ctx.itemsDb.get(itemId);
  if (!def || def.name.startsWith("null_")) return;

  const clean = stripGtColors(def.name);
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`wAbout ${clean}\`\``, def.id)
    .addSpacer("small")
    .addTextbox(`This is \`w${clean}\`\` (Item ID \`#${def.id}\`\`).`);

  if (def.rarity && def.rarity < 999) {
    dlg.addSmalltext(`\`9Rarity: \`w${def.rarity}\`\``);
  }
  if (def.isSeed) {
    const mins = Math.floor((def.growTime || 0) / 60);
    const secs = (def.growTime || 0) % 60;
    dlg.addSmalltext(`\`9Grow Time: \`w${mins > 0 ? `${mins}m ` : ""}${secs}s\`\``);
  }
  if (def.isClothing) {
    const slotNames = [
      "Hair / Hat",
      "Shirt",
      "Pants",
      "Shoes",
      "Face",
      "Hand",
      "Back / Wings",
      "Mask",
      "Necklace",
      "Ancestral / Artifact",
    ];
    dlg.addSmalltext(`\`9Clothing Slot: \`w${slotNames[def.clothingType] || `Slot ${def.clothingType}`}\`\``);
  }
  dlg.addQuickExit();
  OnDialogRequest(session, dlg.endDialog("item_info", "Close", ""));
}
