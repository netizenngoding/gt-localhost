import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { RequestWorldSelectMenu } from "../onVariant";

export function handleJoinRequest(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  ctx.joinWorld(session, kv.name || "");
}
