import { createDataPackage } from "../client/data-package";
import { SERVER_CONFIG } from "../config/branding";
import { patchClient } from "../client/patch-client";
import { SERVER_NAME } from "../config/branding";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { CLIENT_SHA256 } from "../client/patch-client";
import path from "node:path";
import express, { type Express } from "express";
import type { ServerContext } from "../database/context";
import { discordAuthorizeUrl, discordConfig, discordConfigured, getPlayerHead, getPlayerHeadUrl, linkDiscordAccount, storePlayerHead } from "../discord/service";
import { takeBannerRenderPage } from "../discord/banner";
import { ensureRpcHeadAsset } from "../discord/rpc-assets";
import { effectivePublicBaseUrl, rememberPublicBaseUrl } from "../discord/public-url";
import {buildSetClothingPacket} from "../onVariant/OnSetClothing";
import {makeVariantPacket} from "../proton/packet";

function collectCacheOverrides(dir: string, prefix = "", out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectCacheOverrides(path.join(dir, entry.name), rel, out);
    } else if (entry.isFile() && entry.name !== "overrides.json") {
      out.push(rel);
    }
  }
  return out;
}

function resolveSafeSubpath(baseDir: string, relPosixPath: string): string | null {
  const cleaned = path.posix.normalize("/" + relPosixPath).replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const full = path.resolve(baseDir, cleaned);
  const baseResolved = path.resolve(baseDir);
  if (full !== baseResolved && !full.startsWith(baseResolved + path.sep)) {
    return null;
  }
  return full;
}

export function createHttpApp(ctx: ServerContext, rootDir: string, port: number): Express {
  const publicDir = path.join(rootDir, "public");
  const publicCacheDir = path.join(publicDir, "cache");
  const diskCacheDir = path.join(rootDir, "data", "cache");
  const gtAssetsDir = path.join(rootDir, "tools", "gt", "Growtopia");
  const splashesFile = path.join(publicDir, "splashes.txt");

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.use((req, res, next) => {
    rememberPublicBaseUrl(req.headers);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    const fetchDest = req.headers["sec-fetch-dest"];
    if (fetchDest !== "iframe") {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    }
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  });

  app.get("/server-config.js", (_req,res)=>{
    res.setHeader("Cache-Control","no-store");
    const itemsHash = ctx.itemsDb.itemsDatHash >>> 0;
    res.type("application/javascript").send(
      "globalThis.SERVER_CONFIG=" +
      JSON.stringify(SERVER_CONFIG).replace(/</g,"\\u003c") +
      ";globalThis.SERVER_ITEMS_HASH=" +
      itemsHash +
      ";"
    );
  });
  app.get("/THIRD_PARTY_NOTICES.md",(_req,res)=>res.sendFile(path.join(rootDir,"THIRD_PARTY_NOTICES.md")));
  const dataPackage = createDataPackage(rootDir);
  dataPackage.install(app);
  // Fail visibly before Emscripten starts, instead of leaving an endless spinner.
  app.get("/api/client-readiness", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const issues: string[] = [];
    const wasm = path.join(rootDir, "data/client/upstream.wasm");
    const loader = path.join(publicDir, "MagnoliaClient-1.50.js");
    if (!fs.existsSync(loader)) issues.push("File public/MagnoliaClient-1.50.js tidak ada. Ekstrak seluruh patch ke root repository.");
    if (!fs.existsSync(wasm)) issues.push("File data/client/upstream.wasm tidak ada.");
    else if (crypto.createHash("sha256").update(fs.readFileSync(wasm)).digest("hex") !== CLIENT_SHA256) issues.push("File data/client/upstream.wasm tidak cocok dengan versi client yang didukung.");
    try { await dataPackage.prepare(); }
    catch (error) { issues.push("Client data belum siap: " + (error instanceof Error ? error.message : String(error)) + ". Upload semua data/client/parts beserta manifest.json atau gunakan client.data asli."); }
    res.status(issues.length ? 503 : 200).json({ ready: issues.length === 0, issues });
  });
  let clientPromise:Promise<Buffer>|null=null;
  app.get("/client/client.wasm",async(_req,res)=>{
    try {
      if(!clientPromise) clientPromise=(async()=>{
        const file=path.join(rootDir,"data/client/upstream.wasm");
        let bytes:Buffer;
        if(fs.existsSync(file)) bytes=fs.readFileSync(file);
        else throw new Error("Missing data/client/upstream.wasm; provide the compatible client locally");
        console.log("DEBUG upstream bytes", bytes.length);
        return patchClient(bytes,SERVER_CONFIG.hideLegacyCustomItemWarning, SERVER_CONFIG.autofillLabel, SERVER_CONFIG.serverName, publicCacheDir);
      })().catch(err=>{clientPromise=null;throw err;});
      res.setHeader("Cache-Control","no-store, max-age=0");
      res.setHeader("Pragma","no-cache");
      res.setHeader("Expires","0");
      const patched = await clientPromise;
      console.log("DEBUG route wasm", patched.length);
      res.type("application/wasm").send(patched);
    } catch(err) { console.error("Client preparation failed:",err);res.status(503).type("text/plain").send("Client preparation failed. Check server logs; unsupported client revisions must be audited."); }
  });

  app.all("/reEhtkssvWbhygankja.txt", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).type("text/plain").send("1\n");
  });

  app.get("/WebLoaderData/enet_codec.wasm", (_req, res) => {
    const codecFile = path.join(rootDir, "server", "enet_codec.wasm");
    if (fs.existsSync(codecFile)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.status(200).type("application/wasm").send(fs.readFileSync(codecFile));
      return;
    }
    res.status(404).end();
  });

  app.get("/splashes.txt", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).type("text/plain; charset=utf-8").send(SERVER_CONFIG.splashes.map(line=>line.replaceAll("{serverName}",SERVER_NAME)).join("\n")+"\n");
  });

  app.all("/growtopia/server_data.php", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = [
      "server|ws.creativeps.eu",
      "port|2053",
      "type|1",
      "#maint|Maintenance",
      "beta_server|ws.creativeps.eu",
      "beta_port|2053",
      "beta_type|1",
      "type2|0",
      "meta|localhost",
      "RTENDMARKERBS1001",
      "",
    ].join("\n");
    res.status(200).type("text/plain").send(body);
  });

  const iconRenderer = ctx.itemIcons;
  app.get("/api/item-icon/:itemSpec", (req, res) => {
    const rawSpec = String(req.params.itemSpec || "").replace(/\.png$/i, "");
    const itemId = Number(rawSpec);
    const png = iconRenderer.getIconPng(itemId);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).type("image/png").send(png);
  });

  app.get("/discord/link", async (req, res) => {
    const code = String(req.query.code || "");
    if (!code) {
      res.status(400).type("text/plain").send("Missing Discord link code.");
      return;
    }
    const url = await discordAuthorizeUrl(code);
    if (!url) {
      res.status(503).type("html").send("<!doctype html><meta charset=\"utf-8\"><title>Discord</title><body style=\"font-family:sans-serif;background:#111;color:#fff;padding:32px\"><h2>Discord linking belum dikonfigurasi</h2><p>Isi <code>config/discord.json</code> dengan <code>botToken</code> dan <code>clientId</code>.</p></body>");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  });

  app.get("/discord/callback", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Discord Linked</title><style>@font-face{font-family:'CenturyGothicBold';src:url('/branding/CenturyGothicBold.ttf') format('truetype');font-weight:bold;font-display:swap}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#000;font-family:'CenturyGothicBold','Century Gothic',sans-serif;font-weight:bold}.box{width:min(520px,calc(100vw - 40px));text-align:center}h1{font-size:30px;margin:0 0 18px}p{font-size:18px;line-height:1.45;margin:0}.back{display:none;margin-top:18px;color:#000}</style></head><body><div class="box"><h1 id="title">Discord</h1><p id="msg">Connecting account...</p><a id="back" class="back" href="/">Back to Magnolia</a></div><script>
function returnToMagnolia(){try{if(window.opener&&!window.opener.closed)window.opener.focus();}catch(e){}try{window.close();}catch(e){}setTimeout(function(){location.replace('/');},350);}
(async function(){var title=document.getElementById('title'),msg=document.getElementById('msg'),back=document.getElementById('back');var p=new URLSearchParams(location.hash.slice(1));var token=p.get('access_token');var state=p.get('state');if(!token||!state){title.textContent='Link Failed';msg.textContent='Token or state missing. Please link again from inside the game.';back.style.display='block';return;}try{var r=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('Discord HTTP '+r.status);var u=await r.json();var lr=await fetch('/api/discord/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:state,id:u.id,username:u.global_name||u.username||('user'+u.id)})});var lj=await lr.json();if(lj.ok){title.textContent='Account Linked';msg.textContent='Returning to Magnolia...';back.style.display='none';setTimeout(returnToMagnolia,500);}else{title.textContent='Link Failed';msg.textContent=lj.message||'Link failed.';back.style.display='block';}}catch(e){title.textContent='Link Failed';msg.textContent='Link failed: '+(e&&e.message?e.message:String(e));back.style.display='block';}})();
</script></body></html>`);
  });

  app.post("/api/discord/link", async (req, res) => {
    const body = (req.body || {}) as { code?: unknown; id?: unknown; username?: unknown };
    const result = await linkDiscordAccount(ctx, String(body.code || ""), String(body.id || ""), String(body.username || ""));
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post("/api/player-head", express.raw({ type: ["image/png", "application/octet-stream"], limit: "512kb" }), (req, res) => {
    const device = String(req.query.device || "").trim();
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(device) || !Buffer.isBuffer(req.body) || req.body.length < 64) {
      res.status(400).json({ ok: false });
      return;
    }
    storePlayerHead(device, req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  app.get("/api/discord/linked-banner/:token", (req, res) => {
    const page = takeBannerRenderPage(String(req.params.token || ""));
    if (!page) {
      res.status(404).type("text").send("Not found");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(page);
  });

  app.get("/api/discord/rpc/state", async (req, res) => {
    const requested = String(req.query.player || "").trim();
    const discordId = String(req.query.discordId || "").trim();
    if (!requested && !discordId) {
      res.json({ online: false, clientId: discordConfig().clientId });
      return;
    }
    if (discordId && !/^\d{5,32}$/.test(discordId)) {
      res.status(400).json({ online: false, linked: false, error: "invalid discordId" });
      return;
    }
    const wanted = requested.toLowerCase();
    const cfg = discordConfig();
    const acct = discordId
      ? Array.from(ctx.accounts.values()).find((a) => a.discordId === discordId)
      : ctx.accounts.get(wanted) || Array.from(ctx.accounts.values()).find((a) =>
          a.name.toLowerCase() === wanted || (a.growId || "").toLowerCase() === wanted
        );
    if (!acct) {
      res.json({ online: false, linked: false, clientId: cfg.clientId });
      return;
    }
    if (!acct.discordId) {
      res.json({ online: false, linked: false, name: acct.name, clientId: cfg.clientId });
      return;
    }
    const session = Array.from(ctx.sessions).find((s) => s.account.userId === acct.userId);
    if (!session) {
      res.json({ online: false, linked: true, name: acct.name, clientId: cfg.clientId });
      return;
    }
    const base = effectivePublicBaseUrl(cfg.publicBaseUrl);
    const headUrl = getPlayerHeadUrl(acct.deviceKey)
      || getPlayerHeadUrl(session.peer.clientDeviceId || "")
      || (/^https:\/\//i.test(base) ? `${base}/api/discord/rpc/head/${acct.userId}.png` : "");
    const head = getPlayerHead(acct.deviceKey) || getPlayerHead(session.peer.clientDeviceId || "");
    const headAssetKey = await ensureRpcHeadAsset(head);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      online: true,
      linked: true,
      userId: acct.userId,
      discordId: acct.discordId,
      name: acct.name,
      world: session.world?.name || "World Select",
      level: acct.progression?.level || 1,
      players: ctx.sessions.size,
      headUrl,
      headAssetKey,
      clientId: cfg.clientId,
    });
  });

  app.get(/^\/api\/discord\/rpc\/head\/(\d+)\.png$/, (req, res) => {
    const userId = Number(req.params[0]);
    const acct = Number.isSafeInteger(userId) ? ctx.findAccountByUserId(userId) : undefined;
    const session = acct ? Array.from(ctx.sessions).find((s) => s.account.userId === acct.userId) : undefined;
    const png = acct
      ? getPlayerHead(acct.deviceKey) || getPlayerHead(session?.peer.clientDeviceId || "")
      : undefined;
    if (!png) {
      res.status(404).type("text").send("Not found");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=30");
    res.type("png").send(png);
  });

  app.get("/api/discord/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: discordConfigured() });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      architecture: "Gurotopia-Modular-TS",
      engine: "Local WebAssembly client",
      assetMode: "local",
      playerTributeHash: ctx.itemsDb.playerTributeHash,
      ...ctx.getStats(),
    });
  });

  // Native console autofill candidates (item names only). The WASM client
  // appends these to its built-in command list, so the dropdown stays 100%
  // native while `/give 333 1 Indo` completes item names.
  let autofillItemsCache: { text: string; gzip: Buffer } | null = null;
  app.get("/api/autofill-items", (req, res) => {
    if (!autofillItemsCache) {
      const seen = new Set<string>();
      const names: string[] = [];
      for (const item of ctx.itemsDb.items.values()) {
        const name = item.name.replace(/`./g, "").trim();
        if (!name || name.startsWith("null_") || /REVOKED/i.test(name)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
      const text = names.join("\n") + "\n";
      autofillItemsCache = { text, gzip: zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 }) };
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      res.setHeader("Content-Encoding", "gzip");
      res.send(autofillItemsCache.gzip);
      return;
    }
    res.send(autofillItemsCache.text);
  });

  // Tell the web client which /cache overrides to preload into its WASM
  // filesystem (owner overrides + the custom Discord item texture).
  app.get("/cache/overrides.json", (_req, res) => {
    const overrides = collectCacheOverrides(publicCacheDir);
    if (!overrides.includes("game/discord_logo.rttex")) overrides.push("game/discord_logo.rttex");
    res.setHeader("Cache-Control", "no-cache");
    res.json(overrides.sort());
  });

  // Custom 32x32 Discord-logo item texture (tracked under public/GameData,
  // exposed through the game's /cache/game asset path).
  app.get(["/cache/game/discord_logo.rttex", "/cache/discord_logo.rttex"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("application/octet-stream").sendFile(path.join(publicDir, "GameData", "discord_logo.rttex"));
  });

  app.get(/^\/cache\/(.+)$/, async (req, res) => {
    const rawRel = (req.params as Record<string, string>)[0] || "";
    let decodedRel = rawRel;
    try {
      decodedRel = decodeURIComponent(rawRel);
    } catch {
      res.status(400).end();
      return;
    }
    const relPosix = decodedRel.replace(/\\/g, "/").replace(/^\/+/, "");
    if (relPosix === "items.dat") {
      res.setHeader("Cache-Control", "no-store");
      res.type("application/octet-stream").send(ctx.itemsDb.rawItemsDat); return;
    }
    const ownerOverridePath = resolveSafeSubpath(publicCacheDir, relPosix);
    const diskCachePath = resolveSafeSubpath(diskCacheDir, relPosix);
    const gtAssetPath = resolveSafeSubpath(gtAssetsDir, relPosix);
    if (!ownerOverridePath || !diskCachePath || !gtAssetPath) {
      res.status(400).end();
      return;
    }

    if (fs.existsSync(ownerOverridePath) && fs.statSync(ownerOverridePath).isFile() && fs.statSync(ownerOverridePath).size > 0) {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(ownerOverridePath);
      return;
    }

    // OSD downloads can overwrite VFS branding. Supply our branded banner
    // instead of a stale third-party disk cache, unless owner supplied an override.
    if (["interface/large/news_banner.rttex", "interface/large/news_banner_hd.rttex", "interface/large/news_banner_split.rttex"].includes(relPosix)) {
      const assetJs = fs.readFileSync(path.join(publicDir, "WebLoaderData", "BrandingAssets.js"), "utf8");
      const match = assetJs.match(/^[^=]+=\s*(\{[\s\S]*\});?\s*$/);
      if (!match) { res.status(500).send("Branding assets invalid"); return; }
      const assets = JSON.parse(match[1]) as {banner: string};
      res.type("application/octet-stream").send(Buffer.from(assets.banner, "base64")); return;
    }

    if (fs.existsSync(diskCachePath) && fs.statSync(diskCachePath).isFile() && fs.statSync(diskCachePath).size > 0) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.sendFile(diskCachePath);
      return;
    }

    if (fs.existsSync(gtAssetPath) && fs.statSync(gtAssetPath).isFile() && fs.statSync(gtAssetPath).size > 0) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.sendFile(gtAssetPath);
      return;
    }

    res.status(404).type("text/plain").send("Not Found");
  });

  app.use((req, _res, next) => {
    if (req.path.includes("gui_wrench_discord")) console.log("[asset]", req.path);
    next();
  });

  app.use(
    express.static(publicDir, {
      etag: true,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      },
    })
  );

  app.use((req, _res, next) => {
    console.warn("[404]", req.method, req.originalUrl);
    next();
  });

  return app;
}
