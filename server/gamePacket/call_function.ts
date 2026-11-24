import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";

export function handleCallFunction(
  _ctx: ServerContext,
  _session: PlayerSession,
  _extendedData: Buffer | undefined
): void {
  // Client-initiated PACKET_CALL_FUNCTION variants are unused now that dialog theme
  // customization runs natively inside the WASM dialog engine via `add_color_slider|`.
}
