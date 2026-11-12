/**
 * GrowScan 9000 (6016) Dialog & Stats
 * Directly reverse engineered from LyNnz01/GTPS3/SERVER/World.h (lines 5705, 5806, 20478)
 */

import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import type { WorldInstance } from "../../database/world";
import { OnDialogRequest } from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";

export function openGrowScanDialog(session: PlayerSession, world: WorldInstance): void {
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wWorld Stats``", 6016)
    .addSpacer("small")
    .addTextbox("`wThis amazing block can show the stats for the whole world!|left")
    .addSpacer("small")
    .addTextbox("`wWhich stats would you like to view?|left")
    .addButton("worldBlocks", "World Blocks")
    .addButton("floatingItems", "Floating Items")
    .addSpacer("small")
    .addQuickExit()
    .endDialog("statsblock", "Cancel", "Apply");

  OnDialogRequest(session, dlg);
}

export function handleGrowScanDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): boolean {
  const world = session.world;
  if (!world) return false;
  const btn = kv.buttonClicked || "";

  if (btn === "worldBlocks") {
    let totalBlocks = 0;
    let totalBg = 0;
    let totalSeeds = 0;
    let totalLocks = 0;

    for (const t of world.tiles) {
      if (t.fg > 0) totalBlocks++;
      if (t.bg > 0) totalBg++;
      if (t.extra?.kind === "seed") totalSeeds++;
      if (t.extra?.kind === "lock") totalLocks++;
    }

    const dlgStr = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wWorld Blocks``", 6016)
      .addSpacer("small")
      .addTextbox(`\`wTotal Foreground Blocks: \`2${totalBlocks}\`\`|left`)
      .addTextbox(`\`wTotal Backgrounds: \`2${totalBg}\`\`|left`)
      .addTextbox(`\`wTotal Planted Trees/Seeds: \`2${totalSeeds}\`\`|left`)
      .addTextbox(`\`wTotal Placed Locks: \`2${totalLocks}\`\`|left`)
      .addSpacer("small")
      .addButton("statsblock_back", "Back")
      .addQuickExit()
      .endDialog("statsblock", "Close", "");

    OnDialogRequest(session, dlgStr);
    return true;
  }

  if (btn === "floatingItems") {
    const totalFloating = world.objects.length;
    let totalItemsCount = 0;
    const itemMap = new Map<number, number>();

    for (const obj of world.objects) {
      if (obj.itemId > 0 && obj.count > 0) {
        totalItemsCount += obj.count;
        itemMap.set(obj.itemId, (itemMap.get(obj.itemId) || 0) + obj.count);
      }
    }

    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wFloating Items``", 6016)
      .addSpacer("small")
      .addTextbox(`\`wTotal Floating Item Stacks: \`2${totalFloating}\`\`|left`)
      .addTextbox(`\`wTotal Items Dropped: \`2${totalItemsCount}\`\`|left`)
      .addSpacer("small");

    if (itemMap.size === 0) {
      dlg.addTextbox("No floating items found in this world.");
    } else {
      let count = 0;
      for (const [itemId, amt] of itemMap) {
        if (count >= 15) break; // Display top 15 items
        const def = ctx.itemsDb.get(itemId);
        const name = def ? stripGtColors(def.name) : `Item #${itemId}`;
        dlg.addLabelWithIcon("small", `\`w${name}\`\`: \`2${amt}\`\``, itemId);
        count++;
      }
    }

    const dlgStr = dlg
      .addSpacer("small")
      .addButton("statsblock_back", "Back")
      .addQuickExit()
      .endDialog("statsblock", "Close", "");

    OnDialogRequest(session, dlgStr);
    return true;
  }

  if (btn === "statsblock_back") {
    openGrowScanDialog(session, world);
    return true;
  }

  return true;
}
