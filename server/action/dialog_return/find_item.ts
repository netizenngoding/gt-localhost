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
  query: string,
  page = 0
): void {
  const q = query.trim();
  session.lastItemSearchQuery = q;
  session.lastFindItemIds = [];

  page = Math.max(0, Math.min(500, Math.floor(page)));
  const allMatches: ItemDef[] = q
    ? ctx.itemsDb.search(q, ctx.itemsDb.items.size)
    : DEFAULT_FIND_SHOWCASE
        .map((id) => ctx.itemsDb.get(id))
        .filter((d): d is ItemDef => d !== undefined);
  const matches=allMatches.slice(page*32,(page+1)*32+1);

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`wFound \`2${allMatches.length} items\`\``, 6016)
    .addTextbox("Select items below.")
    .addTextInput("search_q", "Item name or ID:", q.replace(/\|/g, ""), 40)
    .addSpacer("small");

  if (matches.length > 0) {
    session.lastFindItemIds=matches.slice(0,32).map(m=>m.id);
    for (const m of matches.slice(0,32)) {
      const full=stripGtColors(m.name).replace(/[|\r\n]/g," ");
      // Label is the text slot; frame_message is the quantity overlay.
      dlg.raw(`add_checkicon|item_${m.id}|${full}|staticframe|${m.id}||${session.findSelectedItemIds?.includes(m.id)?1:0}|\n`);
    }
    dlg.addButton("claim_selected", "Claim selected");
    if(page>0)dlg.addButton(`findpage_${page-1}`, "Previous");
    if(matches.length>32)dlg.addButton(`findpage_${page+1}`, "Next");
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
  const selected=new Set(session.findSelectedItemIds || []);
  // Only accept changes to IDs shown on the most recently rendered page.
  for(const id of session.lastFindItemIds || []) {
    if(kv[`item_${id}`] === "1") { if(selected.size<512) selected.add(id); }
    else if(kv[`item_${id}`] === "0") selected.delete(id);
  }
  session.findSelectedItemIds=[...selected];
  if (/^findpage_\d+$/.test(btn)) { openItemFinderDialog(ctx,session,session.lastItemSearchQuery,Number(btn.slice(9))); return; }
  if (btn === "claim_selected") {
    if (!hasPermission(session.account, "grantItems")) { OnConsoleMessage(session, "`4Item grants are operator-only.``"); return; }
    const ids=session.findSelectedItemIds || [];
    session.findSelectedItemIds=[];
    session.lastFindItemIds=[];
    for (const id of ids) {
      const def=ctx.itemsDb.get(id); if(!def || def.name.startsWith("null_"))continue;
      const added=ctx.giveInventoryItem(session,id,def.isClothing||def.isLock?1:50,true);
      if(added>0)OnConsoleMessage(session,`Claimed ${added}x ${stripGtColors(def.name)} (#${id}).`);
      else OnConsoleMessage(session,`Could not claim ${stripGtColors(def.name)}: backpack or stack full.`);
    }
    if(ids.length)OnPlayPositioned(session,"audio/object_collect.wav");
    else OnConsoleMessage(session,"Select at least one item.");
    return;
  }

  if (kv.search_q !== undefined && btn !== "Close") {
    openItemFinderDialog(ctx, session, kv.search_q);
  }
}
