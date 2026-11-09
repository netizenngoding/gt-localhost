import { buildTankPacket, PACKET_SEND_ITEM_DATABASE_DATA, TANK_FLAG_EXTENDED } from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage } from "../onVariant";
import zlib from "node:zlib";

export function handleRefreshItemData(ctx: ServerContext, session: PlayerSession): void {
  OnConsoleMessage(session, "One moment, updating item data...");
  const compressed = zlib.deflateSync(ctx.itemsDb.rawItemsDat);
  session.peer.sendPacket(
    0,
    buildTankPacket({
      type: PACKET_SEND_ITEM_DATABASE_DATA,
      flags: TANK_FLAG_EXTENDED,
      value: ctx.itemsDb.rawItemsDat.length,
      extendedData: compressed,
    }),
    true
  );
}
