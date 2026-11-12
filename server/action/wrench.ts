import { canWorldAct } from './world-moderation';
import { activeMods } from '../playmods/model';
import { progression } from "../progression/service";
import { ACHIEVEMENTS } from "../progression/catalog";
import { equippedAbilities, hasRaymanFist } from "../playmods/equipment";
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
      .customButton('my_worlds','gui_wrench_my_worlds')
      .customButton('alist','gui_wrench_achievements')
      .raw(`add_custom_label|(${ACHIEVEMENTS.filter(a=>p.earned[a.id]).length}/${ACHIEVEMENTS.length})|target:alist;top:0.72;left:0.5;size:small|`)
      .customButton('emojis','gui_wrench_growmojis')
      .customBreak().addSpacer('small').customSpacing(0,0);
    const mods=activeMods(acct);
    const equipmentEffects: Array<{title:string; icon:number}> = [];
    const abilities=equippedAbilities(acct);
    if(abilities.damage.length) equipmentEffects.push({title:'Enhanced Digging',icon:abilities.damage[0]});
    if(abilities.punchRange.length) equipmentEffects.push({title:'Punch Range',icon:abilities.punchRange[0]});
    if(abilities.buildRange.length) equipmentEffects.push({title:'Build Range',icon:abilities.buildRange[0]});
    if(abilities.doubleJump.length) equipmentEffects.push({title:'Double Jump',icon:abilities.doubleJump[0]});
    if(abilities.speedy.length) equipmentEffects.push({title:'Speedy',icon:abilities.speedy[0]});
    if(acct.inventory.some(i=>i.equipped && i.count>0 && i.itemId===11094)) equipmentEffects.push({title:'Extended Punch and Build Range',icon:11094});
    if(hasRaymanFist(acct)) equipmentEffects.push({title:"Rayman's Fist",icon:5480});
    if(mods.length || equipmentEffects.length)dlg.addTextbox('`wActive effects:``');
    for(const mod of mods){
      const remaining=Math.max(0,Math.ceil((acct.playmods!.find(m=>m.id===mod.id)!.expiresAt-Date.now())/1000));
      dlg.addLabelWithIcon('small',`\`w${mod.title}\`\` (\`w${remaining}s\`\` left)`,mod.icon);
    }
    for(const effect of equipmentEffects) dlg.addLabelWithIcon('small',`\`w${effect.title}\`\``,effect.icon);
    dlg.addSpacer('small')
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

export { requestTrade as handleTradeStart } from "./trade";
