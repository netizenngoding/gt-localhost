import { SERVER_NAME } from "../config/branding";
import { isPlayableWorldName } from "../database/world-policy";
import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";
import type { WorldInstance } from "../database/world";

export const GAZETTE_NEWS: Array<{ title: string; body: string }> = [
  {
    title: `Welcome to ${SERVER_NAME}`,
    body: "Original-reference items, secure GrowID registration, saved outfits and native Shop.",
  },
  {
    title: "Useful Commands",
    body: "Use `5/find <name>`` to browse items, `5/rank`` to see your role, `5/mods`` for online staff, and `5/help`` for commands.",
  },
  {
    title: "PC Controls & Fullscreen",
    body: "Open `wOptions`` anytime to toggle `wFullscreen`` or customize PC controls in `wEdit Hotkeys``!",
  },
];

export function RequestWorldSelectMenu(
  session: PlayerSession,
  worlds: Map<string, WorldInstance>
): void {
  const featured = ["START", "FARM", "PARKOUR", "TRADE"];
  const lines: string[] = [
    "default|START",
    "add_filter|",
    "add_heading|Top Worlds<ROW2>|",
  ];
  const colors = [3529161471, 2147418367, 3417414143, 2864971775];
  featured.forEach((name, idx) => {
    const w = worlds.get(name);
    const cnt = w ? w.peers.size : 0;
    lines.push(`add_floater|${name}|${cnt}|0.55|${colors[idx % colors.length]}`);
  });

  for (const [name, w] of worlds.entries()) {
    if (isPlayableWorldName(name) && !featured.includes(name) && w.peers.size > 0) {
      lines.push(`add_floater|${name}|${w.peers.size}|0.50|2147418367`);
    }
  }

  // My Worlds (worlds World-Locked by this player, modeled on Gurotopia RequestWorldSelectMenu.hpp)
  const myLockedWorlds: WorldInstance[] = [];
  for (const w of worlds.values()) {
    if (isPlayableWorldName(w.name) && w.ownerUserId === session.account.userId) {
      myLockedWorlds.push(w);
    }
  }
  if (myLockedWorlds.length > 0) {
    lines.push("add_heading|My Worlds<CR>|");
    for (const mw of myLockedWorlds.slice(0, 8)) {
      lines.push(`add_floater|${mw.name}|${mw.peers.size}|0.48|2147418367`);
    }
  }

  // Recently Visited Worlds (modeled on Gurotopia RequestWorldSelectMenu.hpp)
  const recent = (session.account.recentWorlds || []).filter((n) => isPlayableWorldName(n) && !featured.includes(n));
  if (recent.length > 0) {
    lines.push("add_heading|Recently Visited Worlds<CR>|");
    for (const rName of recent.slice(0, 6)) {
      const rw = worlds.get(rName);
      lines.push(`add_floater|${rName}|${rw ? rw.peers.size : 0}|0.46|3417414143`);
    }
  }

  lines.push("");
  session.peer.sendPacket(
    0,
    makeVariantPacket(["OnRequestWorldSelectMenu", lines.join("\n") + "\n"]),
    true
  );
}
