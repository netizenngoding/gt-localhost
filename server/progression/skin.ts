import type { ServerContext } from '../database/context';
import type { PlayerSession, PlayerAccount } from '../database/peer';
import { ALLOWLISTED_SKIN_COLORS } from '../proton/packet';
import { hasPermission } from '../ranks';
import { isSuperSupporter } from './service';
import { OnConsoleMessage, OnDialogRequest, applySkinColorUpdate } from '../onVariant';
import { DialogBuilder } from '../tools/create_dialog';
import { gtSkinColorToRgbHex } from '../tools/string';
export function canUseSkin(a: PlayerAccount, color: number): boolean {
 if (!Number.isInteger(color) || color < 0 || color > 0xffffffff) return false;
 if ((color & 255) < 64) return false; // No invisible avatars through forged skin packets.
 return ALLOWLISTED_SKIN_COLORS.slice(0,8).includes(color) || isSuperSupporter(a) || hasPermission(a,'debug');
}
export function setSkin(ctx: ServerContext, s: PlayerSession, color: number): boolean {
 if (!canUseSkin(s.account,color)) { OnConsoleMessage(s,'This skin color requires Super Supporter (level 50).'); return false; }
 const before=s.account.skinColor;s.account.skinColor=color;
 try {ctx.savePlayersNow();} catch(e) {s.account.skinColor=before;throw e;}
 applySkinColorUpdate(s,s.world,true);return true;
}
export function showSkinMenu(s: PlayerSession): void {
 const d=new DialogBuilder().addLabelWithIcon('big','Skin Color',32);
 // First 14 values are native f2569's palette. Custom RGB entry covers further
 // tones; don't label guessed RGBA values as the official four Super colors.
 ALLOWLISTED_SKIN_COLORS.forEach((c,i)=>d.addButton(`skin_${c}`,`#${gtSkinColorToRgbHex(c)}${i>=8?' (Super Supporter)':''}`));
 if(isSuperSupporter(s.account) || hasPermission(s.account,'debug')) d.addSmalltext('More colors: /skin RRGGBB or /skin RRGGBBAA (alpha 40-FF). White: /skin FFFFFF.');
 OnDialogRequest(s,d.addQuickExit().endDialog('skin_menu','Close',''));
}
