import { effectiveSkin } from "../playmods/model";
import { makeVariantPacket } from "../proton/packet";
import { getClothingVector, type PlayerSession } from "../database/peer";
import type { ItemDatabase } from "../database/items";
import type { WorldInstance } from "../database/world";

export interface ChatPortrait { clothes: number[]; skin: number; }
let nextPortraitId = 0;
export function chatPortrait(subject: PlayerSession, items: ItemDatabase): ChatPortrait {
  return { clothes: [...getClothingVector(subject.account, items)], skin: effectiveSkin(subject.account) >>> 0 };
}
export function makeConsoleMessagePacket(message: string, portrait?: ChatPortrait): Buffer {
  if (!portrait) return makeVariantPacket(["OnConsoleMessage", message]);
  const id = String(++nextPortraitId % 10000000000).padStart(10, "0");
  // Zero-width native color controls identify this log row without changing its
  // typography. Six measured spaces reserve the icon; bubbles never use this.
  const marker = "`o`o`o" + [...id].map(d => "`" + d).join("") + "`o      ";
  const header = /_CT:\[[^\]]+\]_ ?/.exec(message);
  const at = header ? header.index + header[0].length : 0;
  const tagged = message.slice(0, at) + marker + message.slice(at);
  return makeVariantPacket(["OnConsoleMessage", tagged, JSON.stringify({v:1,id,clothes:portrait.clothes,skin:portrait.skin})]);
}
export function OnConsoleMessage(session: PlayerSession, message: string, portrait?: ChatPortrait): void {
  session.peer.sendPacket(0, makeConsoleMessagePacket(message, portrait), true);
}
export function broadcastConsoleMessage(world: WorldInstance, message: string, portrait?: ChatPortrait): void {
  const pkt = makeConsoleMessagePacket(message, portrait);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}
