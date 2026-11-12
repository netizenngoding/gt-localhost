import { isFrozen } from "./hazards";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";

export function handleRespawn(
  ctx: ServerContext,
  session: PlayerSession,
  isSpike = false
): void {
  if (session.pullImmuneUntil && Date.now()<session.pullImmuneUntil) return;
  if (isSpike && isFrozen(session)) return;
  if (isSpike) {
    OnConsoleMessage(session, "`4You hit a spike!``");
  }
  ctx.respawnPlayer(session, isSpike);
}
