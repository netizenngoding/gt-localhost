import { displayName } from "../ranks";
import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

export function buildSpawnText(s: PlayerSession, isLocal: boolean): string {
  // An invisible staff member keeps the netId (so chat bubbles still attach)
  // but must not show a name plate to anybody else.
  const spawnName = s.invis && !isLocal ? "" : displayName(s);
  const lines = [
    "spawn|avatar",
    `netID|${s.netId}`,
    `userID|${s.account.userId}`,
    "colrect|0|0|20|30",
    `posXY|${Math.round(s.x)}|${Math.round(s.y)}`,
    `name|${spawnName}`,
    `country|${s.account.flag || "id"}`,
    `invis|${s.invis ? 1 : 0}`,
    `mstate|${s.mstate}`,
    `smstate|${s.smstate}`,
    "onlineID|",
  ];
  if (s.account.flag) lines.push(`flag|${s.account.flag}`);
  if (isLocal) lines.push("type|local");
  return lines.join("\n") + "\n";
}

export function OnSpawn(target: PlayerSession, subject: PlayerSession, isLocal: boolean): void {
  target.peer.sendPacket(0, makeVariantPacket(["OnSpawn", buildSpawnText(subject, isLocal)]), true);
}
