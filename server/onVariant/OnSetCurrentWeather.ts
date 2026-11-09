import { makeVariantPacket } from "../proton/packet";
import type { WorldInstance } from "../database/world";

export function broadcastCurrentWeather(world: WorldInstance): void {
  const pkt = makeVariantPacket(["OnSetCurrentWeather", { type: "i32", value: world.weatherId }]);
  for (const p of world.peers) p.peer.sendPacket(0, pkt, true);
}

export function broadcastSetCurrentWeather(world: WorldInstance, weatherId?: number): void {
  if (weatherId !== undefined) world.weatherId = weatherId;
  broadcastCurrentWeather(world);
}
