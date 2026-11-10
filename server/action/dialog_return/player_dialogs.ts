import { setSkin, showSkinMenu } from "../../progression/skin";
import { showAchievements } from "../../progression/commands";
import { SERVER_NAME } from "../../config/branding";
import { hasPermission, canModerate } from "../../ranks";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import {
  broadcastConsoleMessage,
  OnConsoleMessage,
  OnDialogRequest,
} from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";
import { handleBuy } from "../buy";
import { showGrowIdApplyModal } from "../growid";
import { handleTradeStart, handleWrenchPlayer } from "../wrench";
import { openItemFinderDialog } from "./find_item";

export function openCheatsMenu(session: PlayerSession): void {
  if (!hasPermission(session.account, "debug")) { OnConsoleMessage(session, "Developer permission required."); return; }
  const c = session.cheats;
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", `\`w${SERVER_NAME} Cheats\`\``, 5480)
    .addTextbox(
      `\`9Noclip: ${c.noclip ? "`2ON``" : "`4OFF``"} | Speed: ${c.speed ? "`2ON``" : "`4OFF``"} | Fly: ${c.fly ? "`2ON``" : "`4OFF``"}`
    )
    .addSpacer("small")
    .addButtonWithIcon("cheat_toggle_noclip", "Toggle Noclip", 32)
    .addButtonWithIcon("cheat_toggle_speed", "Toggle Super Speed", 5638)
    .addButtonWithIcon("cheat_toggle_fly", "Toggle Low-Gravity Fly", 48)
    .addQuickExit()
    .endDialog("cheats_menu", "Close", "");

  OnDialogRequest(session, dlg);
}

export function handlePlayerDialogsReturn(
  ctx: ServerContext,
  session: PlayerSession,
  dlgName: string,
  kv: Record<string, string>
): boolean {
  const btn = kv.buttonClicked || "";

  if (dlgName === "gazette") {
    if (btn === "gazette_get_growid") {
      showGrowIdApplyModal(session);
    } else if (btn === "gazette_find_items") {
      openItemFinderDialog(ctx, session, "");
    }
    return true;
  }

  if (dlgName === "store_dialog" || dlgName === "store") {
    if (btn === "store_upgrade_backpack" || btn.startsWith("store_buy_")) {
      handleBuy(ctx, session, btn);
    }
    return true;
  }

  if (dlgName === "cheats_menu") {
    if (!hasPermission(session.account, "debug")) return true;
    if (
      btn === "cheat_toggle_noclip" ||
      btn === "cheat_toggle_speed" ||
      btn === "cheat_toggle_fly"
    ) {
      if (btn === "cheat_toggle_noclip") session.cheats.noclip = !session.cheats.noclip;
      if (btn === "cheat_toggle_speed") session.cheats.speed = !session.cheats.speed;
      if (btn === "cheat_toggle_fly") session.cheats.fly = !session.cheats.fly;
      ctx.sendCharacterState(session);
      OnConsoleMessage(
        session,
        `\`2Cheats: \`wNoclip ${session.cheats.noclip ? "ON" : "OFF"} \`9| Speed ${session.cheats.speed ? "ON" : "OFF"} \`9| Fly ${session.cheats.fly ? "ON" : "OFF"}\`\``
      );
      openCheatsMenu(session);
    }
    return true;
  }

  if (dlgName === "skin_menu") {
    if (/^skin_\d+$/.test(btn)) setSkin(ctx,session,Number(btn.slice(5)));
    return true;
  }
  if(dlgName==='notebook_edit'){
    if(btn==='save'||btn==='clear'){
      session.account.personalNote=btn==='clear'?'':String(kv.personal_note||'').replace(/[|\r\n\0]/g,' ').slice(0,128);
      ctx.dirty=true;ctx.savePlayersNow();
    }
    return true;
  }
  if(dlgName==='my_worlds'){
    if(btn.startsWith('visit_')){
      const name=btn.slice(6),world=ctx.worlds.get(name);
      if(world?.ownerUserId===session.account.userId)ctx.joinWorld(session,name);
    }
    return true;
  }
  if (dlgName === 'achievements') {
    if (!btn || btn === 'cancel') handleWrenchPlayer(ctx, session, {netid: String(session.netId)});
    return true;
  }
  if (dlgName === 'popup') {
    if(btn==='alist'){showAchievements(session);return true;}
    if(btn==='notebook_edit'){
      OnDialogRequest(session,new DialogBuilder().addLabel('big','Notebook')
        .addTextBoxInput('personal_note','',session.account.personalNote||'',128,5)
        .addSpacer('small').addButton('save','Save').addButton('clear','Clear').addButton('cancel','Cancel')
        .addQuickExit().endDialog('notebook_edit','',''));
    }
    if(btn==='my_worlds'){
      const dlg=new DialogBuilder().addLabelWithIcon('big','My Worlds',242);
      for(const w of ctx.worlds.values())if(w.ownerUserId===session.account.userId)dlg.addButton(`visit_${w.name}`,w.name);
      OnDialogRequest(session,dlg.addQuickExit().endDialog('my_worlds','Close',''));
    }
    if(btn==='acct_growid')showGrowIdApplyModal(session);
    return true;
  }

  if (dlgName === "target_wrench") {
    const tradeMatch = btn.match(/^trade_start_(\d+)$/);
    if (tradeMatch) {
      handleTradeStart(ctx, session, parseInt(tradeMatch[1], 10));
      return true;
    }
    if (hasPermission(session.account, "moderate") && session.world) {
      const modMatch = btn.match(/^mod_(kick|pull|ban)_(\d+)$/);
      if (modMatch) {
        const mode = modMatch[1];
        const tNet = parseInt(modMatch[2], 10);
        const target = Array.from(session.world.peers).find((p) => p.netId === tNet);
        if (target && canModerate(session.account, target.account)) {
          if (mode === "kick") {
            target.peer.sendDisconnect();
          } else if (mode === "pull") {
            ctx.moveToWorld(target, session.world, session.x, session.y);
          } else if (mode === "ban") {
            target.account.banned = true;
            ctx.savePlayersNow();
            target.peer.sendDisconnect();
          }
        }
      }
    }
    return true;
  }

  if (dlgName === "trade_offer") {
    const m = btn.match(/^trade_offer_(\d+)$/);
    if (!m || !session.world) {
      session.pendingTradeOffer = null;
      return true;
    }
    const offer = session.pendingTradeOffer;
    if (!offer || offer.role !== "offering" || offer.fromNetId !== session.netId) return true;
    const itemId = parseInt(m[1], 10);
    const slot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
    if (!slot) return true;
    offer.itemId = itemId;
    const target = Array.from(ctx.sessions).find(
      (s) =>
        s.world === session.world &&
        s.pendingTradeOffer?.role === "awaiting" &&
        s.pendingTradeOffer.fromNetId === session.netId
    );
    if (!target || !target.pendingTradeOffer) return true;
    target.pendingTradeOffer.itemId = itemId;
    const def = ctx.itemsDb.get(itemId);
    const name = def ? stripGtColors(def.name) : `Item #${itemId}`;
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wIncoming Trade Offer``", itemId)
      .addTextbox(`\`w${session.account.name}\`\` offers \`w1x ${name}\`\` to you!`)
      .addButtonWithIcon(`trade_accept_${session.netId}_${itemId}`, "`2Accept``", 1422)
      .addButtonWithIcon(`trade_decline_${session.netId}`, "`4Decline``", 32, "staticRedFrame")
      .endDialog("trade_request", "Close", "");
    OnDialogRequest(target, dlg);
    OnConsoleMessage(session, "`2Trade offer sent!``");
    return true;
  }

  if (dlgName === "trade_request") {
    const accept = btn.match(/^trade_accept_(\d+)_(\d+)$/);
    const decline = btn.match(/^trade_decline_(\d+)$/);
    if (accept && session.world) {
      const fromNetId = parseInt(accept[1], 10);
      const itemId = parseInt(accept[2], 10);
      const requester = Array.from(session.world.peers).find(
        (s) => s.pendingTradeOffer?.role === "offering" && s.netId === fromNetId
      );
      if (!requester || requester.pendingTradeOffer?.itemId !== itemId) {
        session.pendingTradeOffer = null;
        OnConsoleMessage(session, "`4Trade offer is no longer valid!``");
        return true;
      }
      if (!ctx.consumeInventoryItem(requester, itemId, 1, true)) {
        requester.pendingTradeOffer = null;
        session.pendingTradeOffer = null;
        OnConsoleMessage(session, "`4Player no longer has that item!``");
        return true;
      }
      ctx.giveInventoryItem(session, itemId, 1, true);
      requester.pendingTradeOffer = null;
      session.pendingTradeOffer = null;
      broadcastConsoleMessage(
        session.world,
        `\`2Trade complete: \`w${requester.account.name}\`2 <-> \`w${session.account.name}\`2!\`\``
      );
      return true;
    }
    if (decline && session.world) {
      const fromNetId = parseInt(decline[1], 10);
      const requester = Array.from(session.world.peers).find((s) => s.netId === fromNetId);
      if (requester) {
        requester.pendingTradeOffer = null;
        OnConsoleMessage(requester, "`4Trade declined.``");
      }
      session.pendingTradeOffer = null;
      return true;
    }
    session.pendingTradeOffer = null;
    return true;
  }

  return false;
}
