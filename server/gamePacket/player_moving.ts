import { TANK_FLAG_FACING_LEFT, type TankPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import { OnSetPos } from "../onVariant";

export function handlePlayerMoving(
  session: PlayerSession,
  rawData: Buffer,
  tank: TankPacket
): void {
  const world = session.world;
  if (!world || (session.respawnUntil && Date.now() < session.respawnUntil)) return;

  const nx = tank.x ?? session.x;
  const ny = tank.y ?? session.y;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
  if (nx < -32 || nx > world.width * 32 + 32 || ny < -32 || ny > world.height * 32 + 32) {
    OnSetPos(session, session.x, session.y);
    return;
  }

  // The native Frozen state bit suppresses player input. Do not pin or rewind
  // position here: the client continues to integrate momentum and gravity,
  // especially when frozen in mid-air. Repeated OnSetPos fights that physics
  // and causes visible jitter/desynchronisation. As with ordinary movement,
  // this server accepts client physics; the state bit is not anti-cheat.
  session.x = nx;
  session.y = ny;
  session.facingLeft = ((tank.flags ?? 0) & TANK_FLAG_FACING_LEFT) !== 0;

  // Relay movement packet to all other players in the same world with netId stamped
  if (world.peers.size > 1) {
    const relay = Buffer.from(rawData);
    relay.writeInt32LE(session.netId, 4 + 4);
    for (const other of world.peers) {
      if (other !== session) {
        other.peer.sendPacket(0, relay, false);
      }
    }
  }
}
