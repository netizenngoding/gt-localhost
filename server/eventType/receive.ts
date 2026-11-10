import type { ENetServerPeer } from "../network/enet";
import {
  NET_MESSAGE_GAME_MESSAGE,
  NET_MESSAGE_GAME_PACKET,
  NET_MESSAGE_GENERIC_TEXT,
  parseTankPacket,
} from "../proton/packet";
import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { handleActionText } from "../action";
import { handleGamePacket } from "../gamePacket";

// Verified instruction-by-instruction from ReGrowtopia-1.50.wasm:
//   `Func #1769 [tbl=3463]` (`SendPacket`) AND `Func #661 [tbl=1707]` (`SendPacketRaw`)
//   BOTH call `Func #5101 [tbl=3465]`, which decodes via `Func #962` to the 17-byte XOR key:
//     "-_-.PAWG69420.-_-"
//   We also accept plaintext (0x02/0x03/0x04) and vanilla Growtopia's 17-byte key ("PBG892FXX982ABC*\0").
const CREATIVE_WASM_XOR_KEY = Buffer.from("-_-.PAWG69420.-_-", "ascii");
const VANILLA_GT_XOR_KEY = Buffer.from("PBG892FXX982ABC*\0", "ascii");

const CREATIVE_HDR_MASK = CREATIVE_WASM_XOR_KEY.readUInt32LE(0);
const VANILLA_HDR_MASK = VANILLA_GT_XOR_KEY.readUInt32LE(0);

function isSupportedClientMsgType(t: number): boolean {
  return (
    t === NET_MESSAGE_GENERIC_TEXT ||
    t === NET_MESSAGE_GAME_MESSAGE ||
    t === NET_MESSAGE_GAME_PACKET
  );
}

function xorDecodeWithKey(src: Buffer, key: Buffer): Buffer {
  const out = Buffer.allocUnsafe(src.length);
  const klen = key.length;
  for (let i = 0; i < src.length; i++) {
    out[i] = src[i] ^ key[i % klen];
  }
  return out;
}

export function decodeClientPayload(rawPayload: Buffer): Buffer | null {
  if (rawPayload.length < 4) return null;
  const rawHdr = rawPayload.readUInt32LE(0);

  if (isSupportedClientMsgType(rawHdr)) {
    return rawPayload;
  }

  const creativeType = (rawHdr ^ CREATIVE_HDR_MASK) >>> 0;
  if (isSupportedClientMsgType(creativeType)) {
    return xorDecodeWithKey(rawPayload, CREATIVE_WASM_XOR_KEY);
  }

  const vanillaType = (rawHdr ^ VANILLA_HDR_MASK) >>> 0;
  if (isSupportedClientMsgType(vanillaType)) {
    return xorDecodeWithKey(rawPayload, VANILLA_GT_XOR_KEY);
  }

  return null;
}

export function onPeerReceive(
  ctx: ServerContext,
  peer: ENetServerPeer,
  _channelId: number,
  rawPayload: Buffer
): void {
  const data = decodeClientPayload(rawPayload);
  if (!data) return;

  const msgType = data.readUInt32LE(0);

  if (msgType === NET_MESSAGE_GENERIC_TEXT || msgType === NET_MESSAGE_GAME_MESSAGE) {
    // Verified against ReGrowtopia-1.50.wasm Func #1769 (`SendPacket`):
    // Zero the trailing uninitialized (len + 5)th byte so heap garbage never corrupts key-value text!
    if (data.length >= 5) {
      data[data.length - 1] = 0;
    }
    const nulIdx = data.indexOf(0, 4);
    const end = nulIdx !== -1 ? nulIdx : data.length;
    const text = data.toString("utf8", 4, end);
    if(peer.activity&&!peer.activity.text(text,!!peer.userData))return;
    handleActionText(ctx, peer, text);
    return;
  }

  if (msgType === NET_MESSAGE_GAME_PACKET) {
    const session = peer.userData as PlayerSession | null;
    if (!session) return;
    const tank = parseTankPacket(data);
    if (!tank) return;
    if(peer.activity&&!peer.activity.game(tank.type))return;
    handleGamePacket(ctx, session, data, tank);
  }
}
