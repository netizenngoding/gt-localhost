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
  const lines: string[] = [
    "default|START",
    "add_filter|",
    "add_heading|Recently Visited Worlds<CR>|",
  ];

  const recent = (session.account.recentWorlds || []).filter((n) => isPlayableWorldName(n));
  if (recent.length === 0) {
    const startWorld = worlds.get("START");
    lines.push(`add_floater|START|${startWorld ? startWorld.peers.size : 0}|0.55|2147418367`);
  } else {
    for (const rName of recent.slice(0, 10)) {
      const rw = worlds.get(rName);
      lines.push(`add_floater|${rName}|${rw ? rw.peers.size : 0}|0.50|2147418367`);
    }
  }

  lines.push("");
  session.peer.sendPacket(
    0,
    makeVariantPacket(["OnRequestWorldSelectMenu", lines.join("\n") + "\n"]),
    true
  );
}
