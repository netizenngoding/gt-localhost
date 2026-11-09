import type { ENetServerPeer } from "../network/enet";
import { makeServerHello } from "../proton/packet";

export function onPeerConnect(peer: ENetServerPeer): void {
  peer.sendPacket(0, makeServerHello(), true);
}
