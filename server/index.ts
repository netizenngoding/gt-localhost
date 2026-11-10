import { OnSetPos } from "./onVariant";
import type { PlayerSession } from "./database/peer";
import { SERVER_NAME } from "./config/branding";
import http from "node:http";
import { WebSocketServer } from "ws";
import { ServerContext } from "./database/context";
import { ItemDatabase } from "./database/items";
import { onPeerConnect, onPeerDisconnect, onPeerReceive } from "./eventType";
import { createHttpApp } from "./https/routes";
import { ENetServerPeer } from "./network/enet";

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const ROOT_DIR = process.cwd();

async function main(): Promise<void> {
  console.log(`[${SERVER_NAME}] Loading original-reference item catalog (custom definitions disabled)...`);
  const itemsDb = await ItemDatabase.loadFromUpstreamOrCache(ROOT_DIR);
  console.log(
    `[${SERVER_NAME}] Loaded ${itemsDb.items.size} items (v${itemsDb.version}, itemsHash=${itemsDb.itemsDatHash}, tributeHash=${itemsDb.playerTributeHash})`
  );

  const ctx = new ServerContext(itemsDb, ROOT_DIR);
  const app = createHttpApp(ctx, ROOT_DIR, PORT);
  const httpServer = http.createServer(app);

  let nextPeerSlot = 1;
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/enet",
    maxPayload: 262144,
    handleProtocols: (protocols) => {
      if (protocols.has("binary")) return "binary";
      const first = protocols.values().next();
      return first.done ? false : first.value;
    },
  });

  wss.on("connection", (ws, req) => {
    let clientDeviceId = "";
    try {
      const parsedUrl = new URL(req.url || "/enet", "http://localhost");
      const rawCid = (parsedUrl.searchParams.get("cid") || "").trim();
      if (/^[A-Za-z0-9_-]{8,64}$/.test(rawCid)) {
        clientDeviceId = rawCid;
      }
    } catch {
      // ignore malformed URL
    }

    const slot = nextPeerSlot++ & 0x7ff;
    const peer = new ENetServerPeer(
      ws,
      slot,
      {
        onConnect: (p) => onPeerConnect(p),
        onReceive: (p, ch, payload) => onPeerReceive(ctx, p, ch, payload),
        onDisconnect: (p) => onPeerDisconnect(ctx, p),
      },
      clientDeviceId
    );

    ws.on("message", (data, isBinary) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
      if (!isBinary) {
        const wasBackground=peer.activity.background;
        if(peer.activity.presence(buf)&&wasBackground&&!peer.activity.background){
          const session=peer.userData as PlayerSession|null;
          if(session?.world)OnSetPos(session,session.x,session.y);
        }
        return;
      }
      if(ws.bufferedAmount>4*1024*1024){ws.close(1013,"Slow connection");return;}
      peer.handleRawFrame(buf);
    });

    ws.on("close", () => peer.destroy());
    ws.on("error", () => peer.destroy());
  });

  const shutdown = (): void => {
    ctx.savePersistentState();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  httpServer.listen(PORT, HOST, () => {
    console.log(`[${SERVER_NAME}] Modular Server listening on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal startup error:`, err);
  process.exit(1);
});
