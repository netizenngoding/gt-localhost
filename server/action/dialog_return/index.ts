import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { hasPermission } from "../../ranks";
import { handleSdbDialogReturn } from "../../commands/broadcast";
import { handleSocialPortalReturn } from "../social_portal";
import { handleDropItemReturn } from "./drop_item";
import { handleFindItemDialogReturn } from "./find_item";
import { handleGrowIdApplyReturn } from "./growid_apply";
import { handleGrowScanDialogReturn } from "./growscan";
import { handlePlayerDialogsReturn } from "./player_dialogs";
import { handleSuckerDialogReturn } from "./sucker";
import { handleTileEditDialogReturn } from "./tile_edit";
import { handleAcceptAccessDialog } from "./tile_edit";
import { handleTrashItemReturn } from "./trash_item";
import { handleVendingDialogReturn } from "./vending";
import { handleTelephoneLockeDialogReturn } from "./telephone_locke";
import { handleWorldBlockDialogReturn } from "./world_blocks";

import {
  handlePlayerRoleDialog,
  handlePlayersTab,
  handleRankEditorDialog,
  handleRanksTab,
  handleRoleManageDialog,
  handleRolesDialog,
} from "../../commands/ranks_cmd";

export function handleDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const dlg = (kv.dialog_name || "").trim();
  if (!dlg) return;

  // Roles panel and its sub-dialogs. A modified client can name any dialog, so
  // the whole family is gated here before a handler ever runs.
  const dlgLower = dlg.toLowerCase();
  if (dlgLower === "roles" || dlgLower === "role_ranks" || dlgLower === "role_players" || dlgLower === "role_rank" || dlgLower === "role_player" || dlgLower === "role_create") {
    if (!hasPermission(session.account, "setRanks")) return;
  }
  if (dlgLower === "roles") {
    handleRolesDialog(ctx, session, kv);
    return;
  }
  if (dlgLower === "role_ranks") {
    handleRanksTab(ctx, session, kv);
    return;
  }
  if (dlgLower === "role_players") {
    handlePlayersTab(ctx, session, kv);
    return;
  }
  if (dlgLower === "role_rank") {
    handleRankEditorDialog(ctx, session, kv);
    return;
  }
  if (dlgLower === "role_player") {
    handlePlayerRoleDialog(ctx, session, kv);
    return;
  }
  if (dlgLower === "role_create" || dlgLower === "role_edit" || dlgLower === "role_delete") {
    handleRoleManageDialog(ctx, session, dlgLower, kv);
    return;
  }

  // Social Portal (AstroVerse dialogMap["SocialPortal"]).
  if (dlg.toLowerCase() === "acceptaccess") {
    handleAcceptAccessDialog(ctx, session, kv);
    return;
  }

  if (dlg.toLowerCase() === "socialportal") {
    handleSocialPortalReturn(ctx, session, kv);
    return;
  }

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
