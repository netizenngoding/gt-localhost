import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest, OnPlayPositioned } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";

// Requests bind to live session objects, not forgeable netids across worlds.
const requests = new WeakMap<PlayerSession, Set<PlayerSession>>();
export function handleFriends(_ctx: ServerContext, session: PlayerSession): void {
  const dlg=new DialogBuilder().setDefaultColor('`o').addLabelWithIcon('big','`wSocial Portal``',1366)
    .addSpacer('small').addButton('showfriend','`wShow Friends``').addQuickExit();
  OnDialogRequest(session,dlg.endDialog('socialportal','','Back'));
}
export function showFriendList(ctx:ServerContext,s:PlayerSession,all=false):void {
 const ids=s.account.friendIds||[], online=[...ctx.sessions].filter(x=>ids.includes(x.account.userId));
 const d=new DialogBuilder().setDefaultColor('`o').addLabelWithIcon('big',`${online.length} of ${ids.length} \`wFriends Online\`\``,1366).addSpacer('small');
 if(!ids.length)d.addTextbox('Use the wrench on a player, then choose Add as friend.');
 else if(!online.length)d.addTextbox('None of your friends are currently online.');
 for(const id of ids){const p=[...ctx.sessions].find(x=>x.account.userId===id),a=[...ctx.accounts.values()].find(x=>x.userId===id);if(!p&&!all)continue;
  const name=(a?.name||'Unknown').replace(/[^A-Za-z0-9_]/g,'').slice(0,18);
  d.addButton(`friend_${id}`,`${p?'`2':'`4'}${name}\`\` ${p ? '('+(p.world?.name||'World Menu')+')':'(offline)'}`);
 }
 d.addButton('friend_all',all?'Show online':'Show offline too').addButton('back','Back').addQuickExit();
 OnDialogRequest(s,d.endDialog('friends','','Close'));
}
export function friendRequest(ctx:ServerContext,s:PlayerSession,netid:number):void {
 const other=[...(s.world?.peers||[])].find(p=>p.netId===netid);
 if(!other||other===s || !ctx.sessions.has(other) || Math.abs(s.x-other.x)>96 || Math.abs(s.y-other.y)>96){OnConsoleMessage(s,'`4Stand closer to that player.``');return;}
 const a=s.account,b=other.account;
 if((a.friendIds||[]).includes(b.userId)){OnConsoleMessage(s,'You are already friends.');return;}
 if(requests.get(other)?.has(s)){
  requests.get(other)!.delete(s);a.friendIds??=[];b.friendIds??=[];
  if(a.friendIds.length>=200||b.friendIds.length>=200){OnConsoleMessage(s,'`4Friend list full.``');return;}
  a.friendIds.push(b.userId);b.friendIds.push(a.userId);
  try{ctx.savePlayersNow()}catch(e){a.friendIds.pop();b.friendIds.pop();throw e;}
  OnConsoleMessage(s,`You are now friends with ${b.name}!`);OnConsoleMessage(other,`You are now friends with ${a.name}!`);return;
 }
 const sent=requests.get(s)||new Set<PlayerSession>();sent.add(other);requests.set(s,sent);
 OnPlayPositioned(other,'audio/friend_beep.wav');
 OnConsoleMessage(s,`Friend request sent to ${b.name}.`);OnConsoleMessage(other,`${a.name} wants to be your friend! Wrench them and choose Add as friend.`);
}
export function friendDialogReturn(ctx:ServerContext,s:PlayerSession,dlg:string,button:string):boolean {
 if(dlg==='playerportal' && button==='socialportal'){handleFriends(ctx,s);return true;}
 if(dlg==='socialportal'||dlg==='social_portal'){if(button==='showfriend')showFriendList(ctx,s);return true;}
 if(dlg==='friends'){
  if(button==='back'){handleFriends(ctx,s);return true}if(button==='friend_all'){showFriendList(ctx,s,true);return true}
  const m=/^friend_(\d+)$/.exec(button);if(m){const id=Number(m[1]);if(!(s.account.friendIds||[]).includes(id))return true;
   const a=[...ctx.accounts.values()].find(x=>x.userId===id);const d=new DialogBuilder().addLabelWithIcon('big',`\`w${a?.name||'Friend'}\`\``,1366).addButton(`remove_${id}`,'`4Remove Friend``').addQuickExit();OnDialogRequest(s,d.endDialog('friend_edit','Back',''));}
  return true;
 }
 if(dlg==='friend_edit'){
  const m=/^remove_(\d+)$/.exec(button);if(m){const id=Number(m[1]),a=s.account,b=[...ctx.accounts.values()].find(x=>x.userId===id);if(!(a.friendIds||[]).includes(id))return true;
   const oldA=a.friendIds,oldB=b?.friendIds;a.friendIds=(a.friendIds||[]).filter(x=>x!==id);if(b)b.friendIds=(b.friendIds||[]).filter(x=>x!==a.userId);
   try{ctx.savePlayersNow()}catch(e){a.friendIds=oldA;if(b)b.friendIds=oldB;throw e;}
  }showFriendList(ctx,s,true);return true;
 }
 return false;
}
