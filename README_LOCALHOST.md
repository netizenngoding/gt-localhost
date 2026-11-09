# CreativeGrowtopia V1.50 — Localhost Server (Direct Upstream CDN `.wasm` + `.data`)

Authentic **ReGrowtopia 1.50** WebAssembly/WebGL client + authoritative **ENet-over-WebSocket** multiplayer server (`gt-localhost`), configured to load `ReGrowtopia-1.50.wasm` and `ReGrowtopia-1.50.data` **directly** from `https://play.creativeps.eu/creativegrowtopia_web/`.

## Architecture & Key Fixes
- **Direct Upstream `.wasm` & `.data` Streaming**:
  - Browser loads `ReGrowtopia-1.50.wasm` (`4.8 MB`) and `ReGrowtopia-1.50.data` (`341.7 MB`, all `3,603` VFS files intact including all 22 `.rtfont` bitmap fonts and sprites) directly from `https://play.creativeps.eu/creativegrowtopia_web/` via `Module.locateFile`, with automatic `IndexedDB` caching (`PACKAGES` store) after first download.
  - Server (`server/items.ts`) automatically fetches only the exact `/cache/items.dat` (`4,732,200` B, v18, `17,720` items, `protonHash = 1660113846`) and `/cache/player_tribute.dat` (`3,320` B, `protonHash = 3366554574`) byte slices via HTTP `Range` (`206 Partial Content`) on first boot and caches them in `data/cache/` — no local `.data` or `.wasm` files needed.
- **Full `SharedArrayBuffer` / PThreads + Embedded Iframe Fallback**:
  - `server/index.ts` serves `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on top-level documents and workers so `SharedArrayBuffer` and WebAssembly pthreads run natively on `http://localhost:8080`.
  - Automatically falls back to single-threaded mode inside non-isolated `<iframe>` previews.
- **WASM-Verified Protocol & Localhost Fixes**:
  - `public/ReGrowtopia-1.50.js` rebuilt cleanly from upstream `ReGrowtopia-1.50.js` with `SharedArrayBuffer`, pthreads, localhost hostname spoofing (`ASM_CONSTS[384098]`), and runtime indirect-table hooks (`TABLE[1493]`, `TABLE[1792]`, `TABLE[1803]`).
  - `public/WebLoaderData/RTLoader.js` routes `server_data.php` and game API requests to local `/growtopia/server_data.php` while keeping `.wasm`/`.data` pointed at `https://play.creativeps.eu/creativegrowtopia_web/`, and removes WASM `.data` overwrites on `369788`/`393901` (`join_calls` / `alt_font`).
  - `server/game.ts` & `server/packets.ts` fixed against disassembled WASM (`Func #5037`, `#4101`, `#2458`, `#4463`, `#5024`, `#2766`):
    - Added missing `action|join_request` world entry handler, `action|input` chat/`/command` parser, and `action|setSkin` handler.
    - Fixed `GameLogicComponent` RPC targeting (`netId = -1` for `OnConsoleMessage`, `OnSetBux`, `SetHasGrowID`) and replaced invalid `OnAddGems` with `OnSetBux`.
    - Removed duplicate local `OnSpawn` in `syncSpawn` and fixed `u16 count` in `makeWorldMapPacket` dropped items.
- **OSD Extra-File `/cache/*` System & Owner Asset Overrides**:
  - `RTLoader.js` rewrites all `/cache/*` XHR/fetch downloads (including `https://localhost/cache/...`) to same-origin `/cache/*`, preventing `[S] Can't find website. Bad url or no internet?` errors on OSD `(1..68)`.
  - `server/index.ts` serves `/cache/*` with 3-tier priority:
    1. **Owner local overrides** in `public/cache/<path>` (drop custom `.rttex` / `.wav` / `.dat` files here anytime),
    2. **Local disk cache** in `data/cache/<path>`,
    3. **Auto-fetch & disk-cache** from `https://play.creativeps.eu/cache/<path>` on first request (returning clean `404` when absent so the client silently skips optional files).
- **Permanent Sunny Sky + Purple Mountains Menu Weather**:
  - `lockSunnyMenuBackground()` in `RTLoader.js` overrides `/interface/large/generic_menu2.rttex` in Emscripten `FS` with `/interface/large/main_menu.rttex` before `mainf()`, locking Main Menu, Connect/OSD screen, World Select, Options, and About menus to the Sunny sky + purple mountains background.
- **Plain-Text Main Menu Splashes (`public/splashes.txt`)**:
  - Edit `public/splashes.txt` anytime (1 splash per line; `#` and `//` comments ignored; supports Growtopia `` ` `` color codes). No rebuild or server restart needed — refresh the browser to see updated splashes immediately.

## Owner Customization Guide
1. **Change Main Menu Splash Texts**: Edit `public/splashes.txt` and refresh the browser.
2. **Override / Add Custom Client Assets (`.rttex`, audio, etc.)**: Place files under `public/cache/<subpath>` (for example `public/cache/game/player_handitem5.rttex`).
3. **Add Custom Commands, Items, Dialogs, or World Mechanics**: Edit `server/game.ts`, then run `npm run build` and restart `node server/server_runtime.cjs`.

## Run on Localhost
```bash
cd gt-localhost
node server/server_runtime.cjs
# Server listens on http://0.0.0.0:8080 (WS gateway at /enet)
# Open http://localhost:8080 in Chrome / Edge / Firefox
```

To modify TypeScript sources and rebuild the self-contained runtime bundle:
```bash
npm install
npm run typecheck
npm run build
```

## Endpoints
- `GET /` — WebGL shell (`index.html`, `ReGrowtopia-1.50.js`, `WebLoaderData/*`)
- `GET|POST /growtopia/server_data.php` — Logon coordinator (`server|ws.creativeps.eu`, routed via `Module.websocket.url` to `/enet`)
- `GET /reEhtkssvWbhygankja.txt` — Startup enable flag (`1`)
- `GET /cache/items.dat` & `/cache/player_tribute.dat` — Cached VFS slices
- `GET /api/status` — Live server & asset hash status JSON
- `WS /enet` (`binary` subprotocol) — ENet-over-WebSocket game gateway
