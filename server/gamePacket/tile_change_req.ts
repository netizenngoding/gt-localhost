import {
  buildTankPacket,
  makeTileChangePacket,
  makeTileTreeStatePacket,
  makeTileUpdatePacket,
  PACKET_TILE_APPLY_DAMAGE,
  TANK_FLAG_FACING_LEFT,
  TILE_FLAG_FLIPPED,
  type SeedExtra,
  type TankPacket,
  type TileExtra,
  type WorldTile,
} from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { ItemDef } from "../database/items";
import type { PlayerSession } from "../database/peer";
import {
  canModifyWorldTile,
  recomputeWorldWeather,
  spawnOrMergeWorldDrop,
  type WorldInstance,
} from "../database/world";
import {
  broadcastConsoleMessage,
  broadcastPositionedSfx,
  broadcastSetCurrentWeather,
  OnTalkBubble,
  broadcastTalkBubble,
  OnConsoleMessage,
  OnDialogRequest,
  OnPlayPositioned,
  RequestWorldSelectMenu,
} from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { stripGtColors } from "../tools/string";
import {
  openDoorSettingsDialog,
  openLockSettingsDialog,
  openSignEditDialog,
  openWeatherPickerDialog,
} from "../action/dialog_return/tile_edit";
import { toggleWearableItem } from "./item_activate";

const GEM_ITEM_ID = 112;

export function handleTileActivateRequest(
  ctx: ServerContext,
  session: PlayerSession,
  tank: TankPacket
): void {
  const world = session.world;
  if (!world) return;
  const tx = tank.punchX ?? -1;
  const ty = tank.punchY ?? -1;
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return;

  const tile = world.tiles[ty * world.width + tx];
  const def = tile.fg ? ctx.itemsDb.get(tile.fg) : ctx.itemsDb.get(tile.bg);

  if (tile.fg === 6 || def?.isDoor) {
    if (tile.fg === 6) {
      // A white door is activated only while the avatar's center is in its tile.
      if (Math.floor((session.x + 10) / 32) !== tx || Math.floor((session.y + 15) / 32) !== ty) return;
    } else if (Math.abs(session.x + 10 - (tx * 32 + 16)) > 48 || Math.abs(session.y + 15 - (ty * 32 + 16)) > 64) return;
    const extra = tile.extra;
    // A Main Door exits regardless of stale/malicious destination metadata.
    if (tile.fg === 6) {
      OnPlayPositioned(session, "audio/door_open.wav");
      ctx.exitToWorldSelect(session);
    } else if (extra?.kind === "door" && extra.destination) {
      OnPlayPositioned(session, "audio/door_open.wav");
      ctx.joinWorld(session, extra.destination);
    } else if (canModifyWorldTile(session, world, tile)) {
      openDoorSettingsDialog(session, tx, ty);
    } else {
      OnPlayPositioned(session, "audio/punch_locked.wav");
      OnConsoleMessage(session, "`4This door is not linked!``");
    }
    return;
  }

  // Non-door tile activation must also be local; never accept a remote checkpoint.
  if (Math.abs(session.x + 10 - (tx * 32 + 16)) > 48 || Math.abs(session.y + 15 - (ty * 32 + 16)) > 64) return;
  if (tile.fg === 23) {
    session.account.spawnWorld = world.name;
    session.account.spawnX = tx * 32;
    session.account.spawnY = ty * 32;
    ctx.savePlayersNow();
    OnPlayPositioned(session, "audio/switch.wav");
    OnConsoleMessage(session, "`2Checkpoint saved!``");
    return;
  }

  if (def?.isWeather && canModifyWorldTile(session, world, tile)) {
    OnPlayPositioned(session, "audio/switch.wav");
    openWeatherPickerDialog(session, tx, ty);
    return;
  }

  if (tile.extra?.kind === "sign" && tile.extra.label) {
    OnConsoleMessage(session, `\`9Sign: \`w${tile.extra.label}\`\``);
  }
}

export function handleTileChangeRequest(
  ctx: ServerContext,
  session: PlayerSession,
  tank: TankPacket
): void {
  const world = session.world;
  if (!world) return;
  const tx = tank.punchX ?? -1;
  const ty = tank.punchY ?? -1;
  const itemId = tank.value ?? 18;
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return;

  const playerTileX = (session.x + 10) / 32;
  const playerTileY = (session.y + 15) / 32;
  const def = ctx.itemsDb.get(itemId);
  let reach = 6.5;
  let punchLine = 0;

  if (
    session.account.inventory.some(
      (s) => s.equipped && (s.itemId === 5480 || ctx.itemsDb.get(s.itemId)?.isRayman)
    )
  ) {
    reach = 12;
    punchLine = 3;
  } else if (session.account.inventory.some((s) => s.equipped && s.itemId === 98)) {
    reach = 10;
  }

  if (Math.abs(tx - playerTileX) > reach || Math.abs(ty - playerTileY) > reach) return;

  const tile = world.tiles[ty * world.width + tx];
  const now = Date.now();

  // 1. Wrench (id 32)
  if (itemId === 32) {
    if (tile.extra?.kind === "door") {
      if (!canModifyWorldTile(session, world, tile)) {
        OnTalkBubble(session, session.netId, "`4That area is locked!``", 0, true);
        return;
      }
      openDoorSettingsDialog(session, tx, ty);
      return;
    }
    if (tile.extra?.kind === "sign") {
      if (!canModifyWorldTile(session, world, tile)) {
        OnTalkBubble(session, session.netId, "`4That area is locked!``", 0, true);
        return;
      }
      openSignEditDialog(session, tx, ty);
      return;
    }
    if (tile.fg && tile.extra?.kind === "lock" && tile.extra.ownerUserId === session.account.userId) {
      openLockSettingsDialog(ctx, session, tx, ty);
      return;
    }
    if (tile.fg && ctx.itemsDb.get(tile.fg)?.isWeather && canModifyWorldTile(session, world, tile)) {
      openWeatherPickerDialog(session, tx, ty);
      return;
    }
    if (tile.fg && tile.extra?.kind === "seed") {
      const treeDef = ctx.itemsDb.get(tile.fg);
      if (treeDef) {
        const ageSec = Math.max(0, Math.floor((now - tile.extra.plantedAtMs) / 1000));
        const growSec = Math.max(1, treeDef.growTime || 15);
        const ready = ageSec >= growSec;
        const remSec = Math.max(0, growSec - ageSec);
        const mins = Math.floor(remSec / 60);
        const secs = remSec % 60;
        const status = ready
          ? "`2Ready to harvest!``"
          : mins > 0
          ? `\`w${mins}m ${secs}s\`\` left`
          : `\`w${secs}s\`\` left`;
        const dlg = new DialogBuilder()
          .setDefaultColor("`o")
          .addLabelWithIcon("big", `\`w${stripGtColors(treeDef.name)}\`\``, tile.fg)
          .addTextbox(`Status: ${status}`)
          .addTextbox(
            `Fruits on tree: \`w${tile.extra.fruitCount}\`\`${tile.extra.spliced ? " `5(Spliced)``" : ""}`
          )
          .addQuickExit()
          .endDialog("tree_info", "Close", "");
        OnDialogRequest(session, dlg);
      }
    }
    return;
  }

  // 2. Fist / Punch (id 18)
  if (itemId === 18) {
    if (tile.fg === 6) {
      // Punch requests are not activation requests. The client sends type 7
      // when entering the door; remote punches must never exit the world.
      OnTalkBubble(session, session.netId, "(stand over and punch to use)", 0, true);
      return;
    }
    const doBreak = (bx: number, by: number): boolean => {
      if (bx < 0 || bx >= world.width || by < 0 || by >= world.height) return false;
      const bt = world.tiles[by * world.width + bx];
      const bId = bt.fg !== 0 ? bt.fg : bt.bg;
      if (bId === 0) {
        broadcastPositionedSfx(world, session.netId, "audio/punch_miss.wav");
        return false;
      }
      const bDef = ctx.itemsDb.get(bId);
      if (!bDef || bDef.isBedrock || bId === 6 || bId === 8) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "It's too strong to break.", 0, true);
        return false;
      }
      if (!canModifyWorldTile(session, world, bt)) {
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "`4That area is locked!``", 0, true);
        return false;
      }

      if (bt.fg !== 0 && bt.extra?.kind === "seed") {
        const growSec = Math.max(1, bDef.growTime || 15);
        const ageSec = (now - bt.extra.plantedAtMs) / 1000;
        if (ageSec >= growSec) {
          harvestWorldTree(ctx, session, world, bx, by, bt, bDef);
          return true;
        }
        if (now - (bt.lastHitMs ?? 0) > 6000) bt.damage = 0;
        bt.lastHitMs = now;
        bt.damage = (bt.damage ?? 0) + 1;

        const shakePkt = makeTileTreeStatePacket(bx, by, 0, 1, session.netId);
        for (const p of world.peers) p.peer.sendPacket(0, shakePkt, true);

        if ((bt.damage ?? 0) >= 5) {
          finalizeTileBreak(ctx, session, world, bx, by, bt, bDef, bId);
          return true;
        }
        const leftSec = Math.max(1, Math.ceil(growSec - ageSec));
        OnTalkBubble(
          session,
          session.netId,
          `Not ready to harvest yet! (\`w${leftSec}s\`\` left)`,
          0, true
        );
        return false;
      }

      if (now - (bt.lastHitMs ?? 0) > 6000) bt.damage = 0;
      bt.lastHitMs = now;
      bt.damage = (bt.damage ?? 0) + 1;

      const dmgPkt = buildTankPacket({
        type: PACKET_TILE_APPLY_DAMAGE,
        netId: session.netId,
        value: 6,
        punchX: bx,
        punchY: by,
      });
      for (const p of world.peers) p.peer.sendPacket(0, dmgPkt, true);

      if ((bt.damage ?? 0) >= bDef.breakHits) {
        finalizeTileBreak(ctx, session, world, bx, by, bt, bDef, bId);
      }
      return true;
    };

    if (punchLine > 0) {
      const dir = session.facingLeft ? -1 : 1;
      doBreak(tx, ty);
      for (let i = 1; i < punchLine; i++) doBreak(tx + dir * i, ty);
    } else {
      doBreak(tx, ty);
    }
    return;
  }

  // 3. Placing an item / seed / background / wearable
  const invSlot = session.account.inventory.find((s) => s.itemId === itemId && s.count > 0);
  if (!invSlot || !def) return;

  if (def.isClothing) {
    toggleWearableItem(ctx, session, itemId);
    return;
  }

  if (!canModifyWorldTile(session, world, tile)) {
    OnPlayPositioned(session, "audio/punch_locked.wav");
    OnTalkBubble(session, session.netId, "`4That area is locked!``", 0, true);
    return;
  }

  let needsFullTileUpdate = false;

  if (def.isBackground) {
    if (tile.bg !== 0) return; // Existing background must be punched before replacement.
    tile.bg = itemId;
    tile.damage = 0;
  } else if (def.isSeed) {
    const rollFruitCount = (): number => {
      const r = Math.random();
      if (r < 0.2) return 1;
      if (r < 0.55) return 2;
      if (r < 0.85) return 3;
      return 4;
    };
    const scheduleMaturitySync = (seedId: number, growTimeSec: number): void => {
      const growMs = Math.max(1000, (growTimeSec || 15) * 1000);
      if (growMs > 300_000) return;
      setTimeout(() => {
        if (tile.fg === seedId && tile.extra?.kind === "seed" && world.peers.size > 0) {
          const grownPkt = makeTileUpdatePacket(tx, ty, tile, Date.now());
          for (const p of world.peers) p.peer.sendPacket(0, grownPkt, true);
        }
      }, growMs + 200);
    };

    if (tile.fg !== 0) {
      const cur = ctx.itemsDb.get(tile.fg);
      if (cur && cur.isSeed && tile.extra?.kind === "seed") {
        const growSec = Math.max(1, cur.growTime || 15);
        const ageSec = (now - tile.extra.plantedAtMs) / 1000;
        if (ageSec >= growSec) {
          OnTalkBubble(session, session.netId, "`wIt's too big to splice now!``", 0, true);
          return;
        }
        if (tile.extra.spliced) {
          OnTalkBubble(
            session,
            session.netId,
            "`wIt would be too dangerous to try to mix three seeds.``",
            0, true
          );
          return;
        }
        const splice = ctx.itemsDb.findSpliceSeed(tile.fg, itemId);
        if (!splice) {
          OnTalkBubble(
            session,
            session.netId,
            `\`wHmm, it looks like \`$${stripGtColors(cur.name)}\`w and \`$${stripGtColors(def.name)}\`w can't be spliced.\`\``,
            0, true
          );
          return;
        }
        const outSeedDef = ctx.itemsDb.get(splice)!;
        const outBlockDef = ctx.itemsDb.get(splice - 1);
        const treeTitle = outBlockDef
          ? `${stripGtColors(outBlockDef.name)} Tree`
          : stripGtColors(outSeedDef.name);
        tile.fg = splice;
        tile.damage = 0;
        tile.extra = {
          kind: "seed",
          plantedAtMs: now,
          fruitCount: rollFruitCount(),
          spliced: true,
        };
        ctx.consumeInventoryItem(session, itemId, 1, true);
        ctx.dirty = true;

        const upd = makeTileUpdatePacket(tx, ty, tile, now);
        for (const p of world.peers) p.peer.sendPacket(0, upd, true);
        OnTalkBubble(
          session,
          session.netId,
          `\`w${stripGtColors(cur.name)}\`\` and \`w${stripGtColors(def.name)}\`\` have been spliced to make a \`2${treeTitle}\`\`!`,
          0, true
        );
        // Splice success is a separate event from ordinary seed planting.
        // Use the web client's supported positioned callback, addressed only to the actor.
        // Community mapping and protocol distinction: docs/SPLICE_SUCCESS_FIX.md.
        OnPlayPositioned(session, "audio/success.wav");
        scheduleMaturitySync(splice, outSeedDef.growTime);
        return;
      }
      OnTalkBubble(session, session.netId, "Plant seeds on empty space above a block!", 0, true);
      return;
    }

    const below = ty + 1 < world.height ? world.tiles[(ty + 1) * world.width + tx] : null;
    const belowDef = below && below.fg !== 0 ? ctx.itemsDb.get(below.fg) : null;
    if (!below || !belowDef || belowDef.isSeed || belowDef.isBackground || belowDef.collisionType === 0) {
      OnTalkBubble(session, session.netId, "Seeds must be planted above a solid block!", 0, true);
      return;
    }

    tile.fg = itemId;
    tile.damage = 0;
    tile.flags = session.facingLeft ? TILE_FLAG_FLIPPED : 0;
    tile.extra = { kind: "seed", plantedAtMs: now, fruitCount: rollFruitCount(), spliced: false };
    scheduleMaturitySync(itemId, def.growTime);
  } else {
    if (tile.fg !== 0) return;
    if (def.collisionType === 1) {
      const px = tx * 32;
      const py = ty * 32;
      if (Math.abs(session.x - px) < 18 && Math.abs(session.y - py) < 24) return;
    }
    tile.fg = itemId;
    tile.flags = session.facingLeft ? TILE_FLAG_FLIPPED : 0;
    tile.damage = 0;

    let extra: TileExtra | undefined;
    if (def.isLock) {
      const isWorldLockTier =
        itemId === 242 || itemId === 1796 || itemId === 7188 || itemId === 11550;
      if (isWorldLockTier && world.ownerUserId !== 0) {
        tile.fg = 0;
        OnPlayPositioned(session, "audio/punch_locked.wav");
        OnTalkBubble(session, session.netId, "`4Only one World Lock per world!``", 0, true);
        return;
      }
      extra = { kind: "lock", settings: 0, ownerUserId: session.account.userId, adminIds: [] };
      needsFullTileUpdate = true;
      if (isWorldLockTier) {
        world.ownerUserId = session.account.userId;
        const placedMessage = `\`5[\`w${world.name}\`5 has been World Locked by \`2${session.account.name}\`5!]\`\``;
        broadcastConsoleMessage(world, placedMessage);
        broadcastTalkBubble(world, session.netId, placedMessage);
      }
      broadcastPositionedSfx(world, session.netId, "audio/use_lock.wav");
    } else if (def.isDoor) {
      extra = { kind: "door", label: "", destination: "" };
      needsFullTileUpdate = true;
    } else if (def.isSign) {
      extra = { kind: "sign", label: "Edit me with Wrench!" };
      needsFullTileUpdate = true;
    }
    tile.extra = extra;

    if (def.isWeather) {
      const nextWeather = recomputeWorldWeather(world, ctx.itemsDb);
      broadcastSetCurrentWeather(world, nextWeather);
    }
  }

  ctx.dirty = true;

  // Let the client handle placement audio/animation and its own inventory decrement.
  // Extra-data tiles need the placement event too, followed by their authoritative state.
  ctx.consumeInventoryItem(session, itemId, 1, false);
  const placePkt = makeTileChangePacket(
    session.netId, tx, ty, itemId,
    session.facingLeft ? TANK_FLAG_FACING_LEFT : 0
  );
  for (const p of world.peers) p.peer.sendPacket(0, placePkt, true);
  if (needsFullTileUpdate || def.isSeed) {
    const upd = makeTileUpdatePacket(tx, ty, tile, now);
    for (const p of world.peers) p.peer.sendPacket(0, upd, true);
  }
}

function harvestWorldTree(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tx: number,
  ty: number,
  tile: WorldTile,
  def: ItemDef
): void {
  const te = tile.extra as SeedExtra | undefined;
  const fruitCnt = Math.max(1, Math.min(4, te?.fruitCount ?? 1));
  const seedItemId = tile.fg;
  const blockId = seedItemId > 0 ? seedItemId - 1 : 0;
  const blockDef = blockId > 0 ? ctx.itemsDb.get(blockId) : undefined;
  const rarity = Math.max(1, blockDef?.rarity ?? def.rarity ?? 1);

  tile.fg = 0;
  tile.extra = undefined;
  tile.flags = 0;
  tile.damage = 0;
  ctx.dirty = true;

  const harvestPkt = makeTileTreeStatePacket(tx, ty, blockId, -1, session.netId);
  for (const p of world.peers) p.peer.sendPacket(0, harvestPkt, true);
  // Tree-state invokes avatar SFX/effects; it does not serialize the cleared tile.
  const clearedTile = makeTileUpdatePacket(tx, ty, tile, Date.now());
  for (const p of world.peers) p.peer.sendPacket(0, clearedTile, true);

  if (blockDef && !blockDef.name.startsWith("null_")) {
    spawnOrMergeWorldDrop(world, blockId, fruitCnt, tx * 32 + 6, ty * 32 + 6, -1);
  }

  const probableSeed = seedItemId || blockId + 1;
  if (ctx.itemsDb.get(probableSeed)?.isSeed) {
    const perFruitSeedChance = Math.max(0.05, Math.min(0.28, 4 / (rarity + 12)));
    for (let i = 0; i < fruitCnt; i++) {
      if (Math.random() < perFruitSeedChance) {
        spawnOrMergeWorldDrop(world, probableSeed, 1, tx * 32 + 14, ty * 32 + 6, -1);
        break;
      }
    }
  }

  const gemChance = rarity <= 1 ? 0.35 : Math.min(0.95, 0.45 + rarity * 0.02);
  if (Math.random() < gemChance) {
    const maxGems = Math.max(1, Math.min(25, Math.ceil(rarity / 4)));
    const gemCount = 1 + Math.floor(Math.random() * maxGems);
    spawnOrMergeWorldDrop(world, GEM_ITEM_ID, gemCount, tx * 32 + 10, ty * 32 + 8, -1);
  }
}

function finalizeTileBreak(
  ctx: ServerContext,
  session: PlayerSession,
  world: WorldInstance,
  tx: number,
  ty: number,
  tile: WorldTile,
  def: ItemDef,
  targetId: number
): void {
  const brokenWasWorldLock =
    tile.extra?.kind === "lock" &&
    (targetId === 242 || targetId === 1796 || targetId === 7188 || targetId === 11550);

  if (tile.fg !== 0) {
    tile.fg = 0;
    tile.extra = undefined;
    tile.flags = 0;
  } else {
    tile.bg = 0;
  }
  tile.damage = 0;

  if (brokenWasWorldLock) {
    world.ownerUserId = 0;
    broadcastConsoleMessage(world, `\`5World \`w${world.name}\`5 is no longer World Locked!\`\``);
  }
  if (def.isWeather) {
    const nextWeather = recomputeWorldWeather(world, ctx.itemsDb);
    broadcastSetCurrentWeather(world, nextWeather);
  }
  ctx.dirty = true;

  const breakPkt = makeTileChangePacket(session.netId, tx, ty, 18);
  for (const p of world.peers) p.peer.sendPacket(0, breakPkt, true);

  if (def.isLock || targetId === 12 || targetId === 20) {
    ctx.giveInventoryItem(session, targetId, 1, true);
  } else if (def.isSeed) {
    if (Math.random() < 0.25) {
      spawnOrMergeWorldDrop(world, targetId, 1, tx * 32 + 8, ty * 32 + 8, -1);
    }
  } else {
    const roll = Math.random();
    if (roll < 0.28) {
      spawnOrMergeWorldDrop(world, targetId, 1, tx * 32 + 6, ty * 32 + 8, -1);
    } else if (roll < 0.48 && ctx.itemsDb.get(targetId + 1)?.isSeed) {
      spawnOrMergeWorldDrop(world, targetId + 1, 1, tx * 32 + 10, ty * 32 + 8, -1);
    }
    if (Math.random() < 0.55) {
      const gemAmt = Math.max(1, Math.min(25, Math.ceil((def.rarity || 1) / 3)));
      spawnOrMergeWorldDrop(world, GEM_ITEM_ID, gemAmt, tx * 32 + 12, ty * 32 + 10, -1);
    }
  }
}
