import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Express } from "express";

export const DATA_SIZE = 341708818;
export const DATA_SHA256 = "f7f126b0a56d096006dd26f16a4cf6b1d3ab76f641d39b38c8a47081046719a7";
export const PART_SIZE = 20 * 1024 * 1024;
type Part = { file: string; size: number; sha256?: string; offset: number };
export function createDataPackage(rootDir: string) {
  const dir = path.join(rootDir, "data/client");
  let cached: {key: string; promise: Promise<Part[]>} | undefined;
  async function prepare(): Promise<Part[]> {
    const manifestFile = path.join(dir, "parts/manifest.json");
    let parts: Part[], manifestText = "";
    if (fs.existsSync(manifestFile)) {
      if (fs.statSync(manifestFile).size > 65536) throw Error("Manifest client terlalu besar.");
      manifestText = fs.readFileSync(manifestFile, "utf8");
      const m = JSON.parse(manifestText);
      if (m.version !== 1 || m.size !== DATA_SIZE || m.sha256 !== DATA_SHA256 || m.partSize !== PART_SIZE || !Array.isArray(m.parts) || m.parts.length !== Math.ceil(DATA_SIZE/PART_SIZE)) throw Error("Manifest client tidak kompatibel.");
      parts = m.parts.map((p: any, i: number) => {
        const name = `part-${String(i).padStart(3,"0")}.bin`;
        const size = Math.min(PART_SIZE, DATA_SIZE-i*PART_SIZE);
        if (p.file !== name || p.size !== size || !/^[a-f0-9]{64}$/.test(p.sha256)) throw Error(`Metadata ${name} tidak valid.`);
        return {file:path.join(dir,"parts",name),size,sha256:p.sha256,offset:i*PART_SIZE};
      });
    } else {
      parts = [{file:path.join(dir,"client.data"),size:DATA_SIZE,offset:0}];
    }
    const states = parts.map(p => {
      const s=fs.statSync(p.file);
      if (!s.isFile() || s.size !== p.size) throw Error(`Ukuran salah: ${path.basename(p.file)}. Jangan upload pointer Git LFS.`);
      return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    });
    const key = manifestText+states.join("|");
    if (cached?.key===key) return cached.promise;
    const promise = (async()=>{
      const whole=crypto.createHash("sha256");
      for(const p of parts){
        const hash=crypto.createHash("sha256");
        for await(const chunk of fs.createReadStream(p.file)){whole.update(chunk as Buffer);hash.update(chunk as Buffer);}
        if(p.sha256 && hash.digest("hex")!==p.sha256) throw Error(`SHA-256 salah: ${path.basename(p.file)}.`);
      }
      if(whole.digest("hex")!==DATA_SHA256) throw Error("SHA-256 gabungan client tidak cocok.");
      return parts;
    })();
    cached={key,promise};
    promise.catch(()=>{if(cached?.promise===promise)cached=undefined;});
    return promise;
  }
  function install(app: Express) {
    app.get("/client/client.data",async(req,res)=>{
      try {
        const parts=await prepare();
        const etag=`"${DATA_SHA256}"`;
        let start=0,end=DATA_SIZE-1;
        const range=req.headers.range && (!req.headers["if-range"] || req.headers["if-range"]===etag) ? req.headers.range : undefined;
        if(range){
          const m=/^bytes=(\d*)-(\d*)$/.exec(range);
          if(!m || (!m[1]&&!m[2])) {res.set("Content-Range",`bytes */${DATA_SIZE}`).status(416).end();return;}
          if(!m[1]){const n=Number(m[2]);start=Math.max(0,DATA_SIZE-n);if(!Number.isSafeInteger(n)||n<=0)start=DATA_SIZE;}
          else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=DATA_SIZE){res.set("Content-Range",`bytes */${DATA_SIZE}`).status(416).end();return;}
          res.status(206).set("Content-Range",`bytes ${start}-${end}/${DATA_SIZE}`);
        }
        res.set({"Content-Type":"application/octet-stream","Content-Length":String(end-start+1),"Accept-Ranges":"bytes","Cache-Control":"no-cache","ETag":etag});
        if(req.method==="HEAD"){res.end();return;}
        // Small stream buffers and backpressure; never Buffer.concat(326 MiB).
        async function* bytes(){for(const p of parts){
          const lo=Math.max(start,p.offset),hi=Math.min(end,p.offset+p.size-1);
          if(lo<=hi)yield* fs.createReadStream(p.file,{start:lo-p.offset,end:hi-p.offset});
        }}
        await pipeline(Readable.from(bytes()),res);
      } catch(error) {
        if(res.headersSent){res.destroy();return;}
        res.status(503).type("text/plain").send("Client data belum siap. Jalankan node tools/split-client.cjs <file-client.data>. Periksa /api/client-readiness.");
      }
    });
  }
  return {prepare,install};
}
