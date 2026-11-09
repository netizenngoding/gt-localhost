import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";

export function handleQuit(ctx: ServerContext, session: PlayerSession): void {
  ctx.savePersistentState();
  session.peer.sendDisconnect();
}
