<div align="center">

# gt-localhost

**Authoritative WebAssembly & ENet-over-WebSocket Sandbox MMO Server**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WebAssembly](https://img.shields.io/badge/Client-WebAssembly%20%2B%20WebGL-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)](https://webassembly.org/)
[![WebSocket](https://img.shields.io/badge/Transport-ENet--over--WS-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://github.com/websockets/ws)
[![esbuild](https://img.shields.io/badge/Bundle-esbuild-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black)](https://esbuild.github.io/)

Full-stack browser-native Growtopia 1.50 WebAssembly server built from the ground up with binary protocol parity, real-time multiplayer state synchronization, atomic economy guards, and PWA offline/viewport support.

[Quick Start](#quick-start) • [Architecture](#architecture) • [Core Systems](#core-systems) • [Project Layout](#project-layout) • [Verification](#verification)

</div>

---

## Overview

`gt-localhost` bridges a native WebAssembly WebGL client with a high-performance **TypeScript / Node.js** authoritative server over binary **ENet-over-WebSocket** (`ws`) and HTTP routes (`express`). Every world mutation, inventory transaction, playmod effect, tile extra serialization, and lock permission is enforced server-side.

> **Highlights**
> - **Binary Protocol Parity:** Exact `TankPacket`, `VariantList`, `Tile::Serialize`, `World::SerializeFromMem`, and `PACKET_SEND_LOCK` (`15`) binary encoders validated against native client expectations.
> - **Anti-Freeze Session Lifecycle:** Tab-switch / minimize session guards, bounded foreground input queueing, and clean worker ticks without rubber-banding or mid-air snap-backs.
> - **Atomic Transactions:** Inventory capacity & currency checks happen before any deduction across Vending Machines, Lock Compression, Sucker/Magplant machines, Recipes, and Drops.

---

## Core Systems

| Subsystem | Capabilities & Implementation |
| :--- | :--- |
| **World & Tile Engine** | Binary `makeWorldMapPacket` & `serializeSingleTile` supporting Doors, Signs, Locks, Seeds, Trees, Providers/ATMs, Vending/DigiVend, Magplant/Gaia/UT, Weather BG/Stuff/Infinity, GrowScan (`6016`), and Xenonite (`2072`). |
| **Locks & Access Control** | BFS area flood-fill for Small (`10`), Big (`48`), Huge/Builder's Locks (`200`), `PACKET_SEND_LOCK` live sync, Builder's Lock (`4994`) flags (`emptyAir`, `buildOnly`, `limitAdmins`), World Lock tiers (`242`, `1796`, `5260`, `7188`, `10410`, `11550`, `11586`, `11902`, `12654`), full-inventory & Magplant/storage break protection, `/convert` compression. |
| **Xenonite Crystal (`2072`)** | One crystal per world with live configurable toggles: Double Jump, High Jump, Heat Resist (lava immunity/override), Strong Punch, Long Punch, Long Build, Speedy, and Powerup blocking. |
| **Weather Machines** | Full `0..85` weather ID mapping, `0x40` active state preserved cleanly with `1.5s` punch cooldown, single-active-machine exclusivity, lock default weather fallback, `weatherspcl` (`3694`, `5000`, `3832`) custom RGB/item/gravity/spin/invert settings, and `/weather`. |
| **Vending & Automation** | Regular (`2978`) & DigiVend (`9268`) with particle upgrade effect (`44`), price-per-item & items-per-WL modes, safe pre-checks before WL/item exchange; **Magplant 5000 (`5638`)**, **Heart of Gaia (`6948`)**, and **Unstable Tesseract (`6946`)** with remote (`5640`) lifecycle (`OnPlanterActivated`). |
| **Cosmetics, PlayMods & Hazards** | Little-endian `0xBBGGRRAA` Hair Dye, Eye Drops & Contact Lenses (`*9` initial delta, `/shower`), Slowfall Balloon floating (`flags = 1024`, `gravity = 250`, duration refresh), wearable effects/punch table, virus/food buffs, recipes, and lava/spike/acid hazard ticks. |
| **Client Loader & PWA** | Responsive WebGL loader (`public/index.html`, `public/WebLoaderData/`), mobile/viewport lock, native session guard, autofill, chat heads, and service worker caching (`public/sw.js`). |

---

## Architecture

```text
+-------------------------------------------------------------------+
|                   Browser (WebAssembly + WebGL)                   |
|   public/index.html  •  public/sw.js  •  public/WebLoaderData/*   |
+---------------------------------+---------------------------------+
                                  |
                  HTTP / HTTPS    |   ENet-over-WebSocket (Binary)
                                  v
+-------------------------------------------------------------------+
|               Node.js Authoritative Server (Express + ws)         |
|  server/index.ts ──▶ server/proton/packet.ts (Binary En/Decoder)  |
|        │                                                          |
|        ├──▶ server/action/         (Logon, Wrench, Hazards, Trade)|
|        ├──▶ server/action/dialog_return/ (Lock, Vend, Sucker, etc)|
|        ├──▶ server/gamePacket/     (Movement, Tile Change, Items) |
|        ├──▶ server/playmods/       (Wearables, Consumables, Virus)|
|        ├──▶ server/commands/       (Player, World, Admin/Staff)   |
|        └──▶ server/database/       (Context, ItemsDB, Peer, World)|
+-------------------------------------------------------------------+
                                  │
                                  v
                   Persistent JSON State (`data_store/`)
```

---

## Project Layout

```text
.
├── config/                  # Runtime server configuration (server.json)
├── data/                    # Client WebAssembly assets & base item data
├── data_store/              # Persisted players, worlds, ranks, and backups
├── public/                  # WebGL wrapper, PWA manifest, sw.js, loader scripts
├── server/
│   ├── action/              # Input, logon, respawn, hazards, trade, wrench, dialogs
│   ├── client/              # Runtime WASM / client data part loaders & patches
│   ├── commands/            # Chat command handlers (player, world, admin)
│   ├── config/              # Branding & configuration validators
│   ├── database/            # World simulation, item parser, session & account persistence
│   ├── gamePacket/          # TankPacket handlers (moving, tile change, activate)
│   ├── https/               # Express routes & Growtopia server_data endpoint
│   ├── onVariant/           # Variant RPC emitters
│   ├── playmods/            # Buffs, consumables, wearable catalog & punch effects
│   ├── progression/         # Leveling, XP, quests & achievements
│   ├── proton/              # Binary Growtopia / Proton packet & tile serializer
│   └── ranks/               # Role authorization & interaction reach
└── tests/                   # Automated verification & regression suite
```

---

## Quick Start

### Prerequisites

- **Node.js 20+**
- **npm**

### Install & Build

```bash
npm install
npm run typecheck
npm run build
```

### Run Server

```bash
# Default start
npm start

# Or custom port (PowerShell)
$env:PORT = '8085'
node server/server_runtime.cjs

# Or custom port (bash/sh)
PORT=8085 node server/server_runtime.cjs
```

Once running, open `http://localhost:8085/` in your browser (or route through your HTTPS/tunnel reverse proxy).

---

## Verification

Run TypeScript type-checking, bundle compilation, and regression tests cleanly:

```bash
npm run typecheck
npm run build
node tests/session-guard.cjs
node tests/gtps3-extended-features.cjs
node tests/player-integrity.cjs
node tests/wearable-mods.cjs
node tests/gameplay-actions.cjs
```

---

<div align="center">

**[github.com/netizenngoding/gt-localhost](https://github.com/netizenngoding/gt-localhost)**

</div>
