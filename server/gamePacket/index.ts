import {
  buildTankPacket,
  PACKET_ITEM_ACTIVATE_OBJECT_REQUEST,
  PACKET_ITEM_ACTIVATE_REQUEST,
  PACKET_PING_REPLY,
  PACKET_PING_REQUEST,
  PACKET_SET_ICON_STATE,
  PACKET_STATE,
  PACKET_TILE_ACTIVATE_REQUEST,
  PACKET_TILE_CHANGE_REQUEST,
  type TankPacket,
} from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { handleItemActivateRequest } from "./item_activate";
import { handleItemActivateObject } from "./item_activate_object";
import { handlePlayerMoving } from "./player_moving";
import { handleTileActivateRequest, handleTileChangeRequest } from "./tile_change_req";

export function handleGamePacket(
  ctx: ServerContext,
  session: PlayerSession,
  rawData: Buffer,
  tank: TankPacket
): void {
  switch (tank.type) {
    case PACKET_PING_REQUEST:
      session.peer.sendPacket(
        0,
        buildTankPacket({
          type: PACKET_PING_REPLY,
          netId: 0,
          targetNetId: tank.value ?? 0,
          x: 64.0,
          y: 64.0,
          speedX: 1000.0,
          speedY: 250.0,
        }),
        false
      );
      return;

    case PACKET_STATE:
      handlePlayerMoving(session, rawData, tank, ctx);
      return;

    case PACKET_TILE_CHANGE_REQUEST:
      handleTileChangeRequest(ctx, session, tank);
      return;

    case PACKET_TILE_ACTIVATE_REQUEST:
      handleTileActivateRequest(ctx, session, tank);
      return;

    case PACKET_ITEM_ACTIVATE_REQUEST:
      handleItemActivateRequest(ctx, session, tank.value ?? 0);
      return;

    case PACKET_ITEM_ACTIVATE_OBJECT_REQUEST:
      handleItemActivateObject(ctx, session, tank.value ?? 0);
      return;
    case PACKET_SET_ICON_STATE: {
      const world = session.world;
      if (!world) return;
      const state = tank.flags ?? tank.value ?? 0;
      if (state === 0 && session.brb) return;
      if (state !== 0 && state !== 2) session.brb = false;
      session.iconState = state;
      const relay = Buffer.from(rawData);
      if (relay.length >= 12) relay.writeInt32LE(session.netId, 8);
      session.lastIconStatePacket = state !== 0 ? Buffer.from(relay) : undefined;
      for (const other of world.peers) {
        if (other === session) continue;
        other.peer.sendPacket(0, relay, true);
      }
      return;
    }
  }
}
