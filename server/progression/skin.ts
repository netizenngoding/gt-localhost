import type { ServerContext } from '../database/context';
import type { PlayerSession, PlayerAccount } from '../database/peer';
import { ALLOWLISTED_SKIN_COLORS } from '../proton/packet';
import { hasPermission } from '../ranks';
import { isSuperSupporter } from './service';
import { OnConsoleMessage, applySkinColorUpdate } from '../onVariant';
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
