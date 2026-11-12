<div align="center">

# Localhost 2D Sandbox Engine

**High-Performance WebAssembly WebGL Client & Authoritative Node.js Multiplayer Server**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WebAssembly](https://img.shields.io/badge/Runtime-WebAssembly%20%2B%20WebGL-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)](https://webassembly.org/)
[![WebSocket](https://img.shields.io/badge/Transport-Binary%20WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://github.com/websockets/ws)
[![esbuild](https://img.shields.io/badge/Bundle-esbuild-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black)](https://esbuild.github.io/)

A full-stack, server-authoritative 2D tile-world engine combining a native WebAssembly WebGL canvas with an event-driven TypeScript backend, real-time binary packet replication, deterministic world state persistence, and responsive PWA delivery.

[Architecture](#architecture) • [Core Capabilities](#core-capabilities) • [Directory Structure](#directory-structure) • [Quick Start](#quick-start)

</div>

---

## Overview

This project runs a low-latency multiplayer 2D sandbox over **Express** and **Binary WebSockets (`ws`)**. Rather than trusting client memory or local simulation state, every tile mutation, world ownership rule, inventory operation, economy exchange, and movement tick is validated and synchronized directly by the Node.js authority layer.

---

## Core Capabilities

| Layer | Engineering Highlights |
| :--- | :--- |
| **Binary Packet Engine** | Compact fixed-offset `Buffer` serialization for tile grids, dynamic metadata blocks, avatar physics state, and batched world chunk replication (`server/`). |
| **Authoritative World State** | Persistent `100x60` multi-layer tile worlds (foreground, background, spatial ownership graphs via BFS flood-fill, timed crop/generator nodes, and dynamic ambient presets). |
| **Atomic Economy & Storage** | Pre-flight capacity and balance verification before deducting items or currency across player-to-player trades, automated storage blocks, and shop terminals. |
| **Access Control & Roles** | Tiered role permissions, per-world & per-region ownership lists, public/build-only/admin-restricted region modes, and server-side world moderation tools. |
| **Status & Physics Modifiers** | Configurable gravity, movement speed, jump capabilities, hazard immunity/damage loops, consumable cooldowns, and temporary modifier lifecycles. |
| **Browser Loader & PWA** | Responsive WebGL bootstrapper (`public/index.html`), mobile viewport locking, tab-focus session suspension guards, custom font/asset delivery, and Service Worker caching (`public/sw.js`). |

---

## Architecture

```text
+-------------------------------------------------------------------+
|                  Browser Client (WebAssembly + WebGL)             |
|    public/index.html   •   public/sw.js   •   Loader Modules      |
+---------------------------------+---------------------------------+
                                  |
                     HTTPS / HTTP | Binary WebSocket Frames
                                  v
+-------------------------------------------------------------------+
|             Authoritative Node.js Server (Express + ws)           |
|  server/index.ts ──▶ Binary Packet Codec & Dispatcher             |
|        │                                                          |
|        ├──▶ World Engine        (Grids, BFS Regions, Drops, Weather)|
|        ├──▶ Action Pipeline     (Auth, Input, Hazards, Trading)   |
|        ├──▶ Dialog & UI Flows   (Region Settings, Terminals, Prefs)|
|        ├──▶ Modifiers & Effects (Physics Flags, Consumables, Audio)|
|        └──▶ Persistence Store   (Atomic JSON Snapshots & Backups) |
+-------------------------------------------------------------------+
```

---

## Directory Structure

```text
.
├── config/          # Runtime server configuration files
├── data/            # Client WebAssembly runtime & item registry data
├── data_store/      # Persisted worlds, accounts, roles, and backups
├── public/          # WebGL host shell, PWA manifest, worker, loader scripts
└── server/          # TypeScript server source & compiled production bundle
    ├── action/      # Connection lifecycle, input validation, trades, hazards, dialogs
    ├── client/      # Client asset stream helpers & runtime patches
    ├── commands/    # Chat command routing & role-gated utilities
    ├── config/      # Configuration schema validation
    ├── database/    # World simulation, item parser, session & disk store
    ├── gamePacket/  # Real-time movement, tile interaction & item handlers
    ├── https/       # HTTP API & static asset routes
    ├── onVariant/   # Structured RPC packet builders
    ├── playmods/    # Buffs, physics modifiers, consumables & visuals
    ├── progression/ # Experience, levels, quests & milestones
    └── ranks/       # Permission & interaction reach rules
```

---

## Quick Start

### Requirements

- **Node.js 20+**
- **npm**

### Install & Build

```bash
npm install
npm run typecheck
npm run build
```

### Start Production Server

```bash
# Default entry
npm start

# Custom port (PowerShell)
$env:PORT = '8085'
node server/server_runtime.cjs

# Custom port (Unix / bash)
PORT=8085 node server/server_runtime.cjs
```

Visit `http://localhost:8085/` in any modern WebGL-capable browser (or expose through your HTTPS reverse proxy).

---

<div align="center">

Built with **TypeScript**, **Node.js**, **Express**, **ws**, and **WebAssembly**.

</div>
