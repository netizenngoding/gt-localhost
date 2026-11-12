import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { handleSdbDialogReturn } from "../../commands/broadcast";
import { handleDropItemReturn } from "./drop_item";
import { handleFindItemDialogReturn } from "./find_item";
import { handleGrowIdApplyReturn } from "./growid_apply";
import { handleGrowScanDialogReturn } from "./growscan";
import { handlePlayerDialogsReturn } from "./player_dialogs";
import { handleSuckerDialogReturn } from "./sucker";
import { handleTileEditDialogReturn } from "./tile_edit";
import { handleTrashItemReturn } from "./trash_item";
import { handleVendingDialogReturn } from "./vending";
import { handleTelephoneLockeDialogReturn } from "./telephone_locke";
import { handleWorldBlockDialogReturn } from "./world_blocks";

export function handleDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const dlg = (kv.dialog_name || "").trim();
  if (!dlg) return;

  if (handleSdbDialogReturn(ctx, session, dlg, kv)) {
    return;
  }

  if (handleTelephoneLockeDialogReturn(ctx, session, dlg, kv)) {
    return;
  }

  if (dlg === "vending") {
    handleVendingDialogReturn(ctx, session, kv);
    return;
  }

  if (dlg === "statsblock") {
    handleGrowScanDialogReturn(ctx, session, kv);
    return;
  }

  if (dlg === "itemsucker_block") {
    handleSuckerDialogReturn(ctx, session, kv);
    return;
  }

  if (dlg === "growid_apply") {
    handleGrowIdApplyReturn(ctx, session, kv);
    return;
  }

  if (dlg === "drop_item") {
    handleDropItemReturn(ctx, session, kv);
    return;
  }

  if (dlg === "trash_item") {
    handleTrashItemReturn(ctx, session, kv);
    return;
  }

  if (dlg === "item_finder") {
    handleFindItemDialogReturn(ctx, session, kv);
    return;
  }

  if (handleWorldBlockDialogReturn(ctx, session, dlg, kv)) {
    return;
  }

  if (handleTileEditDialogReturn(ctx, session, dlg, kv)) {
    return;
  }

  handlePlayerDialogsReturn(ctx, session, dlg, kv);
}
