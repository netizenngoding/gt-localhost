import { SERVER_CONFIG } from "../config/branding";
import { patchClient } from "../client/patch-client";
import { SERVER_NAME } from "../config/branding";
import fs from "node:fs";
import crypto from "node:crypto";
import { CLIENT_SHA256 } from "../client/patch-client";
import path from "node:path";
import express, { type Express } from "express";
import type { ServerContext } from "../database/context";

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
  const splashesFile = path.join(publicDir, "splashes.txt");

  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
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
    res.type("application/javascript").send("globalThis.SERVER_CONFIG="+JSON.stringify(SERVER_CONFIG).replace(/</g,"\\u003c")+";");
  });
  app.get("/THIRD_PARTY_NOTICES.md",(_req,res)=>res.sendFile(path.join(rootDir,"THIRD_PARTY_NOTICES.md")));
  // Hash once per unchanged file, sharing work among concurrent requests.
  let checkedData: {key: string; promise: Promise<boolean>} | null = null;
  function verifyData(file: string, stat: fs.Stats): Promise<boolean> {
    const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (checkedData?.key === key) return checkedData.promise;
    const promise = (async () => {
      const hash = crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
      return hash.digest("hex") === "f7f126b0a56d096006dd26f16a4cf6b1d3ab76f641d39b38c8a47081046719a7";
    })();
    checkedData = {key, promise};
    promise.catch(() => { if (checkedData?.promise === promise) checkedData = null; });
    return promise;
  }
  // Fail visibly before Emscripten starts, instead of leaving an endless spinner.
  app.get("/api/client-readiness", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const issues: string[] = [];
    const wasm = path.join(rootDir, "data/client/upstream.wasm");
    const data = path.join(rootDir, "data/client/client.data");
    const loader = path.join(publicDir, "MagnoliaClient-1.50.js");
    if (!fs.existsSync(loader)) issues.push("File public/MagnoliaClient-1.50.js tidak ada. Ekstrak seluruh patch ke root repository.");
    if (!fs.existsSync(wasm)) issues.push("File data/client/upstream.wasm tidak ada.");
    else if (crypto.createHash("sha256").update(fs.readFileSync(wasm)).digest("hex") !== CLIENT_SHA256) issues.push("File data/client/upstream.wasm tidak cocok dengan versi client yang didukung.");
    if (!fs.existsSync(data)) issues.push("File data/client/client.data belum ada. Jalankan node tools/prepare-client.cjs <lokasi-file-atau-url>.");
    else {
      try {
        const stat = fs.statSync(data);
        if (!stat.isFile() || stat.size !== 341708818 || !(await verifyData(data, stat))) issues.push("data/client/client.data tidak cocok atau rusak. Jalankan ulang tools/prepare-client.cjs.");
      } catch { issues.push("data/client/client.data tidak dapat dibaca."); }
    }
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
        return patchClient(bytes,SERVER_CONFIG.hideLegacyCustomItemWarning, SERVER_CONFIG.autofillLabel, SERVER_CONFIG.serverName);
      })().catch(err=>{clientPromise=null;throw err;});
      res.setHeader("Cache-Control","no-cache");res.type("application/wasm").send(await clientPromise);
    } catch(err) { console.error("Client preparation failed:",err);res.status(503).type("text/plain").send("Client preparation failed. Check server logs; unsupported client revisions must be audited."); }
  });

  // The data package is supplied by the operator; Express supports range requests.
  app.get("/client/client.data", (_req, res) => {
    const file = path.join(rootDir, "data", "client", "client.data");
    if (!fs.existsSync(file)) {
      res.status(503).type("text/plain").send("Missing data/client/client.data. See PATCH_README.md.");
      return;
    }
    res.sendFile(file);
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
    if (!ownerOverridePath || !diskCachePath) {
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

    res.status(404).type("text/plain").send("Not Found");
  });

  app.use(
    express.static(publicDir, {
      etag: true,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      },
    })
  );

  return app;
}
