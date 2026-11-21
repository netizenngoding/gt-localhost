import { makePlayPositionedPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export function OnPlayPositioned(session: PlayerSession, file: string, delayMs = 0): void {
  const netId = session.world ? session.netId : -1;
  session.peer.sendPacket(0, makePlayPositionedPacket(netId, file, delayMs), true);
}

// UI/world-transition sounds (door, gazette). These must not depend on the
// local NetAvatar still existing: during a world change the avatar is torn down
// before the queued 3D sound can resolve, which is why door audio was flaky.
export function OnPlaySound(session: PlayerSession, file: string, delayMs = 0): void {
  session.peer.sendPacket(0, makePlayPositionedPacket(-1, file, delayMs), true);
}

export function broadcastPositionedSfx(
  world: WorldInstance | null,
  netId: number,
  file: string,
  delayMs = 0,
  exclude?: PlayerSession
): void {
  if (!world) return;
  const pkt = makePlayPositionedPacket(netId, file, delayMs);
  for (const p of world.peers) if (p !== exclude) p.peer.sendPacket(0, pkt, true);
}
