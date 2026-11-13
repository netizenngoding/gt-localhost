import { clearAreaLock } from "../../database/world";
import { makeParticleEffectPacket, makeTileUpdatePacket } from "../../proton/packet";
import { broadcastBillboardChange, broadcastNameChanged, broadcastPositionedSfx, OnBillboardChange, OnPlayPositioned } from "../../onVariant";
import { isUntradeable } from "../../database/items";
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

export function openBillboardDialog(ctx: ServerContext, session: PlayerSession): void {
  const b = session.account.billboard || { itemId: 0, show: false, buying: false, priceWl: 1, perItem: true };
  const itemDef = b.itemId ? ctx.itemsDb.get(b.itemId) : undefined;
  const lines = [
    "set_default_color|`o",
    "add_label_with_icon|big|`wTrade Billboard``|left|8282|",
    "add_spacer|small|",
  ];
  if (itemDef) {
    lines.push(`add_label_with_icon|small|\`w${stripGtColors(itemDef.name)}\`\`|left|${b.itemId}|`);
  }
  lines.push(
    "add_item_picker|billboard_item|`wSelect Billboard Item``|Choose an item to put on your billboard!|",
    "add_spacer|small|",
    `add_checkbox|billboard_toggle|\`$Show Billboard\`\`|${b.show ? 1 : 0}`,
    `add_checkbox|billboard_buying_toggle|\`$Is Buying\`\`|${b.buying ? 1 : 0}`,
    `add_text_input|setprice|Price of item:|${b.priceWl || 1}|5|`,
    `add_checkbox|chk_peritem|World Locks per Item|${b.perItem ? 1 : 0}`,
    `add_checkbox|chk_perlock|Items per World Lock|${b.perItem ? 0 : 1}`,
    "add_spacer|small|",
    "end_dialog|billboard_edit|Close|Update|"
  );
  OnDialogRequest(session, lines.join("\n"));
}

export function openBackpackMenu(ctx: ServerContext, session: PlayerSession): void {
  const lvl = session.account.backpackLevel || 1;
  const maxStored = lvl * 10;
  const stored = session.account.storedItems || [];
  const upgradeCost = 1000 * (lvl * lvl + 25) * 2;
  const lines = [
    "set_default_color|`o",
    `add_label_with_icon|big|\`wBackpack - Level ${lvl}\`\`|left|8430|`,
    `add_textbox|\`w${stored.length}/${maxStored}\`\` items stored.|left|`,
  ];
  if (stored.length > 0) {
    lines.push("add_spacer|small|", "text_scaling_string|aaaaaaaaaaaaaaa|");
    stored.forEach((s, idx) => {
      const iName = stripGtColors(ctx.itemsDb.get(s.itemId)?.name || "Item");
      lines.push(`add_button_with_icon|bp_${idx}|${iName}|frame|${s.itemId}|${s.count}|`);
    });
    lines.push("add_button_with_icon||END_LIST|noflags|0||");
  }
  lines.push("add_spacer|small|");
  if (maxStored < 200) {
    lines.push(`add_button|backpack_upgrade|\`2Upgrade for ${upgradeCost.toLocaleString()} gems\`\`|noflags|0|0|`);
  }
  if (stored.length < maxStored) {
    lines.push("add_item_picker|itemid|`wDeposit Item``|Choose an item to store|");
  }
  lines.push("end_dialog|backpack_menu|Exit||", "add_quick_exit|");
  OnDialogRequest(session, lines.join("\n"));
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
    if(btn==='billboard_edit'){openBillboardDialog(ctx,session);return true;}
    if(btn==='backpack_menu'){openBackpackMenu(ctx,session);return true;}
    if(btn==='acct_growid')showGrowIdApplyModal(session);
    return true;
  }

  if (dlgName === "billboard_edit") {
    const b = (session.account.billboard = session.account.billboard || { itemId: 0, show: false, buying: false, priceWl: 1, perItem: true });
    if (kv.billboard_item) {
      const bid = Number.parseInt(kv.billboard_item, 10);
      const def = ctx.itemsDb.get(bid);
      if (bid > 0 && def && !isUntradeable(def) && !def.isLock) {
        b.itemId = bid;
      } else {
        OnConsoleMessage(session, "Item can not be untradeable.");
        OnTalkBubble(session, session.netId, "Item can not be untradeable.", 0, true);
      }
    }
    if (kv.billboard_toggle !== undefined) b.show = kv.billboard_toggle === "1";
    if (kv.billboard_buying_toggle !== undefined) b.buying = kv.billboard_buying_toggle === "1";
    if (kv.setprice !== undefined) {
      const p = Number.parseInt(kv.setprice, 10);
      if (Number.isFinite(p) && p > 0 && p <= 99999) b.priceWl = p;
    }
    if (kv.chk_peritem !== undefined || kv.chk_perlock !== undefined) {
      b.perItem = kv.chk_perlock !== "1";
    }
    ctx.dirty = true;
    ctx.savePlayersNow();
    if (session.world) broadcastBillboardChange(session.world, session);
    else OnBillboardChange(session, session);
    return true;
  }

  if (dlgName === "backpack_menu") {
    const lvl = session.account.backpackLevel || 1;
    const stored = (session.account.storedItems = session.account.storedItems || []);
    if (btn === "backpack_upgrade") {
      if (lvl * 10 >= 200) {
        OnTalkBubble(session, session.netId, "You have reached max slots!", 0, false);
        return true;
      }
      const cost = 1000 * (lvl * lvl + 25) * 2;
      if (session.account.gems < cost) {
        OnTalkBubble(session, session.netId, "You don't have enough gems!", 0, false);
        return true;
      }
      session.account.gems -= cost;
      session.account.backpackLevel = lvl + 1;
      OnSetBux(session);
      OnPlayPositioned(session, "audio/piano_nice.wav");
      OnTalkBubble(session, session.netId, "Congratulations! You have upgraded your Backpack!", 0, false);
      ctx.dirty = true;
      ctx.savePlayersNow();
      openBackpackMenu(ctx, session);
      return true;
    }
    if (kv.itemid) {
      const iid = Number.parseInt(kv.itemid, 10);
      const slot = session.account.inventory.find((s) => s.itemId === iid && s.count > 0);
      const def = ctx.itemsDb.get(iid);
      if (!slot || !def) return true;
      if (isUntradeable(def) || iid === 1424 || iid === 242 || iid === 1796 || iid === 7188) {
        OnTalkBubble(session, session.netId, "You can't store this item!", 0, false);
        return true;
      }
      if (stored.length >= lvl * 10) {
        OnTalkBubble(session, session.netId, "Backpack storage is full!", 0, false);
        return true;
      }
      const amt = slot.count;
      if (ctx.consumeInventoryItem(session, iid, amt, true)) {
        stored.push({ itemId: iid, count: amt });
        ctx.dirty = true;
        ctx.savePlayersNow();
        openBackpackMenu(ctx, session);
      }
      return true;
    }
    if (btn.startsWith("bp_")) {
      const idx = Number.parseInt(btn.slice(3), 10);
      const entry = stored[idx];
      if (!entry) return true;
      if (ctx.giveInventoryItem(session, entry.itemId, entry.count, true) === entry.count) {
        const iName = stripGtColors(ctx.itemsDb.get(entry.itemId)?.name || "Item");
        stored.splice(idx, 1);
        OnConsoleMessage(session, `You picked up ${entry.count} ${iName}.`);
        OnTalkBubble(session, session.netId, `You picked up ${entry.count} ${iName}.`, 0, false);
        ctx.dirty = true;
        ctx.savePlayersNow();
        openBackpackMenu(ctx, session);
      } else {
        OnTalkBubble(session, session.netId, "You don't have enough inventory space!", 0, false);
      }
      return true;
    }
    return true;
  }

  if (dlgName === "unaccess") {
    const world = session.world;
    if (!world || (btn !== "Yes" && btn !== "OK" && btn !== "")) return true;
    const uid = session.account.userId;
    let removed = 0;
    for (let i = 0; i < world.tiles.length; i++) {
      const t = world.tiles[i];
      if (t.extra?.kind === "lock" && t.extra.ownerUserId !== uid && t.extra.adminIds.includes(uid)) {
        t.extra.adminIds = t.extra.adminIds.filter((id) => id !== uid);
        removed++;
        const upd = makeTileUpdatePacket(i % world.width, Math.floor(i / world.width), t, Date.now());
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
      }
    }
    if (removed > 0) {
      ctx.dirty = true;
      broadcastNameChanged(session);
      OnTalkBubble(session, session.netId, "I've removed my access!", 0, true);
      broadcastConsoleMessage(world, `${session.account.name} removed their access from all locks in ${world.name}.`);
    } else {
      OnConsoleMessage(session, "You don't have admin access on any locks in this world.");
    }
    return true;
  }

  if (dlgName === "top") {
    const list = [...ctx.worlds.values()].sort((a, b) => b.peers.size - a.peers.size).slice(0, 15);
    if (btn.startsWith("warp_to_")) {
      ctx.joinWorld(session, btn.slice(8));
      return true;
    }
    const lines = [
      "set_default_color|`o",
      "add_label_with_icon|big|`oTop Worlds``|left|394|",
      "add_spacer|small|",
    ];
    list.forEach((w, idx) => {
      lines.push(`add_button|warp_to_${w.name}|#${idx + 1}: \`w${w.name}\`\` (${w.peers.size} online)|noflags|0|0|`);
    });
    lines.push("end_dialog|top|Close||");
    OnDialogRequest(session, lines.join("\n"));
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
