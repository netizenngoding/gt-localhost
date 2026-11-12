import { worldModerate } from '../world-moderation';
import { addTradeItem, confirmTrade } from '../trade';
import { friendRequest, friendDialogReturn } from '../friends';
import { setSkin, showSkinMenu } from "../../progression/skin";
import { showAchievements } from "../../progression/commands";
import { SERVER_CONFIG, SERVER_NAME } from "../../config/branding";
import { hasPermission, canModerate } from "../../ranks";
import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import {
  broadcastConsoleMessage,
  OnConsoleMessage,
  OnDialogRequest,
  OnSetBux,
  OnTalkBubble,
} from "../../onVariant";
import { DialogBuilder } from "../../tools/create_dialog";
import { stripGtColors } from "../../tools/string";
import { handleBuy } from "../buy";
import { showGrowIdApplyModal } from "../growid";
import { handleTradeStart, handleWrenchPlayer } from "../wrench";
import { openItemFinderDialog } from "./find_item";

export function showGrowmojisDialog(session: PlayerSession): void {
  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "Growmojis", 1366);

  // Exact emoji list from GTPS3 Player.h & World.h
  const emojis = [
    "wl", "oops", "sleep", "punch", "bheart", "grow", "gems", "gtoken", "cry", "vend",
    "bunny", "cactus", "pine", "peace", "terror", "troll", "evil", "fireworks", "football",
    "alien", "party", "pizza", "clap", "song", "ghost", "nuke", "halo", "turkey", "gift",
    "cake", "heartarrow", "lucky", "shamrock", "grin", "ill", "eyes", "weary", "moyai", "plead",
    "yes", "no", "love", "shy", "wink", "tongue", "agree", "music", "build", "megaphone",
    "sigh", "mad", "wow", "dance", "see-no-evil", "heart", "kiss", "lol", "smile", "cool"
  ];
  for (const em of emojis) {
    dlg.raw(`add_smalltext_forced| (${em}) |left|\n`);
  }
  const dialogStr = dlg
    .addSpacer("small")
    .addQuickExit()
    .endDialog("growmoji_dialog", "", "Back");
  OnDialogRequest(session, dialogStr);
}

export function openCheatsMenu(session: PlayerSession): void {
  if (!SERVER_CONFIG.enableDeveloperMenu) { OnConsoleMessage(session, "`4Developer menu is temporarily disabled in server config.``"); return; }
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
  if (friendDialogReturn(ctx, session, dlgName, btn)) return true;

  if (dlgName === "gazette") {
    if (btn === "gazette_get_growid") {
      showGrowIdApplyModal(session);
    } else if (btn === "gazette_find_items") {
      openItemFinderDialog(ctx, session, "");
    }
    return true;
  }

  if (dlgName === "phone_dialog") {
    if (btn === "call_police") {
      OnConsoleMessage(session, "`4*Ring Ring* Officer: Emergency services standing by! Stay vigilant in Growtopia!``");
    } else if (btn === "call_locke") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wLocke's Traveling Wagon``", 1796)
        .addTextbox("`wWelcome to Locke's Traveling Wagon! Locke offers rare goods from distant lands.``")
        .addTextbox("`2Today's Special: `wUltra Gem Pack`` (1 Diamond Lock for 100,000 Gems)!")
        .addButton("locke_trade", "`wTrade 1 DL for 100,000 Gems``")
        .addQuickExit()
        .endDialog("locke_dialog", "Close", "");
      OnDialogRequest(session, dlg);
    } else if (btn === "call_daily") {
      OnConsoleMessage(session, "`2*Ring Ring* Crazy Jim: Check your /daily quests anytime for awesome rewards!``");
    }
    return true;
  }

  if (dlgName === "phone_dial") {
    const dialed = (kv.phone_number || kv.buttonClicked || "").trim();
    if (dialed === "12345") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wDaily Tasks``", 2946)
        .addTextbox("Complete daily tasks to get personal points and earn yourself awesome rewards along the way!")
        .addSpacer("small")
        .addLabelWithIcon("small", "Play for 30 minutes", 2946)
        .addLabelWithIcon("small", "Break 1,000 blocks", 2946)
        .addLabelWithIcon("small", "Place 1,000 blocks", 2946)
        .addLabelWithIcon("small", "Harvest provider", 2946)
        .addLabelWithIcon("small", "Login once per day", 2946)
        .addSpacer("small")
        .addQuickExit()
        .endDialog("daily_tasks_dialog", "Close", "");
      OnDialogRequest(session, dlg);
      return true;
    }
    if (dialed === "911") {
      OnTalkBubble(session, session.netId, "Officer: Emergency services standing by! Stay vigilant in Growtopia!", 0, true);
      OnConsoleMessage(session, "`4*Ring Ring* Officer: Emergency services standing by! Stay vigilant in Growtopia!``");
      return true;
    }
    if (dialed === "53785") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`9GTPS Salesman``", 9828)
        .addSpacer("small")
        .addTextbox("Ho there, friend! Locke's my name, and locks are my game. I Love 'em all, Diamond, Huge.. even Small! If you can part with some locks, I'll give you something special in return. Whaddya say?")
        .addSpacer("small")
        .addButton("locke_trade", "`wTrade 1 DL for 100,000 Gems``")
        .addQuickExit()
        .endDialog("locke_dialog", "Close", "");
      OnDialogRequest(session, dlg);
      return true;
    }
    OnTalkBubble(session, session.netId, "I'm sorry, the number you have dialed is not in service.", 0, true);
    return true;
  }

  if (dlgName === "locke_dialog") {
    if (btn === "locke_trade") {
      const dlSlot = session.account.inventory.find(i => i.itemId === 1796 && i.count >= 1);
      if (dlSlot) {
        ctx.consumeInventoryItem(session, 1796, 1);
        session.account.gems = (session.account.gems || 0) + 100000;
        ctx.savePlayersNow();
        OnSetBux(session);
        OnConsoleMessage(session, "`2[Locke] Traded 1 Diamond Lock for 100,000 Gems! Thank you for your business!``");
      } else {
        OnConsoleMessage(session, "`4[Locke] You need at least 1 Diamond Lock to make this trade!``");
      }
    }
    return true;
  }

  if (dlgName === "growmoji_dialog") {
    handleWrenchPlayer(ctx, session, { netid: String(session.netId) });
    return true;
  }

  if (dlgName === "store_dialog" || dlgName === "store") {
    if (btn === "store_upgrade_backpack" || btn.startsWith("store_buy_")) {
      handleBuy(ctx, session, btn);
    }
    return true;
  }

  if (dlgName === "cheats_menu") {
    if (!SERVER_CONFIG.enableDeveloperMenu || !hasPermission(session.account, "debug")) return true;
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
    const targetNetId = Number.parseInt(kv.netID || kv.netid || '',10);
    const target = [...(session.world?.peers || [])].find(p=>p.netId===targetNetId);
    if (target && target !== session) {
      if (btn==='friend_add') friendRequest(ctx,session,target.netId);
      else if (btn==='trade') handleTradeStart(ctx,session,target.netId);
      else if (btn==='kick'||btn==='pull'||btn==='worldban') worldModerate(ctx,session,target,btn);
      return true;
    }
    // A forged target button must never fall through to self actions.
    if (['friend_add','trade','kick','pull','worldban'].includes(btn)) return true;
    if(btn==='alist'){showAchievements(session);return true;}
    if(btn==='emojis'){showGrowmojisDialog(session);return true;}
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

  if (dlgName === "target_wrench") return true; // old dialogs expire safely

  if (dlgName === "trade_confirm") { confirmTrade(ctx,session,btn); return true; }

  if (dlgName === "trade_add") {
    if (kv.buttonClicked !== "Cancel" && kv.itemID && kv.count) addTradeItem(ctx,session,Number(kv.itemID.replace(/\|$/, '')),Number(kv.count.replace(/\|$/, '')));
    return true;
  }

  return false;
}
