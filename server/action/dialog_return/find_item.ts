import { SERVER_NAME } from "../../config/branding";
import { hasPermission } from "../../ranks";
import type { ServerContext } from "../../database/context";
import type { ItemDef } from "../../database/items";
import type { PlayerSession } from "../../database/peer";
import { OnConsoleMessage, OnDialogRequest, OnPlayPositioned } from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";

const DEFAULT_FIND_SHOWCASE = [
  242, 1796, 7188, 48, 1460, 3104, 1784, 5480,
  10424, 11478, 14086, 5638, 100, 101, 16, 17, 12, 20,
];

export function openItemFinderDialog(
  ctx: ServerContext,
  session: PlayerSession,
  query: string
): void {
  const q = query.trim();
  session.lastItemSearchQuery = q;

  const matches: ItemDef[] = q
    ? ctx.itemsDb.search(q, 32)
    : DEFAULT_FIND_SHOWCASE
        .map((id) => ctx.itemsDb.get(id))
        .filter((d): d is ItemDef => d !== undefined);

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${SERVER_NAME} Item Finder\`\``, 6016)
    .addTextbox(`Search ${ctx.itemsDb.items.size} enabled reference items:`)
    .addTextInput("search_q", "Item name or ID:", q.replace(/\|/g, ""), 40)
    .addSpacer("small");

  if (matches.length > 0) {
    for (const m of matches) {
      dlg.addButtonWithIcon(
        `claim_${m.id}`,
        `\`w${stripGtColors(m.name)}\`\``,
        m.id,
        "staticBlueFrame",
        m.id
      );
    }
    dlg.raw("add_button_with_icon||END_LIST|noflags|0|\n");
  } else {
    dlg.addTextbox("`4No matching items found. Try another keyword!``");
  }

  dlg.addQuickExit();
  OnDialogRequest(session, dlg.endDialog("item_finder", "Close", "Search"));
}

export function handleFindItemDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const btn = kv.buttonClicked || "";
  if (btn.startsWith("claim_")) {
    if (!hasPermission(session.account, "grantItems")) { OnConsoleMessage(session, "`4Item grants are operator-only.``"); return; }
    const id = parseInt(btn.slice(6), 10);
    const def = ctx.itemsDb.get(id);
    if (def && !def.name.startsWith("null_")) {
      const qty = def.isClothing || def.isLock ? 1 : 50;
      const added = ctx.giveInventoryItem(session, id, qty, true);
      if (added > 0) {
        OnPlayPositioned(session, "audio/object_collect.wav");
        OnConsoleMessage(
          session,
          `\`2Claimed \`w${added}x ${stripGtColors(def.name)}\`2 (#${def.id})!\`\``
        );
      } else {
        OnConsoleMessage(session, "`4Backpack full or stack already at 200!``");
      }
    }
    return;
  }

  if (kv.search_q !== undefined && btn !== "Close") {
    openItemFinderDialog(ctx, session, kv.search_q);
  }
}
