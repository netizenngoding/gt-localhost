import { makeVariantPacket } from "../proton/packet";
import type { ItemDatabase } from "../database/items";
import { getClothingVector, type PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

/**
 * Verified instruction-by-instruction against ReGrowtopia-1.50.wasm Func #4579 @ 2068..2110
 * and Gurotopia's `onVariant/SetClothing.hpp`:
 *  - Sends all 10 clothing slots (0..8 in v[1..3], slot 9 Ances in v[5].x!)
 *  - Sends skinColor (u32) in v[4]
 *  - v[5].y != 0 plays `audio/change_clothes.wav` natively!
 */
export function buildSetClothingPacket(
  subject: PlayerSession,
  itemsDb: ItemDatabase,
  playSfx = false
): Buffer {
  const c = getClothingVector(subject.account, itemsDb);
  const skinU32 = subject.account.skinColor >>> 0;
  return makeVariantPacket(
    [
      "OnSetClothing",
      { type: "vec3", x: c[0], y: c[1], z: c[2] },
      { type: "vec3", x: c[3], y: c[4], z: c[5] },
      { type: "vec3", x: c[6], y: c[7], z: c[8] },
      { type: "u32", value: skinU32 },
      { type: "vec3", x: c[9], y: playSfx ? 1 : 0, z: 0 },
    ],
    subject.netId
  );
}

export function OnSetClothing(
  target: PlayerSession,
  subject: PlayerSession,
  itemsDb: ItemDatabase,
  playSfx = false
): void {
  target.peer.sendPacket(0, buildSetClothingPacket(subject, itemsDb, playSfx), true);
}

export function broadcastSetClothing(
  world: WorldInstance,
  subject: PlayerSession,
  itemsDb: ItemDatabase,
  playSfx = false
): void {
  const pkt = buildSetClothingPacket(subject, itemsDb, playSfx);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}

export function applySkinColorUpdate(
  subject: PlayerSession,
  worldOrPlaySfx?: WorldInstance | null | boolean,
  maybePlaySfx = false
): void {
  const playSfx = typeof worldOrPlaySfx === "boolean" ? worldOrPlaySfx : maybePlaySfx;
  const skinU32 = subject.account.skinColor >>> 0;
  // OnChangeSkin (Func #4597) updates avatar +1572 without XOR-toggling invSlot->flags!
  const skinPkt = makeVariantPacket(["OnChangeSkin", { type: "u32", value: skinU32 }], subject.netId);
  if (subject.world) {
    for (const p of subject.world.peers) p.peer.sendPacket(0, skinPkt, true);
    if (playSfx) {
      const sfxPkt = makeVariantPacket(["OnPlayPositioned", "audio/change_clothes.wav"], subject.netId);
      for (const p of subject.world.peers) p.peer.sendPacket(0, sfxPkt, true);
    }
  } else {
    subject.peer.sendPacket(0, skinPkt, true);
  }
}
