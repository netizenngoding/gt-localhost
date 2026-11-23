import { canWorldAct } from './world-moderation';
import { activeMods } from '../playmods/model';
import { WEARABLE_MOD_LABELS_BY_ITEM, WEARABLE_MODS_BY_ITEM } from '../playmods/wearable-mod-catalog';
import { WEARABLE_MESSAGES } from '../playmods/wearable-messages';
import { progression } from "../progression/service";
import { ACHIEVEMENTS } from "../progression/catalog";
import { hasRaymanFist } from "../playmods/equipment";
import { xpRequired } from "../progression/model";
import { hasPermission, canModerate, displayName, rankOf, RANKS } from "../ranks";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";

export function handleWrenchPlayer(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const world = session.world;
  if (!world) return;
  const targetNetId = parseInt((kv.netid || "0").trim(), 10);
  if (!targetNetId) return;

  const target = Array.from(world.peers).find((p) => p.netId === targetNetId);
  if (!target) {
    OnConsoleMessage(session, "`4Player not found!``");
    return;
  }

  // Native GTPS3 command structure. Only functioning destinations are exposed;
  // missing quests/title/profile systems must not become fake buttons.
  if (target === session) {
    const acct=session.account,p=progression(acct);
    const dlg=new DialogBuilder().setDefaultColor("`o")
      .addPlayerInfo(displayName(session),p.level,p.xp,xpRequired(p.level))
      .addSpacer('small').addSpacer('small')
      .customSpacing(5,10)
      .customButton('notebook_edit','gui_wrench_notebook')
      .customButton('billboard_edit','gui_wrench_edit_billboard')
      .customButton('my_worlds','gui_wrench_my_worlds')
      .customButton('alist','gui_wrench_achievements')
      .raw(`add_custom_label|(${ACHIEVEMENTS.filter(a=>p.earned[a.id]).length}/${ACHIEVEMENTS.length})|target:alist;top:0.72;left:0.5;size:small|`)
      .customButton('emojis','gui_wrench_growmojis')
      .customBreak().addSpacer('small').customSpacing(0,0);
    const effects = getActiveEffectEntries(acct);
    if (effects.length) dlg.addTextbox('`wActive effects:``');
    for (const effect of effects) {
      dlg.addLabelWithIcon('small', `\`w${effect.title}\`\``, effect.icon);
    }
    dlg.addSpacer('small')
      .addButton('backpack_menu', `\`wOpen Backpack Storage (${(acct.storedItems || []).length}/${(acct.backpackLevel || 1) * 10})\`\``)
      .addTextbox(`You have \`w${acct.backpackSize}\`\` backpack slots.`)
      .addTextbox(`Current world: \`w${world.name}\`\` (${Math.floor(session.x/32)}, ${Math.floor(session.y/32)}) (${world.peers.size} person)`)
      .addTextbox(p.superSupporter?'You are a `5Super Supporter`` and have the `wRecycler`` and `w/warp``.':'You are not yet a `2Supporter`` or `5Super Supporter``.');
    if(acct.isGuest)dlg.addButtonWithIcon('acct_growid','`2Get Free GrowID!``',206);
    OnDialogRequest(session,dlg.addQuickExit().endDialog('popup','','Continue'));
    return;
  }

  // Dialog layout and button names follow the C++ player popup.
  const dlg = new DialogBuilder().embedData("netID", target.netId).setDefaultColor("`o")
    .addLabelWithIcon("big", `${displayName(target)} \`0(\`\`\`2${progression(target.account).level}\`\`\`0)\`\``,18)
    .addSpacer("small").addButton("trade", "`wTrade``");
  if(canWorldAct(session,target,world)) { dlg.addButton("kick","`4Kick``").addButton("pull","`5Pull``"); if(!hasPermission(target.account,"moderate"))dlg.addButton("worldban","`4World Ban``"); }
  if(!(session.account.friendIds||[]).includes(target.account.userId)) dlg.addButton("friend_add","`wAdd as friend``");
  dlg.addQuickExit();OnDialogRequest(session,dlg.endDialog("popup","","Continue"));
}

export function getActiveEffectEntries(account: PlayerSession["account"]): Array<{ title: string; icon: number }> {
  const entries: Array<{ title: string; icon: number }> = [];
  const seenTitles = new Set<string>();
  const addEffect = (title: string, icon: number): void => {
    const key = title.trim().toLocaleLowerCase();
    if (!key || seenTitles.has(key)) return;
    seenTitles.add(key);
    entries.push({ title, icon });
  };

  for (const mod of activeMods(account)) {
    const expiresAt = account.playmods?.find(active => active.id === mod.id)?.expiresAt ?? Date.now();
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    addEffect(`${mod.title} (${remaining}s left)`, mod.icon);
  }

  for (const slot of account.inventory) {
    if (!slot.equipped || slot.count <= 0) continue;
    const wikiLabel = WEARABLE_MOD_LABELS_BY_ITEM[slot.itemId];
    const explicitMessage = WEARABLE_MESSAGES[slot.itemId];
    // Use the item's exact {{Item/Mod}} display label. A dash means the wiki
    // intentionally has no named mod; explicit item-message entries cover
    // named exceptions such as Focused Eyes.
    const titles = wikiLabel && wikiLabel !== "-"
      ? [wikiLabel]
      : explicitMessage
        ? [explicitMessage[0]]
        : WEARABLE_MODS_BY_ITEM[slot.itemId] || [];
    for (const title of titles) addEffect(title, slot.itemId);
  }

  if (hasRaymanFist(account)) addEffect("Rayman's Fist", 5480);
  return entries;
}

export { requestTrade as handleTradeStart } from "./trade";
