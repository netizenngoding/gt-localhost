import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { handleDropItemReturn } from "./drop_item";
import { handleFindItemDialogReturn } from "./find_item";
import { handleGrowIdApplyReturn } from "./growid_apply";
import { handlePlayerDialogsReturn } from "./player_dialogs";
import { handleTileEditDialogReturn } from "./tile_edit";
import { handleTrashItemReturn } from "./trash_item";

export function handleDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const dlg = (kv.dialog_name || "").trim();
  if (!dlg) return;

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

  if (handleTileEditDialogReturn(ctx, session, dlg, kv)) {
    return;
  }

  handlePlayerDialogsReturn(ctx, session, dlg, kv);
}
