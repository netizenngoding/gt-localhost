import { setSkin } from "../progression/skin";
import type { ENetServerPeer } from "../network/enet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { applySkinColorUpdate, broadcastTextOverlay, OnConsoleMessage } from "../onVariant";
import { normalizeGtSkinColor, parseKvText } from "../tools/string";
import { handleBuy } from "./buy";
import { handleDialogReturn } from "./dialog_return";
import { handleDrop } from "./drop";
import { handleEnterGame } from "./enter_game";
import { handleFriends } from "./friends";
import { handleGrowIdAction } from "./growid";
import { handleInfo } from "./info";
import { handleInput } from "./input";
import { handleJoinRequest } from "./join_request";
import { handleLogon } from "./logon";
import { handleQuit } from "./quit";
import { handleQuitToExit } from "./quit_to_exit";
import { handleRefreshItemData } from "./refresh_item_data";
import { handleRespawn } from "./respawn";
import { handleStore } from "./store";
import { handleTrash } from "./trash";
import { handleTradeStart, handleWrenchPlayer } from "./wrench";

export function handleActionText(
  ctx: ServerContext,
  peer: ENetServerPeer,
  rawText: string
): void {
  const kv = parseKvText(rawText);
  const session = peer.userData as PlayerSession | null;

  // 1. Initial Logon packet (Guest Account or Registered GrowID)
  if (!session) {
    if ("requestedName" in kv || "tankIDName" in kv || "protocol" in kv) {
      handleLogon(ctx, peer, kv);
    }
    return;
  }

  const action = (kv.action || "").trim();

  switch (action) {
    case "enter_game":
      handleEnterGame(ctx, session);
      return;

    case "growid":
      handleGrowIdAction(ctx, session, kv);
      return;

    case "join_request":
      handleJoinRequest(ctx, session, kv);
      return;

    case "quit_to_exit":
      handleQuitToExit(ctx, session);
      return;

    case "quit":
      handleQuit(ctx, session);
      return;

    case "refresh_item_data":
      handleRefreshItemData(ctx, session);
      return;

    case "respawn":
      handleRespawn(ctx, session, false);
      return;

    case "respawn_spike":
      handleRespawn(ctx, session, true);
      return;

    case "drop":
      handleDrop(ctx, session, kv);
      return;

    case "trash":
      handleTrash(ctx, session, kv);
      return;

    case "info":
      handleInfo(ctx, session, kv);
      return;

    case "wrench":
      handleWrenchPlayer(ctx, session, kv);
      return;

    case "trade_started":
      if (kv.netid) handleTradeStart(ctx, session, parseInt(kv.netid, 10));
      return;

    case "store":
    case "storenavigate":
      handleStore(ctx, session, kv.item || kv.selection || "main");
      return;

    case "buy":
      handleBuy(ctx, session, kv.item || "");
      return;

    case "friends":
      handleFriends(ctx, session);
      return;

    case "setSkin": {
      // OptionsMenu sends signed 32-bit integer `color|<i32>`
      const raw = (kv.color || "").trim();
      const parsed = Number(raw);
      if (/^-?\d+$/.test(raw) && Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 4294967295) setSkin(ctx,session,parsed >>> 0);
      return;
    }

    case "MagnoliaAppIWantANewFlag": {
      const cc = (kv.IWantTheFlagToBe || "").trim().toUpperCase();
      if (/^[A-Z]{2,4}$/.test(cc)) {
        session.account.flag = cc.toLowerCase();
        ctx.savePlayersNow();
        if (session.world) {
          broadcastTextOverlay(
            session.world,
            `action|MagnoliaAppIWantANewFlag\nIWantTheFlagToBe|${cc}\nnetID|${session.netId}`
          );
        }
        OnConsoleMessage(session, `\`2Country flag set to \`w${cc}\`\`!`);
      }
      return;
    }

    case "dialog_return":
      handleDialogReturn(ctx, session, kv);
      return;

    case "input":
      handleInput(ctx, session, kv.text ?? "");
      return;

    case "killstore":
    case "setchatFilter":
      return;

    default:
      if (!action && rawText.trim()) {
        handleInput(ctx, session, rawText);
      }
      return;
  }
}
