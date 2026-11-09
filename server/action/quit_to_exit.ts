import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { RequestWorldSelectMenu } from "../onVariant";

export function handleQuitToExit(ctx: ServerContext, session: PlayerSession): void {
  ctx.leaveCurrentWorld(session, true);
  ctx.savePersistentState();
  RequestWorldSelectMenu(session, ctx.worlds);
}
