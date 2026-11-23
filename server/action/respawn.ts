import { isFrozen } from "./hazards";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";

export function handleRespawn(
  ctx: ServerContext,
  session: PlayerSession,
  isSpike = false
): void {
  if (session.pullImmuneUntil && Date.now()<session.pullImmuneUntil) return;
  if (isSpike && isFrozen(session)) return;
  ctx.respawnPlayer(session, isSpike);
}
