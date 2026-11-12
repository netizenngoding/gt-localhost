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

const PAGE_SIZE = 32;
// Items that can never be held in a backpack: Blank, Main Door, Bedrock.
const UNOBTAINABLE_IDS = new Set([0, 6, 8]);

function cleanName(name: string): string {
  return stripGtColors(name).replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** False for placeholder/revoked/uncarriable items; everything else stays findable. */
function isFindable(def: ItemDef): boolean {
  if (def.id <= 0 || UNOBTAINABLE_IDS.has(def.id)) return false;
  const n = cleanName(def.name || "");
  if (!n) return false;
  const l = n.toLowerCase();
  if (l.startsWith("null_") || l === "null" || l.includes("revoked") || l === "blank") return false;
  return true;
}

/** Token search: every word must appear (any order). Ranked exact > prefix > word-start > substring. */
function smartSearch(ctx: ServerContext, query: string): ItemDef[] {
  const q = cleanName(query).toLowerCase();
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);
  const scored: Array<{ def: ItemDef; score: number }> = [];
  const idQuery = /^\d+$/.test(q) ? Number(q) : -1;
  for (const def of ctx.itemsDb.items.values()) {
    if (!isFindable(def)) continue;
    const name = cleanName(def.name).toLowerCase();
    let score = -1;
    if (def.id === idQuery) score = 0;
    else if (name === q) score = 1;
    else if (tokens.every((t) => name.includes(t))) {
      const words = name.split(" ");
      if (name.startsWith(q)) score = 2;
      else if (tokens.every((t) => words.some((w) => w.startsWith(t)))) score = 3;
      else score = 4;
    }
    if (score >= 0) scored.push({ def, score });
  }
  scored.sort((a, b) => a.score - b.score || a.def.name.length - b.def.name.length || a.def.id - b.def.id);
  return scored.map((s) => s.def);
}

export function openItemFinderDialog(
  ctx: ServerContext,
  session: PlayerSession,
  query: string,
  page = 0
): void {
  const q = query.trim();
  session.lastItemSearchQuery = q;
  session.lastFindItemIds = [];

  const allMatches: ItemDef[] = q
    ? smartSearch(ctx, q)
    : DEFAULT_FIND_SHOWCASE
        .map((id) => ctx.itemsDb.get(id))
        .filter((d): d is ItemDef => d !== undefined && isFindable(d));
  const lastPage = Math.max(0, Math.ceil(allMatches.length / PAGE_SIZE) - 1);
  page = Math.max(0, Math.min(lastPage, Math.floor(Number.isFinite(page) ? page : 0)));
  const matches = allMatches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE + 1);

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
    dlg.addTextbox(`\`4No matching items found for \`w${q.replace(/[|\r\n`]/g, "")}\`4. Try another name or an item ID!\`\``);
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
      const def=ctx.itemsDb.get(id); if(!def || !isFindable(def))continue;
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
