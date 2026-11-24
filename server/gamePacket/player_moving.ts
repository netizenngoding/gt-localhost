import {processMovementHazard,tickSessionHazardRegen} from "../action/hazards";
import { INVIS_STATE_BITS } from "../database/peer";
import type {ServerContext} from "../database/context";
import { TANK_FLAG_FACING_LEFT, type TankPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import { broadcastIconState, OnConsoleMessage, OnPlayPositioned, OnSetPos, OnTalkBubble } from "../onVariant";
import { GTPS3_GEIGER_REWARDS } from "../database/recipes";

export function handlePlayerMoving(
  session: PlayerSession,
  rawData: Buffer,
  tank: TankPacket,
  ctx?: ServerContext
): void {
  const world = session.world;
  if (!world || (session.respawnUntil && Date.now() < session.respawnUntil) || (session.pullUntil && Date.now() < session.pullUntil)) return;

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
  const oldX=session.x, oldY=session.y;
  session.x = nx;
  session.y = ny;
  if (session.brb && (nx !== oldX || ny !== oldY)) {
    session.brb = false;
    broadcastIconState(world, session, 0, true);
  }
  const flags = tank.flags ?? 0;
  session.facingLeft = (flags & TANK_FLAG_FACING_LEFT) !== 0;
  const now = Date.now();
  const diedToHazard = ctx ? processMovementHazard(ctx, session, flags, oldX, oldY, now) : false;
  if (!diedToHazard) {
    tickSessionHazardRegen(session, now);
  }

  // Geiger Counter tracking (LyNnz01 GTPS3 Source.cpp:215-295)
  if (ctx && session.account.inventory.some((s) => s.itemId === 2204 && s.equipped)) {
    const hasIrradiated = (session.account.playmods || []).some((m) => m.id === "irradiated" && m.expiresAt > now);
    if (!hasIrradiated) {
      if (!world.geigerTarget) {
        world.geigerTarget = {
          x: Math.floor(Math.random() * (world.width - 4) + 2) * 32,
          y: Math.floor(Math.random() * (world.height - 10) + 2) * 32,
        };
      }
      if (now - (session.lastGeigerPingAt || 0) > 1500) {
        session.lastGeigerPingAt = now;
        const diff = Math.hypot(session.x - world.geigerTarget.x, session.y - world.geigerTarget.y) / 32;
        if (diff <= 1) {
          ctx.consumeInventoryItem(session, 2204, 1, true);
          ctx.giveInventoryItem(session, 2286, 1, true);
          const prizeId = GTPS3_GEIGER_REWARDS[Math.floor(Math.random() * GTPS3_GEIGER_REWARDS.length)];
          ctx.giveInventoryItem(session, prizeId, 1, true);
          if (!session.account.playmods) session.account.playmods = [];
          session.account.playmods.push({ id: "irradiated", expiresAt: now + 30 * 60 * 1000 });
          ctx.savePlayersNow();
          world.geigerTarget = {
            x: Math.floor(Math.random() * (world.width - 4) + 2) * 32,
            y: Math.floor(Math.random() * (world.height - 10) + 2) * 32,
          };
          OnPlayPositioned(session, "audio/dialog_confirm.wav");
          const prizeDef = ctx.itemsDb.get(prizeId);
          const prizeName = prizeDef ? prizeDef.name : "Prize";
          OnTalkBubble(session, session.netId, `\`2Found radiation! You got \`$${prizeName}\`\`!`, 0, true);
          OnConsoleMessage(session, "You are aglow with radiation! (`$Irradiated`` mod added, `$30 mins`` left)");
        } else {
          OnPlayPositioned(session, "audio/geiger_click.wav");
        }
      }
    }
  }

  // Relay movement packet to all other players in the same world with netId stamped.
  // An invisible player still needs this: their avatar stays registered on the
  // client (spawned with invis|1) so OnTalkBubble keeps tracking them, and the
  // avatar itself never renders. Clothes/state/billboards stay filtered.
  if (world.peers.size > 1) {
    const relay = Buffer.from(rawData);
    relay.writeInt32LE(session.netId, 4 + 4);
    // The client reads the avatar state mask from this packet, so an invisible
    // player's own movement must keep the invis bits or the body pops back.
    if (session.invis) {
      const stateOff = 4 + 12;
      const bits = relay.readUInt32LE(stateOff) | INVIS_STATE_BITS;
      relay.writeUInt32LE(bits >>> 0, stateOff);
    }
    for (const other of world.peers) {
      if (other !== session) {
        other.peer.sendPacket(0, relay, false);
      }
    }
  }
}
