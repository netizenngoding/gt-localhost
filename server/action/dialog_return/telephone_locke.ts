import type { ServerContext } from "../../database/context";
import type { PlayerSession } from "../../database/peer";
import { DialogBuilder } from "../../tools/create_dialog";
import {
  OnConsoleMessage,
  OnDialogRequest,
  OnTalkBubble,
} from "../../onVariant";
import { buildTankPacket } from "../../proton/packet";

export const GTPS3_LOCKE_ITEMS: Array<{ itemId: number; priceWl: number }> = [
  { itemId: 8202, priceWl: 1 },
  { itemId: 2478, priceWl: 1 },
  { itemId: 2724, priceWl: 1 },
  { itemId: 10394, priceWl: 3 },
  { itemId: 4722, priceWl: 3 },
  { itemId: 3738, priceWl: 5 },
  { itemId: 1210, priceWl: 10 },
  { itemId: 2978, priceWl: 10 },
  { itemId: 2572, priceWl: 10 },
  { itemId: 8878, priceWl: 10 },
  { itemId: 10836, priceWl: 10 },
  { itemId: 10838, priceWl: 10 },
  { itemId: 12480, priceWl: 10 },
  { itemId: 12482, priceWl: 10 },
  { itemId: 12484, priceWl: 10 },
  { itemId: 3818, priceWl: 15 },
  { itemId: 1978, priceWl: 15 },
  { itemId: 6286, priceWl: 15 },
  { itemId: 6140, priceWl: 15 },
  { itemId: 3560, priceWl: 20 },
  { itemId: 3798, priceWl: 25 },
  { itemId: 6288, priceWl: 25 },
  { itemId: 5138, priceWl: 25 },
  { itemId: 4322, priceWl: 25 },
  { itemId: 3172, priceWl: 25 },
  { itemId: 2480, priceWl: 30 },
  { itemId: 2476, priceWl: 50 },
  { itemId: 3104, priceWl: 50 },
  { itemId: 6290, priceWl: 50 },
  { itemId: 12044, priceWl: 50 },
  { itemId: 2754, priceWl: 70 },
  { itemId: 3894, priceWl: 75 },
  { itemId: 8892, priceWl: 80 },
  { itemId: 8194, priceWl: 80 },
  { itemId: 3616, priceWl: 100 },
  { itemId: 4516, priceWl: 100 },
  { itemId: 1830, priceWl: 100 },
  { itemId: 2720, priceWl: 100 },
  { itemId: 2452, priceWl: 100 },
  { itemId: 1486, priceWl: 100 },
  { itemId: 12046, priceWl: 100 },
  { itemId: 5140, priceWl: 150 },
  { itemId: 11156, priceWl: 150 },
  { itemId: 8818, priceWl: 200 },
  { itemId: 4986, priceWl: 200 },
  { itemId: 8820, priceWl: 300 },
  { itemId: 5022, priceWl: 300 },
  { itemId: 5142, priceWl: 300 },
  { itemId: 5738, priceWl: 300 },
  { itemId: 2702, priceWl: 300 },
  { itemId: 8822, priceWl: 335 },
  { itemId: 9408, priceWl: 350 },
  { itemId: 5206, priceWl: 400 },
  { itemId: 3300, priceWl: 400 },
  { itemId: 5322, priceWl: 400 },
  { itemId: 10396, priceWl: 400 },
  { itemId: 9818, priceWl: 450 },
  { itemId: 9820, priceWl: 450 },
  { itemId: 9822, priceWl: 450 },
  { itemId: 9824, priceWl: 450 },
  { itemId: 3114, priceWl: 500 },
  { itemId: 8024, priceWl: 500 },
  { itemId: 8026, priceWl: 500 },
  { itemId: 7166, priceWl: 500 },
  { itemId: 6144, priceWl: 500 },
  { itemId: 5078, priceWl: 500 },
  { itemId: 5084, priceWl: 500 },
  { itemId: 5080, priceWl: 500 },
  { itemId: 5082, priceWl: 500 },
  { itemId: 4972, priceWl: 500 },
  { itemId: 4970, priceWl: 500 },
  { itemId: 5264, priceWl: 500 },
  { itemId: 2284, priceWl: 600 },
  { itemId: 11050, priceWl: 800 },
  { itemId: 11664, priceWl: 1000 },
  { itemId: 8834, priceWl: 1000 },
  { itemId: 3042, priceWl: 1000 },
  { itemId: 4948, priceWl: 1000 },
  { itemId: 5260, priceWl: 1000 },
  { itemId: 11134, priceWl: 1000 },
  { itemId: 5174, priceWl: 1100 },
  { itemId: 5160, priceWl: 1500 },
  { itemId: 1804, priceWl: 1500 },
  { itemId: 5194, priceWl: 1900 },
  { itemId: 8816, priceWl: 3000 },
  { itemId: 4956, priceWl: 5000 },
  { itemId: 5156, priceWl: 6400 },
  { itemId: 5154, priceWl: 6500 },
  { itemId: 2450, priceWl: 10000 },
  { itemId: 5176, priceWl: 10300 },
];

export function getDailyQuestForDate(date: Date) {
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const pool = [
    2, 3, 10, 11, 14, 15, 16, 17, 20, 22, 52, 54, 98, 112, 138, 142,
    148, 164, 186, 218, 224, 252, 284, 308, 340, 362, 454, 458, 506,
    526, 574, 598, 682, 778, 868, 874
  ];
  const idx1 = Math.abs(Math.sin(seed) * 10000) % pool.length | 0;
  const idx2 = (idx1 + 1 + (Math.abs(Math.cos(seed) * 10000) % (pool.length - 1) | 0)) % pool.length;
  const count1 = ((Math.abs(Math.sin(seed * 2) * 10000) % 50) | 0) + 10;
  const count2 = ((Math.abs(Math.cos(seed * 2) * 10000) % 50) | 0) + 10;
  return {
    dayKey: seed,
    item1: pool[idx1],
    count1,
    item2: pool[idx2],
    count2,
  };
}

export function openLockeDialog(ctx: ServerContext, session: PlayerSession): void {
  const day = new Date().getDay();
  // GTPS3: available on Sun (0), Mon (1), Fri (5), Sat (6)
  if (day !== 0 && day !== 1 && day !== 5 && day !== 6) {
    OnTalkBubble(session, session.netId, "`9Locke is on a break! Check later..``", 0, true);
    return;
  }
  const wl = session.account.inventory.find(s => s.itemId === 242)?.count || 0;
  const dl = session.account.inventory.find(s => s.itemId === 1796)?.count || 0;

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`9GTPS Salesman``", 9828)
    .addSpacer("small")
    .addSmalltext("Ho there, friend! Locke's my name, and locks are my game. I Love 'em all, Diamond, Huge.. even Small! If you can part with some locks, I'll give you something special in return. Whaddya say?")
    .addSpacer("small")
    .addSmalltext(
      wl + dl !== 0
        ? `\`9(Hmm, smells like you are carrying ${wl !== 0 ? `${wl} World Locks` : ""}${dl !== 0 ? `${wl !== 0 ? ", and " : ""}${dl} Diamond Lock` : ""})\`\``
        : "`9(Hmm, smells like you don't carry any world locks)\`\`"
    )
    .addSpacer("small");

  for (const item of GTPS3_LOCKE_ITEMS) {
    const def = ctx.itemsDb.get(item.itemId);
    const name = def?.name || `Item #${item.itemId}`;
    const priceText = item.priceWl > 200
      ? `${Math.floor(item.priceWl / 100)} Diamond Lock`
      : `${item.priceWl} World Locks`;
    dlg.addButton(`lock_price_${item.itemId}`, `Buy ${name} for ${priceText}`);
  }

  const dialogStr = dlg
    .addSpacer("small")
    .addQuickExit()
    .endDialog("locke_menu", "Close", "");
  OnDialogRequest(session, dialogStr);
}

export function openSalesManUntradeableDialog(ctx: ServerContext, session: PlayerSession): void {
  const wl = session.account.inventory.find(s => s.itemId === 242)?.count || 0;
  const dl = session.account.inventory.find(s => s.itemId === 1796)?.count || 0;
  const bgl = session.account.inventory.find(s => s.itemId === 7188)?.count || 0;

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`9Sales-Man Untradeable``", 9528)
    .addSpacer("small")
    .addSmalltext("Damn.. I hate LOCKE!! This guy takes all my diamond locks, i'm hungry so feed me more. The Untradeable Sales-Man")
    .addSpacer("small")
    .addSmalltext(
      wl + dl !== 0
        ? `\`9(Hmm, smells like you are carrying ${wl !== 0 ? `${wl} World Locks` : ""}${dl !== 0 ? `${wl !== 0 ? ", and " : ""}${dl} Diamond Lock` : ""})\`\``
        : "`9(Hmm, smells like you don't carry any world locks)\`\`"
    );
  if (bgl > 0) {
    dlg.addSmalltext(`\`9(You are also holding additional ${bgl} Blue Gem Locks)\`\``);
  }
  dlg.addSpacer("small");

  // Selection of prominent untradeables
  const untradeables = [
    { itemId: 1486, priceWl: 100 },
    { itemId: 1830, priceWl: 100 },
    { itemId: 1966, priceWl: 500 },
    { itemId: 6946, priceWl: 2500 },
    { itemId: 6948, priceWl: 2500 },
    { itemId: 5638, priceWl: 3000 },
  ];

  for (const item of untradeables) {
    const def = ctx.itemsDb.get(item.itemId);
    const name = def?.name || `Item #${item.itemId}`;
    const priceText = item.priceWl > 200
      ? `${Math.floor(item.priceWl / 100)} Diamond Lock`
      : `${item.priceWl} World Locks`;
    dlg.addButton(`lock_price_${item.itemId}`, `Buy ${name} for ${priceText}`);
  }

  const dialogStr = dlg
    .addSpacer("small")
    .addQuickExit()
    .endDialog("locke_menu", "Close", "");
  OnDialogRequest(session, dialogStr);
}

export function handleTelephoneLockeDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  dlgName: string,
  kv: Record<string, string>
): boolean {
  let btn = (kv.buttonClicked || kv.phone_number || "").trim();

  // 1. Telephone Dialog (3898)
  if (dlgName === "3898" || dlgName === "phone_dial" || dlgName === "phone_dialog") {
    if (btn === "12345") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wCrazy Jim's Quest Emporium``", 3902)
        .addTextbox("HEEEEYYY there Growtopian! I'm Crazy Jim, and my quests are so crazy they're KERRRRAAAAZZY!! And that is clearly very crazy, so please, be cautious around them. What can I do ya for, partner?")
        .addButton("chc1_1", "Daily Quest")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dlg);
      return true;
    }

    if (btn === "chc1_1") {
      const quest = getDailyQuestForDate(new Date());
      if (session.account.lastDailyQuestDay === quest.dayKey) {
        const dlg = new DialogBuilder()
          .setDefaultColor("`o")
          .addLabelWithIcon("big", "`wCrazy Jim's Daily Quest``", 3902)
          .addTextbox("You've already completed my Daily Quest for today! Call me back after midnight to hear about my next cravings.")
          .addButton("12345", "Back")
          .addQuickExit()
          .endDialog("3898", "Hang Up", "");
        OnDialogRequest(session, dlg);
        return true;
      }

      const item1Def = ctx.itemsDb.get(quest.item1);
      const item2Def = ctx.itemsDb.get(quest.item2);
      const item1Name = item1Def?.name || "Dirt";
      const item2Name = item2Def?.name || "Rock";
      const have1 = session.account.inventory.find(s => s.itemId === quest.item1 && s.count > 0)?.count || 0;
      const have2 = session.account.inventory.find(s => s.itemId === quest.item2 && s.count > 0)?.count || 0;
      const canTurnIn = have1 >= quest.count1 && have2 >= quest.count2;

      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wCrazy Jim's Daily Quest``", 3902)
        .addTextbox("I guess some people call me Crazy Jim because I'm a bit of a hoarder. But I'm very particular about what I want! And today, what I want is this:")
        .addLabelWithIcon("small", `\`2${quest.count1} ${item1Name}\`\``, quest.item1)
        .addSmalltext("and")
        .addLabelWithIcon("small", `\`2${quest.count2} ${item2Name}\`\``, quest.item2)
        .addSpacer("small")
        .addSmalltext("You shove all that through the phone (it works, I've tried it), and I will hand you one of the `2Growtokens`` from my personal collection! But hurry, this offer is only good until midnight, and only one `2Growtoken`` per person!")
        .addSpacer("small")
        .addSmalltext(`\`6(You have ${have1} ${item1Name} and ${have2} ${item2Name})\`\``)
        .addSpacer("small");

      if (canTurnIn) {
        dlg.addButton("turnin", "Turn in items");
      }
      const dialogStr = dlg
        .addButton("12345", "Back")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dialogStr);
      return true;
    }

    if (btn === "turnin") {
      const quest = getDailyQuestForDate(new Date());
      if (session.account.lastDailyQuestDay === quest.dayKey) {
        OnConsoleMessage(session, "`4You have already completed today's Daily Quest!``");
        return true;
      }
      const have1 = session.account.inventory.find(s => s.itemId === quest.item1 && s.count > 0)?.count || 0;
      const have2 = session.account.inventory.find(s => s.itemId === quest.item2 && s.count > 0)?.count || 0;
      if (have1 < quest.count1 || have2 < quest.count2) {
        OnConsoleMessage(session, "`4You don't have enough items to complete this quest!``");
        return true;
      }

      ctx.consumeInventoryItem(session, quest.item1, quest.count1, true);
      ctx.consumeInventoryItem(session, quest.item2, quest.count2, true);

      // Tasks Day gives 3 Growtokens (day 4)
      const isTasksDay = new Date().getDay() === 4;
      const gTokens = isTasksDay ? 3 : 1;
      ctx.giveInventoryItem(session, 1486, gTokens, true);

      session.account.lastDailyQuestDay = quest.dayKey;
      ctx.dirty = true;
      ctx.savePlayersNow();

      // Packet 19 popup animation
      const animPkt = buildTankPacket({
        type: 19,
        netId: session.netId,
        x: (session.lastWrenchX ?? 10) * 32 + 16,
        y: (session.lastWrenchY ?? 10) * 32 + 16,
        punchX: 1486,
        punchY: session.netId,
        value: 500,
      });
      if (session.world) {
        for (const p of session.world.peers) p.peer.sendPacket(0, animPkt, true);
      }

      const item1Def = ctx.itemsDb.get(quest.item1);
      const item2Def = ctx.itemsDb.get(quest.item2);
      const item1Name = item1Def?.name || "Dirt";
      const item2Name = item2Def?.name || "Rock";
      OnConsoleMessage(
        session,
        `[\`6You jammed ${quest.count1} ${item1Name} and ${quest.count2} ${item2Name} into the phone, and ${gTokens} \`2Growtoken\`\` popped out!\`\`]`
      );
      return true;
    }

    if (btn === "53785") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wSales-Man``", 4358)
        .addTextbox("It is I, Sales-Man, savior of the wealthy! Let me rescue you from your riches. What would you like to buy today?")
        .addButton("chc4_1", "Surgery Items")
        .addButton("chc3_1", "Zombie Defense Items")
        .addButton("chc2_1", "Blue Gem Lock")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dlg);
      return true;
    }

    if (btn === "chc2_1") {
      const dlCount = session.account.inventory.find(s => s.itemId === 1796)?.count || 0;
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wBlue Gem Lock``", 7188)
        .addTextbox("Excellent! I'm happy to sell you a Blue Gem Lock in exchange for 100 Diamond Lock..")
        .addSmalltext(`\`6You have ${dlCount} Diamond Lock.\`\``);
      if (dlCount >= 100) {
        dlg.addButton("chc2_2_1", "Thank you!");
      }
      const dialogStr = dlg
        .addButton("53785", "Back")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dialogStr);
      return true;
    }

    if (btn === "chc2_2_1") {
      const dlCount = session.account.inventory.find(s => s.itemId === 1796)?.count || 0;
      if (dlCount < 100) {
        OnConsoleMessage(session, "`4You don't have enough Diamond Locks!``");
        return true;
      }
      ctx.consumeInventoryItem(session, 1796, 100, true);
      ctx.giveInventoryItem(session, 7188, 1, true);

      // Packet 19 animation
      const animPkt = buildTankPacket({
        type: 19,
        netId: session.netId,
        x: (session.lastWrenchX ?? 10) * 32 + 16,
        y: (session.lastWrenchY ?? 10) * 32 + 16,
        punchX: 7188,
        punchY: session.netId,
        value: 500,
      });
      if (session.world) {
        for (const p of session.world.peers) p.peer.sendPacket(0, animPkt, true);
      }
      OnConsoleMessage(session, "[`6You spent 100 Diamond Lock to get 1 Blue Gem Lock``]");
      return true;
    }

    if (btn === "chc3_1") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wSales-Man: Zombie Defense``", 4358)
        .addTextbox("Excellent! I'm happy to sell you Zombie Defense supplies in exchange for Diamond Locks.")
        .addButton("lock_price_4450", "Buy Zombie Brain for 1 Diamond Lock")
        .addButton("lock_price_4452", "Buy Zombie Brain Pile for 5 Diamond Lock")
        .addButton("53785", "Back")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dlg);
      return true;
    }

    if (btn === "chc4_1") {
      const dlg = new DialogBuilder()
        .setDefaultColor("`o")
        .addLabelWithIcon("big", "`wSales-Man: Surgery``", 4358)
        .addTextbox("Excellent! I'm happy to sell you rare and precious Surgery prizes in exchange for Diamond Locks.")
        .addButton("lock_price_4298", "Buy Caduceus for 2 Diamond Lock")
        .addButton("lock_price_4300", "Buy Golden Caduceus for 10 Diamond Lock")
        .addButton("53785", "Back")
        .addQuickExit()
        .endDialog("3898", "Hang Up", "");
      OnDialogRequest(session, dlg);
      return true;
    }

    if (btn === "call_locke") {
      openLockeDialog(ctx, session);
      return true;
    }

    if (btn === "call_daily") {
      btn = "12345";
      return handleTelephoneLockeDialogReturn(ctx, session, "3898", { buttonClicked: "12345" });
    }

    // Disconnected number fallback
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wDisconnected``", 774)
      .addTextbox("The number you have tried to reach is disconnected. Please check yourself before you wreck yourself.")
      .addQuickExit()
      .endDialog("3898", "Hang Up", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  // 2. Locke & Untradeables Price Selection (lock_price_*)
  if (btn.startsWith("lock_price_")) {
    const itemId = parseInt(btn.replace("lock_price_", ""), 10);
    const def = ctx.itemsDb.get(itemId);
    if (!def) return true;
    session.lastLockeItem = itemId;

    const lockeEntry = GTPS3_LOCKE_ITEMS.find(i => i.itemId === itemId);
    const priceWl = lockeEntry?.priceWl || (itemId === 4450 ? 100 : itemId === 4452 ? 500 : itemId === 4298 ? 200 : itemId === 4300 ? 1000 : 100);
    const priceText = priceWl > 200
      ? `${Math.floor(priceWl / 100)} Diamond Lock`
      : `${priceWl} World Locks`;

    const wl = session.account.inventory.find(s => s.itemId === 242)?.count || 0;
    const dl = session.account.inventory.find(s => s.itemId === 1796)?.count || 0;

    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", `\`9Buy ${def.name}?\`\``, itemId)
      .addSmalltext("`4A rare and precious artifact.`4")
      .addSmalltext(`\`1Price: ${priceText}\`\``)
      .addSpacer("small")
      .addTextbox(`How many ${def.name} do you want to buy, for ${priceText} each?`)
      .addTextInput("howmuch", "", "1", 5)
      .addSmalltext(`You have ${wl} World Locks, ${dl} Diamond Lock.`)
      .addButton("lock_item_", "`9Purchase``")
      .addQuickExit()
      .endDialog("locke_purchase", "No thanks", "");
    OnDialogRequest(session, dlg);
    return true;
  }

  // 3. Purchase Confirmation (lock_item_)
  if (btn === "lock_item_") {
    const itemId = session.lastLockeItem;
    if (!itemId) return true;
    const def = ctx.itemsDb.get(itemId);
    if (!def) return true;

    const count = Math.max(1, Math.min(200, parseInt(kv.howmuch || "1", 10) || 1));
    const lockeEntry = GTPS3_LOCKE_ITEMS.find(i => i.itemId === itemId);
    const unitPriceWl = lockeEntry?.priceWl || 100;
    const totalPriceWl = unitPriceWl * count;

    const wlSlot = session.account.inventory.find(s => s.itemId === 242);
    const dlSlot = session.account.inventory.find(s => s.itemId === 1796);
    const bglSlot = session.account.inventory.find(s => s.itemId === 7188);

    const wl = wlSlot?.count || 0;
    const dl = dlSlot?.count || 0;
    const bgl = bglSlot?.count || 0;

    const totalAvailableWl = wl + (dl * 100) + (bgl * 10000);
    if (totalAvailableWl < totalPriceWl) {
      OnConsoleMessage(session, "`4You don't have enough World Locks or Diamond Locks!``");
      return true;
    }

    // Deduct cost
    let remainingToDeduct = totalPriceWl;
    if (wl >= remainingToDeduct) {
      ctx.consumeInventoryItem(session, 242, remainingToDeduct, true);
    } else {
      if (wl > 0) {
        remainingToDeduct -= wl;
        ctx.consumeInventoryItem(session, 242, wl, true);
      }
      const dlNeeded = Math.ceil(remainingToDeduct / 100);
      if (dl >= dlNeeded) {
        ctx.consumeInventoryItem(session, 1796, dlNeeded, true);
        const changeWl = (dlNeeded * 100) - remainingToDeduct;
        if (changeWl > 0) {
          ctx.giveInventoryItem(session, 242, changeWl, true);
        }
      } else {
        // Spend BGL if necessary
        const bglNeeded = Math.ceil(remainingToDeduct / 10000);
        ctx.consumeInventoryItem(session, 7188, bglNeeded, true);
        const changeWl = (bglNeeded * 10000) - remainingToDeduct;
        const changeDl = Math.floor(changeWl / 100);
        const remWl = changeWl % 100;
        if (changeDl > 0) ctx.giveInventoryItem(session, 1796, changeDl, true);
        if (remWl > 0) ctx.giveInventoryItem(session, 242, remWl, true);
      }
    }

    // Award item
    ctx.giveInventoryItem(session, itemId, count, true);

    // Audio and World announcement
    if (session.world) {
      for (const p of session.world.peers) {
        OnConsoleMessage(p, `\`9[${session.account.name} bought ${count} ${def.name} for ${totalPriceWl} World Lock]`);
        p.peer.sendPacket(0, buildTankPacket({ type: 17, netId: session.netId }), true);
      }
    }
    return true;
  }

  return false;
}
