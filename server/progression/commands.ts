import type { ServerContext } from '../database/context';
import type { PlayerSession } from '../database/peer';
import { hasPermission } from '../ranks';
import { OnConsoleMessage, OnDialogRequest, OnSetBux, broadcastNameChanged } from '../onVariant';
import { DialogBuilder } from '../tools/create_dialog';
import { ACHIEVEMENTS, achievementTitle, achievementDescription, classicAchievementIcon, lockedAchievementIcon } from './catalog';
import { MAX_LEVEL, xpRequired } from './model';
import { progression, recordProgress } from './service';
export function showAchievements(s: PlayerSession): void {
 const p = progression(s.account);
 const dlg = new DialogBuilder().setDefaultColor('`o');
 // Render the same native two-line achievement rows as the client, with a
 // division-coloured question mark until earned. Unsupported goals are not
 // presented as obtainable: only server-tracked achievements appear here.
 const order: Record<string,number> = {Bronze:0, Silver:1, Gold:2};
 const rows = [...ACHIEVEMENTS].sort((a,b)=>(order[a.division]??99)-(order[b.division]??99)||a.classicId-b.classicId);
 for (const a of rows) {
   const earned = !!p.earned[a.id];
   const progress = Math.max(0, Math.min(a.target, p.counters[a.metric] || 0));
   const status = earned ? achievementDescription(a) : a.target === 1 ? 'Not achieved!' : `Progress: ${Math.floor(progress / a.target * 100)}%`;
   dlg.addAchievement(achievementTitle(a), status, earned ? classicAchievementIcon(a.classicId) : lockedAchievementIcon(a.division));
 }
 OnDialogRequest(s, dlg.addQuickExit().endDialog('achievements','Back',''));
}
export function handleProgressionCommand(ctx: ServerContext, s: PlayerSession, cmd: string, parts: string[]): boolean {
 if (cmd === 'hidestatus') {
   const p=progression(s.account); if (!p.superSupporter) { OnConsoleMessage(s,'Super Supporter required.'); return true; }
   p.hideStatus=!p.hideStatus;ctx.savePlayersNow();ctx.sendCharacterState(s);return true;
 }
 if (cmd === 'achievements') { showAchievements(s); return true; }
 if (cmd === 'level') { const p=progression(s.account); OnConsoleMessage(s,`Level ${p.level} | XP ${p.xp}/${xpRequired(p.level)}${p.superSupporter ? ' | Super Supporter' : ''}`); return true; }
 if (cmd !== 'setlevel' && cmd !== 'givexp') return false;
 if (!hasPermission(s.account,'debug')) { OnConsoleMessage(s,'Developer permission required.'); return true; }
 const amount = Number(parts[1]);
 if (parts.length < 2 || parts.length > 3 || !/^\d+$/.test(parts[1]) || !Number.isSafeInteger(amount) || amount < 1 || amount > (cmd==='setlevel' ? MAX_LEVEL : 10000000)) {
   OnConsoleMessage(s,`Usage: /${cmd} <${cmd==='setlevel'?'1-125':'1-10000000'}> [online player]`); return true;
 }
 const target = parts[2] ? [...ctx.sessions].find(p=>p.account.name.toLowerCase()===parts[2].toLowerCase()) : s;
 if (!target) { OnConsoleMessage(s,'Player is not online.'); return true; }
 if (cmd === 'setlevel') { const p=progression(target.account); p.level=amount; p.xp=0; }
 recordProgress(ctx,target,undefined,0,cmd==='givexp'?amount:0);
 ctx.sendCharacterState(target); OnSetBux(target); broadcastNameChanged(target);
 OnConsoleMessage(s,`${cmd}: ${target.account.name}, level ${progression(target.account).level}.`);
 return true;
}
