import type { PlayerAccount, PlayerSession } from '../database/peer';
import type { ServerContext } from '../database/context';
import { OnConsoleMessage, OnSetBux, broadcastNameChanged } from '../onVariant';
import { makeVariantPacket, makeParticleEffectPacket, NATIVE_EFFECT_ACHIEVEMENT } from '../proton/packet';
import { ACHIEVEMENTS } from './catalog';
import { addXp, normalizeProgression, type Progression } from './model';
export function progression(account: PlayerAccount): Progression {
  return account.progression ??= normalizeProgression();
}
export function isSuperSupporter(account: PlayerAccount): boolean {
  return !!account.progression?.superSupporter || (account.progression?.level ?? 1) >= 50;
}
export type MetricEvent = 'consumables_used'|'blocks_placed'|'trees_harvested'|'blocks_broken'|'gems_spent'|'items_trashed'|'locks_used'|'world_locks_used';
export function evaluate(account: PlayerAccount, otherPlayers = 0): string[] {
  const p = progression(account), c = p.counters;
  if (p.level >= 50) p.superSupporter = true;
  c.level = Math.max(c.level || 0, p.level);
  c.backpack = Math.max(c.backpack || 0, account.backpackSize);
  c.gems_held = Math.max(c.gems_held || 0, account.gems);
  c.other_players = Math.max(c.other_players || 0, otherPlayers);
  c.supporter = p.superSupporter ? 1 : 0;
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.earned[a.id] && (c[a.metric] || 0) >= a.target) { p.earned[a.id] = Date.now(); unlocked.push(a.id); }
  }
  return unlocked;
}
const notificationUntil = new WeakMap<PlayerSession, number>();
export function recordProgress(ctx: ServerContext, s: PlayerSession, metric?: MetricEvent, amount = 1, xp = 0): void {
  const p = progression(s.account), beforeLevel = p.level, beforeSupporter = p.superSupporter;
  if (metric && Number.isSafeInteger(amount) && amount > 0 && amount <= 10000000) p.counters[metric] = Math.min(Number.MAX_SAFE_INTEGER, (p.counters[metric] || 0) + amount);
  addXp(p, xp);
  const unlocked = evaluate(s.account, Math.max(0, (s.world?.peers.size ?? 1) - 1));
  ctx.dirty = true;
  // Save before announcing an unlock; no duplicate reward/announcement after reconnect.
  ctx.savePlayersNow();
  for (const id of unlocked) {
    const a = ACHIEVEMENTS.find(a => a.id === id)!;
    const text = `\`2Earned achievement: \`w${a.title}\`\``;
    OnConsoleMessage(s, text);
    const delay = Math.max(0, (notificationUntil.get(s) || 0) - Date.now());
    notificationUntil.set(s, Date.now() + delay + 6000);
    const bubble = makeVariantPacket(['OnTalkBubble', {type:'i32',value:s.netId}, text,
      {type:'i32',value:0}, {type:'i32',value:0}], -1, delay);
    // f320 effect 48 creates the achievement particles AND plays achievement.wav.
    // Do not separately play its audio or substitute an OnAddNotification popup.
    const effect = makeParticleEffectPacket(NATIVE_EFFECT_ACHIEVEMENT, s.x+16, s.y+16, 0, delay);
    for (const viewer of s.world?.peers || [s]) {
      viewer.peer.sendPacket(0, bubble, true);
      viewer.peer.sendPacket(0, effect, true);
    }
  }
  if (p.level !== beforeLevel) OnConsoleMessage(s, `You are now level ${p.level}!`);
  if (p.superSupporter !== beforeSupporter) {
    ctx.sendCharacterState(s); OnSetBux(s); broadcastNameChanged(s);
    OnConsoleMessage(s, '`5Super Supporter unlocked at level 50!`` Extra skin colors and recycling are now available.');
  }
}
