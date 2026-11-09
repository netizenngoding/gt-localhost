import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { WebSocket } from "ws";

export const ENET_PROTOCOL_MAXIMUM_PEER_ID = 0xfff;
export const ENET_PROTOCOL_HEADER_FLAG_COMPRESSED = 0x4000;
export const ENET_PROTOCOL_HEADER_FLAG_SENT_TIME = 0x8000;
export const ENET_PROTOCOL_HEADER_FLAG_MASK = 0xc000;

export const ENET_PROTOCOL_COMMAND_NONE = 0;
export const ENET_PROTOCOL_COMMAND_ACKNOWLEDGE = 1;
export const ENET_PROTOCOL_COMMAND_CONNECT = 2;
export const ENET_PROTOCOL_COMMAND_VERIFY_CONNECT = 3;
export const ENET_PROTOCOL_COMMAND_DISCONNECT = 4;
export const ENET_PROTOCOL_COMMAND_PING = 5;
export const ENET_PROTOCOL_COMMAND_SEND_RELIABLE = 6;
export const ENET_PROTOCOL_COMMAND_SEND_UNRELIABLE = 7;
export const ENET_PROTOCOL_COMMAND_SEND_FRAGMENT = 8;
export const ENET_PROTOCOL_COMMAND_SEND_UNSEQUENCED = 9;
export const ENET_PROTOCOL_COMMAND_BANDWIDTH_LIMIT = 10;
export const ENET_PROTOCOL_COMMAND_THROTTLE_CONFIGURE = 11;
export const ENET_PROTOCOL_COMMAND_SEND_UNRELIABLE_FRAGMENT = 12;
export const ENET_PROTOCOL_COMMAND_MASK = 0x0f;

export const ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE = 0x80;

const COMMAND_HEADER_SIZES: Record<number, number> = {
  0: 0,
  1: 8,
  2: 48,
  3: 44,
  4: 8,
  5: 4,
  6: 6,
  7: 8,
  8: 24,
  9: 8,
  10: 12,
  11: 16,
  12: 24,
};

// Exact ENet CRC32 (matches ReGrowtopia-1.50.wasm Func #3635)
export function enetCrc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
}

// ============================================================================
// Exact Native WASM ENet Range Coder extracted from ReGrowtopia-1.50.wasm
// (#1042 rescale, #3631 enet_range_coder_decompress, #3632 enet_range_coder_compress)
// ============================================================================
interface WasmCodecExports {
  memory: WebAssembly.Memory;
  decompress: (ctx: number, inPtr: number, inLen: number, outPtr: number, outMax: number) => number;
  compress: (ctx: number, bufDescPtr: number, bufCount: number, inLen: number, outPtr: number, outMax: number) => number;
}

const codecWasmPath = path.join(process.cwd(), "server", "enet_codec.wasm");
const codecModule = new WebAssembly.Module(fs.readFileSync(codecWasmPath));
const codecInstance = new WebAssembly.Instance(codecModule);
const codec = codecInstance.exports as unknown as WasmCodecExports;

const CODEC_CTX_PTR = 65536;      // 49,152 bytes (4096 * 12)
const CODEC_BUF_DESC = 131072;    // 8 bytes { ptr, len }
const CODEC_IN_PTR = 131104;      // up to 256 KB input
const CODEC_OUT_PTR = 393216;     // up to 512 KB output
const CODEC_OUT_MAX = 524288;

export function enetRangeDecompress(inBuf: Buffer): Buffer | null {
  if (inBuf.length === 0 || inBuf.length > 262000) return null;
  const mem = new Uint8Array(codec.memory.buffer);
  mem.set(inBuf, CODEC_IN_PTR);
  const outLen = codec.decompress(CODEC_CTX_PTR, CODEC_IN_PTR, inBuf.length, CODEC_OUT_PTR, CODEC_OUT_MAX);
  if (outLen <= 0 || outLen > CODEC_OUT_MAX) return null;
  return Buffer.from(mem.subarray(CODEC_OUT_PTR, CODEC_OUT_PTR + outLen));
}

export function enetRangeCompress(inBuf: Buffer): Buffer | null {
  if (inBuf.length === 0 || inBuf.length > 262000) return null;
  const mem = new Uint8Array(codec.memory.buffer);
  const dv = new DataView(codec.memory.buffer);
  mem.set(inBuf, CODEC_IN_PTR);
  dv.setUint32(CODEC_BUF_DESC, CODEC_IN_PTR, true);
  dv.setUint32(CODEC_BUF_DESC + 4, inBuf.length, true);
  const outLen = codec.compress(CODEC_CTX_PTR, CODEC_BUF_DESC, 1, inBuf.length, CODEC_OUT_PTR, CODEC_OUT_MAX);
  if (outLen <= 0 || outLen >= inBuf.length) return null;
  return Buffer.from(mem.subarray(CODEC_OUT_PTR, CODEC_OUT_PTR + outLen));
}

interface FragmentBuffer {
  totalLength: number;
  fragmentCount: number;
  receivedCount: number;
  data: Buffer;
  receivedMask: Uint8Array;
}

export interface ENetPeerCallbacks {
  onConnect: (peer: ENetServerPeer) => void;
  onReceive: (peer: ENetServerPeer, channelId: number, data: Buffer) => void;
  onDisconnect: (peer: ENetServerPeer) => void;
}

export class ENetServerPeer {
  public readonly ws: WebSocket;
  public readonly localPeerId: number;
  public remotePeerId = 0;
  public connectId = 0;
  public mtu = 1400;
  public channelCount = 2;
  public connected = false;
  public clientDeviceId = "";
  public userData: unknown = null;

  private startTime = Date.now();
  private outgoingReliableSeq = new Uint16Array(16);
  private outgoingUnreliableSeq = new Uint16Array(16);
  private incomingReliableSeq = new Uint16Array(16);
  private fragments = new Map<string, FragmentBuffer>();
  private callbacks: ENetPeerCallbacks;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    ws: WebSocket,
    localPeerId: number,
    callbacks: ENetPeerCallbacks,
    clientDeviceId = ""
  ) {
    this.ws = ws;
    this.localPeerId = localPeerId;
    this.callbacks = callbacks;
    this.clientDeviceId = clientDeviceId;

    this.pingTimer = setInterval(() => {
      if (this.connected && this.ws.readyState === 1) {
        this.sendPing();
      }
    }, 4000);
  }

  public destroy(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.connected) {
      this.connected = false;
      this.callbacks.onDisconnect(this);
    }
  }

  private nowTime16(): number {
    return (Date.now() - this.startTime) & 0xffff;
  }

  public handleRawFrame(raw: Buffer): void {
    if (raw.length < 4) return;

    // 1. Ignore Emscripten SOCKFS 10-byte UDP source port announcement: ff ff ff ff 'p' 'o' 'r' 't' hi lo
    if (
      raw.length === 10 &&
      raw[0] === 0xff &&
      raw[1] === 0xff &&
      raw[2] === 0xff &&
      raw[3] === 0xff &&
      raw[4] === 0x70 &&
      raw[5] === 0x6f &&
      raw[6] === 0x72 &&
      raw[7] === 0x74
    ) {
      return;
    }

    // 2. Ignore CreativePS 10-byte WebSocket UDP proxy routing header: bf d4 12 8c cd 67 af 69 + u16 port
    if (
      raw.length === 10 &&
      raw[0] === 0xbf &&
      raw[1] === 0xd4 &&
      raw[2] === 0x12 &&
      raw[3] === 0x8c &&
      raw[4] === 0xcd &&
      raw[5] === 0x67 &&
      raw[6] === 0xaf &&
      raw[7] === 0x69
    ) {
      return;
    }

    // Verified against ReGrowtopia-1.50.wasm Func #4358 (`*(u8*)(host + 10404) = mode`) & Func #1664:
    //   hdrBase = 0 -> standard ENet (mode 0/1)
    //   hdrBase = 6 -> Growtopia `usingNewPacket` 6-byte client prefix (mode 2: `type2|1` or `beta_server` flag)
    //   hdrBase = 8 -> `enet_cookie` 8-byte client prefix (mode 3)
    // In all 3 modes, CRC32 (`Func #3635 [tbl=3462]`) is computed over `raw[0..offset]` (with `0` or `connectId`
    // in UInt32LE at `crcOffset`) + uncompressed ENet commands!
    let parsedHdr: {
      hasSentTime: boolean;
      sentTime: number;
      body: Buffer;
    } | null = null;

    for (const hdrBase of [0, 6, 8]) {
      if (raw.length < hdrBase + 6) continue;
      const peerAndFlags = raw.readUInt16BE(hdrBase);
      const peerId = peerAndFlags & ENET_PROTOCOL_MAXIMUM_PEER_ID;
      if (peerId !== ENET_PROTOCOL_MAXIMUM_PEER_ID && peerId !== (this.localPeerId & ENET_PROTOCOL_MAXIMUM_PEER_ID)) {
        continue;
      }
      const flags = peerAndFlags & ENET_PROTOCOL_HEADER_FLAG_MASK;
      // Non-zero session bits outside known flags (SENT_TIME=0x8000, COMPRESSED=0x4000, session shift 12..13) are fine,
      // so validate using exact CRC32 + command header sanity!
      const hasSentTime = (flags & ENET_PROTOCOL_HEADER_FLAG_SENT_TIME) !== 0;
      const isCompressed = (flags & ENET_PROTOCOL_HEADER_FLAG_COMPRESSED) !== 0;

      let offset = hdrBase + 2;
      let sentTime = 0;
      if (hasSentTime) {
        if (raw.length < offset + 2) continue;
        sentTime = raw.readUInt16BE(offset);
        offset += 2;
      }

      if (raw.length < offset + 4) continue;
      const crcOffset = offset;
      const wireCrc = raw.readUInt32BE(crcOffset);
      offset += 4;
      if (offset >= raw.length) continue;

      let candidateBody = raw.subarray(offset);
      if (isCompressed) {
        const dec = enetRangeDecompress(candidateBody);
        if (!dec || dec.length < 4) continue;
        candidateBody = dec;
      } else if (candidateBody.length < 4) {
        continue;
      }

      const firstCmd = candidateBody[0] & ENET_PROTOCOL_COMMAND_MASK;
      const firstHdrSize = COMMAND_HEADER_SIZES[firstCmd];
      if (!firstHdrSize || firstHdrSize > candidateBody.length) continue;

      const checkBuf = Buffer.allocUnsafe(offset + candidateBody.length);
      raw.copy(checkBuf, 0, 0, offset);
      if (peerId === ENET_PROTOCOL_MAXIMUM_PEER_ID) {
        checkBuf.writeUInt32LE(0, crcOffset);
      } else {
        checkBuf.writeUInt32LE(this.connectId >>> 0, crcOffset);
      }
      candidateBody.copy(checkBuf, offset);
      const calcCrc = enetCrc32(checkBuf);
      if (wireCrc === calcCrc) {
        parsedHdr = { hasSentTime, sentTime, body: candidateBody };
        break;
      }
    }

    if (!parsedHdr) {
      return;
    }

    const { hasSentTime, sentTime, body } = parsedHdr;

    const acks: Array<{ channelId: number; reliableSeq: number; sentTime: number }> = [];
    let pos = 0;

    while (pos + 4 <= body.length) {
      const cmdByte = body[pos];
      const cmdNumber = cmdByte & ENET_PROTOCOL_COMMAND_MASK;
      const channelId = body[pos + 1];
      const reliableSeq = body.readUInt16BE(pos + 2);
      const hdrSize = COMMAND_HEADER_SIZES[cmdNumber];
      if (!hdrSize || pos + hdrSize > body.length) break;

      if ((cmdByte & ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE) !== 0 && hasSentTime) {
        acks.push({ channelId, reliableSeq, sentTime });
      }

      switch (cmdNumber) {
        case ENET_PROTOCOL_COMMAND_ACKNOWLEDGE: {
          pos += hdrSize;
          if (!this.connected && this.connectId !== 0) {
            this.connected = true;
            this.callbacks.onConnect(this);
          }
          break;
        }
        case ENET_PROTOCOL_COMMAND_CONNECT: {
          this.remotePeerId = body.readUInt16BE(pos + 4);
          const clientMtu = body.readUInt32BE(pos + 8);
          if (clientMtu >= 576 && clientMtu <= 4096) this.mtu = clientMtu;
          const chans = body.readUInt32BE(pos + 16);
          if (chans >= 1 && chans <= 16) this.channelCount = chans;
          this.connectId = body.readUInt32LE(pos + 40);
          pos += hdrSize;

          if (acks.length > 0) {
            this.sendAcks(acks.splice(0, acks.length));
          }
          this.sendVerifyConnect();
          break;
        }
        case ENET_PROTOCOL_COMMAND_PING:
        case ENET_PROTOCOL_COMMAND_BANDWIDTH_LIMIT:
        case ENET_PROTOCOL_COMMAND_THROTTLE_CONFIGURE: {
          pos += hdrSize;
          break;
        }
        case ENET_PROTOCOL_COMMAND_DISCONNECT: {
          pos += hdrSize;
          if (acks.length > 0) this.sendAcks(acks.splice(0, acks.length));
          this.destroy();
          return;
        }
        case ENET_PROTOCOL_COMMAND_SEND_RELIABLE: {
          const dataLen = body.readUInt16BE(pos + 4);
          pos += hdrSize;
          if (pos + dataLen > body.length) return;
          const payload = Buffer.from(body.subarray(pos, pos + dataLen));
          pos += dataLen;

          if (!this.connected) {
            this.connected = true;
            this.callbacks.onConnect(this);
          }
          const ch = channelId < 16 ? channelId : 0;
          const expectedNext = (this.incomingReliableSeq[ch] + 1) & 0xffff;
          if (reliableSeq === expectedNext || this.incomingReliableSeq[ch] === 0) {
            this.incomingReliableSeq[ch] = reliableSeq;
            this.callbacks.onReceive(this, channelId, payload);
          }
          break;
        }
        case ENET_PROTOCOL_COMMAND_SEND_UNRELIABLE: {
          const dataLen = body.readUInt16BE(pos + 6);
          pos += hdrSize;
          if (pos + dataLen > body.length) return;
          const payload = Buffer.from(body.subarray(pos, pos + dataLen));
          pos += dataLen;

          if (!this.connected) {
            this.connected = true;
            this.callbacks.onConnect(this);
          }
          this.callbacks.onReceive(this, channelId, payload);
          break;
        }
        case ENET_PROTOCOL_COMMAND_SEND_FRAGMENT: {
          const startSeq = body.readUInt16BE(pos + 4);
          const dataLen = body.readUInt16BE(pos + 6);
          const fragCount = body.readUInt32BE(pos + 8);
          const fragNum = body.readUInt32BE(pos + 12);
          const totalLen = body.readUInt32BE(pos + 16);
          const fragOff = body.readUInt32BE(pos + 20);
          pos += hdrSize;
          if (pos + dataLen > body.length) return;
          const chunk = body.subarray(pos, pos + dataLen);
          pos += dataLen;

          if (totalLen <= 524288 && fragCount > 0 && fragCount <= 1024 && fragNum < fragCount && fragOff + dataLen <= totalLen) {
            const key = `${channelId}:${startSeq}`;
            let fb = this.fragments.get(key);
            if (!fb) {
              fb = {
                totalLength: totalLen,
                fragmentCount: fragCount,
                receivedCount: 0,
                data: Buffer.alloc(totalLen),
                receivedMask: new Uint8Array(fragCount),
              };
              this.fragments.set(key, fb);
            }
            if (!fb.receivedMask[fragNum]) {
              fb.receivedMask[fragNum] = 1;
              fb.receivedCount++;
              chunk.copy(fb.data, fragOff);
              if (fb.receivedCount === fb.fragmentCount) {
                this.fragments.delete(key);
                const ch = channelId < 16 ? channelId : 0;
                this.incomingReliableSeq[ch] = reliableSeq;
                if (!this.connected) {
                  this.connected = true;
                  this.callbacks.onConnect(this);
                }
                this.callbacks.onReceive(this, channelId, fb.data);
              }
            }
          }
          break;
        }
        default: {
          pos = body.length;
          break;
        }
      }
    }

    if (acks.length > 0) {
      this.sendAcks(acks);
    }

    if (!this.connected && this.connectId !== 0 && body.length >= 8 && (body[0] & ENET_PROTOCOL_COMMAND_MASK) === ENET_PROTOCOL_COMMAND_ACKNOWLEDGE) {
      this.connected = true;
      this.callbacks.onConnect(this);
    }
  }

  private sendDatagram(commandsBuf: Buffer, tryCompress = false): void {
    if (this.ws.readyState !== 1) return;
    let wireBody = commandsBuf;
    let compFlag = 0;
    if (tryCompress && commandsBuf.length > 96) {
      const comp = enetRangeCompress(commandsBuf);
      if (comp) {
        wireBody = comp;
        compFlag = ENET_PROTOCOL_HEADER_FLAG_COMPRESSED;
      }
    }
    const peerHeader = (this.remotePeerId & ENET_PROTOCOL_MAXIMUM_PEER_ID) | ENET_PROTOCOL_HEADER_FLAG_SENT_TIME | compFlag;
    const sentTime = this.nowTime16();

    // ENet 1.3 computes CRC32 over [header (with compFlag set) + UNCOMPRESSED commandsBuf]!
    const crcBuf = Buffer.allocUnsafe(8 + commandsBuf.length);
    crcBuf.writeUInt16BE(peerHeader, 0);
    crcBuf.writeUInt16BE(sentTime, 2);
    crcBuf.writeUInt32LE(this.connectId >>> 0, 4);
    commandsBuf.copy(crcBuf, 8);
    const crc = enetCrc32(crcBuf);

    if (compFlag === 0) {
      crcBuf.writeUInt32BE(crc, 4);
      this.ws.send(crcBuf);
      return;
    }

    const pkt = Buffer.allocUnsafe(8 + wireBody.length);
    pkt.writeUInt16BE(peerHeader, 0);
    pkt.writeUInt16BE(sentTime, 2);
    pkt.writeUInt32BE(crc, 4);
    wireBody.copy(pkt, 8);
    this.ws.send(pkt);
  }

  private sendAcks(acks: Array<{ channelId: number; reliableSeq: number; sentTime: number }>): void {
    const buf = Buffer.allocUnsafe(acks.length * 8);
    for (let i = 0; i < acks.length; i++) {
      const o = i * 8;
      buf[o] = ENET_PROTOCOL_COMMAND_ACKNOWLEDGE;
      buf[o + 1] = acks[i].channelId;
      buf.writeUInt16BE(0, o + 2);
      buf.writeUInt16BE(acks[i].reliableSeq, o + 4);
      buf.writeUInt16BE(acks[i].sentTime, o + 6);
    }
    this.sendDatagram(buf, false);
  }

  private sendVerifyConnect(): void {
    const cmd = Buffer.alloc(44);
    const seq = (this.outgoingReliableSeq[15] = (this.outgoingReliableSeq[15] + 1) & 0xffff);
    cmd[0] = ENET_PROTOCOL_COMMAND_VERIFY_CONNECT | ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE;
    cmd[1] = 0xff;
    cmd.writeUInt16BE(seq, 2);
    cmd.writeUInt16BE(this.localPeerId & ENET_PROTOCOL_MAXIMUM_PEER_ID, 4);
    cmd[6] = 0;
    cmd[7] = 0;
    cmd.writeUInt32BE(this.mtu, 8);
    cmd.writeUInt32BE(0x8000, 12);
    cmd.writeUInt32BE(this.channelCount, 16);
    cmd.writeUInt32BE(0, 20);
    cmd.writeUInt32BE(0, 24);
    cmd.writeUInt32BE(5000, 28);
    cmd.writeUInt32BE(2, 32);
    cmd.writeUInt32BE(2, 36);
    cmd.writeUInt32LE(this.connectId >>> 0, 40);
    this.sendDatagram(cmd, false);
  }

  public sendPing(): void {
    const seq = (this.outgoingReliableSeq[15] = (this.outgoingReliableSeq[15] + 1) & 0xffff);
    const cmd = Buffer.allocUnsafe(4);
    cmd[0] = ENET_PROTOCOL_COMMAND_PING | ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE;
    cmd[1] = 0xff;
    cmd.writeUInt16BE(seq, 2);
    this.sendDatagram(cmd, false);
  }

  public sendDisconnect(): void {
    const seq = (this.outgoingReliableSeq[15] = (this.outgoingReliableSeq[15] + 1) & 0xffff);
    const cmd = Buffer.alloc(8);
    cmd[0] = ENET_PROTOCOL_COMMAND_DISCONNECT;
    cmd[1] = 0xff;
    cmd.writeUInt16BE(seq, 2);
    cmd.writeUInt32BE(0, 4);
    this.sendDatagram(cmd, false);
  }

  public sendPacket(channelId: number, payload: Buffer, reliable = true, allowCompress = true): void {
    const ch = channelId & 0x0f;
    if (!reliable && payload.length <= 1200) {
      const rSeq = this.outgoingReliableSeq[ch];
      const uSeq = (this.outgoingUnreliableSeq[ch] = (this.outgoingUnreliableSeq[ch] + 1) & 0xffff);
      const cmd = Buffer.allocUnsafe(8 + payload.length);
      cmd[0] = ENET_PROTOCOL_COMMAND_SEND_UNRELIABLE;
      cmd[1] = ch;
      cmd.writeUInt16BE(rSeq, 2);
      cmd.writeUInt16BE(uSeq, 4);
      cmd.writeUInt16BE(payload.length, 6);
      payload.copy(cmd, 8);
      this.sendDatagram(cmd, false);
      return;
    }

    const maxFragPayload = Math.max(512, this.mtu - 64);
    if (payload.length <= maxFragPayload) {
      const seq = (this.outgoingReliableSeq[ch] = (this.outgoingReliableSeq[ch] + 1) & 0xffff);
      const cmd = Buffer.allocUnsafe(6 + payload.length);
      cmd[0] = ENET_PROTOCOL_COMMAND_SEND_RELIABLE | ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE;
      cmd[1] = ch;
      cmd.writeUInt16BE(seq, 2);
      cmd.writeUInt16BE(payload.length, 4);
      payload.copy(cmd, 6);
      this.sendDatagram(cmd, allowCompress);
      return;
    }

    const fragCount = Math.ceil(payload.length / maxFragPayload);
    let startSeq = 0;
    for (let i = 0; i < fragCount; i++) {
      const seq = (this.outgoingReliableSeq[ch] = (this.outgoingReliableSeq[ch] + 1) & 0xffff);
      if (i === 0) startSeq = seq;
      const fragOff = i * maxFragPayload;
      const fragLen = Math.min(maxFragPayload, payload.length - fragOff);
      const cmd = Buffer.allocUnsafe(24 + fragLen);
      cmd[0] = ENET_PROTOCOL_COMMAND_SEND_FRAGMENT | ENET_PROTOCOL_COMMAND_FLAG_ACKNOWLEDGE;
      cmd[1] = ch;
      cmd.writeUInt16BE(seq, 2);
      cmd.writeUInt16BE(startSeq, 4);
      cmd.writeUInt16BE(fragLen, 6);
      cmd.writeUInt32BE(fragCount, 8);
      cmd.writeUInt32BE(i, 12);
      cmd.writeUInt32BE(payload.length, 16);
      cmd.writeUInt32BE(fragOff, 20);
      payload.copy(cmd, 24, fragOff, fragOff + fragLen);
      this.sendDatagram(cmd, true);
    }
  }
}
