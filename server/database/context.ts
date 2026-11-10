import { effectiveSkin } from "../playmods/model";
import { expireMods } from "../playmods/service";
import { recordProgress } from "../progression/service";
import { buildCharacterStateForSession } from "./peer";
import { staffInteractionReach } from "../ranks/interaction";
import { displayName } from "../ranks";
import { RankService } from "../ranks/service";
import { worldDestination, isPlayableWorldName } from "./world-policy";
import { RequestWorldSelectMenu } from "../onVariant/RequestWorldSelectMenu";
import fs from "node:fs";
import path from "node:path";
import {
  makeInventoryPacket,
  makeModifyInventoryPacket,
  makeSetCharacterStatePacket,
  makeVariantPacket,
  makeWorldMapPacket,
} from "../proton/packet";
import {
  broadcastConsoleMessage,
  broadcastOnRemove,
  broadcastPositionedSfx,
  broadcastSetClothing,
  broadcastSetPos,
  buildSetClothingPacket,
  OnConsoleMessage,
  OnTalkBubble,
  OnSetBux,
  OnSpawn,
} from "../onVariant";
import type { ItemDatabase } from "./items";
import {
  normalizeAccount,
  type PlayerAccount,
  type PlayerSession,
} from "./peer";
import {
  generateFreshWorld,
  hydrateWorldFromDisk,
  serializeWorldForDisk,
  type PersistedWorld,
  type WorldInstance,
} from "./world";

export class ServerContext {
  public readonly itemsDb: ItemDatabase;
  public readonly rootDir: string;
  public readonly dataStoreDir: string;
  public readonly playersFile: string;
  public readonly worldsFile: string;

  public readonly accounts = new Map<string, PlayerAccount>();
  public readonly accountsByDevice = new Map<string, PlayerAccount>();
  public readonly worlds = new Map<string, WorldInstance>();
  public readonly sessions = new Set<PlayerSession>();

  public nextUserId = 1001;
  public nextNetId = 1;
  public dirty = false;
  public readonly ranks: RankService;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(itemsDb: ItemDatabase, rootDir: string) {
    this.ranks = new RankService(rootDir);
    this.itemsDb = itemsDb;
    this.rootDir = rootDir;
    this.dataStoreDir = path.join(rootDir, "data_store");
    this.playersFile = path.join(this.dataStoreDir, "players.json");
    this.worldsFile = path.join(this.dataStoreDir, "worlds.json");

    fs.mkdirSync(this.dataStoreDir, { recursive: true });
    // Preserve pre-migration data once; never erase the only copy of disabled custom items.
    if (fs.existsSync(this.worldsFile) && !fs.existsSync(this.worldsFile + ".pre-world-policy.bak"))
      fs.copyFileSync(this.worldsFile, this.worldsFile + ".pre-world-policy.bak");
    for (const file of [this.playersFile, this.worldsFile]) {
      if (fs.existsSync(file) && !fs.existsSync(file + ".pre-original-items.bak"))
        fs.copyFileSync(file, file + ".pre-original-items.bak");
    }
    this.loadPersistentState();

    const modTimer = setInterval(() => expireMods(this), 250);
    modTimer.unref();
    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.savePersistentState();
      }
    }, 15_000);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  private loadPersistentState(): void {
    try {
      if (fs.existsSync(this.playersFile)) {
        const rawPlayers = JSON.parse(fs.readFileSync(this.playersFile, "utf8")) as Array<
          Partial<PlayerAccount> & { userId: number; name: string }
        >;
        if (!Array.isArray(rawPlayers)) throw new Error("players.json must be an array");
        if (Array.isArray(rawPlayers)) {
          for (const raw of rawPlayers) {
            if (!raw || typeof raw.name !== "string" || !raw.name || !Number.isSafeInteger(raw.userId) || raw.userId <= 0) throw new Error("Invalid player record");
            if (this.accounts.has(raw.name.toLowerCase()) || this.findAccountByUserId(raw.userId)) throw new Error("Duplicate player identity");
            const acct = normalizeAccount(raw);
            // Do not silently delete disabled legacy/custom items on the next save.
            // Quarantine them instead of sending unknown IDs to this client.
            const unavailable = acct.inventory.filter(slot => !this.itemsDb.get(slot.itemId));
            acct.inventory = acct.inventory.filter(slot => !!this.itemsDb.get(slot.itemId));
            acct.unavailableInventory = [...(acct.unavailableInventory || []), ...unavailable];
            // Old builds made every new account a moderator. Require explicit operator IDs.
            this.ranks.apply(acct);
            this.accounts.set(acct.name.toLowerCase(), acct);
            if (acct.isGuest && acct.deviceKey) {
              this.accountsByDevice.set(acct.deviceKey, acct);
            }
            if (acct.userId >= this.nextUserId) {
              this.nextUserId = acct.userId + 1;
            }
          }
        }
      }
    } catch (err) {
      throw new Error("Refusing startup: players.json cannot be loaded", { cause: err });
    }

    try {
      if (fs.existsSync(this.worldsFile)) {
        const rawWorlds = JSON.parse(fs.readFileSync(this.worldsFile, "utf8")) as PersistedWorld[];
        if (!Array.isArray(rawWorlds)) throw new Error("worlds.json must be an array");
        if (Array.isArray(rawWorlds)) {
          for (const rw of rawWorlds) {
            if (!rw || typeof rw.name !== "string" || !rw.name) throw new Error("Invalid world record");
            if (!isPlayableWorldName(rw.name)) continue;
            const world = hydrateWorldFromDisk(rw);
            for (const tile of world.tiles) {
              if (tile.fg && !this.itemsDb.get(tile.fg)) { tile.fg = 0; tile.extra = undefined; tile.damage = 0; tile.flags = 0; }
              if (tile.bg && !this.itemsDb.get(tile.bg)) tile.bg = 0;
            }
            world.objects = world.objects.filter(obj => !!this.itemsDb.get(obj.itemId));
            this.worlds.set(world.name.toUpperCase(), world);
          }
        }
      }
    } catch (err) {
      throw new Error("Refusing startup: worlds.json cannot be loaded", { cause: err });
    }

    if (!this.worlds.has("START")) {
      this.worlds.set("START", generateFreshWorld("START"));
    }
  }

  public savePlayersNow(): void {
    try {
      const playersArr = Array.from(this.accounts.values());
      const tmp = `${this.playersFile}.tmp-${process.pid}`;
      const fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(playersArr)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(this.playersFile)) fs.copyFileSync(this.playersFile, this.playersFile + ".bak");
      fs.renameSync(tmp, this.playersFile);
    } catch (err) {
      this.dirty = true;
      throw new Error("Player save failed; mutation was not acknowledged", { cause: err });
    }
  }

  public savePersistentState(): void {
    this.savePlayersNow();
    try {
      const worldsArr = Array.from(this.worlds.values()).map((w) => serializeWorldForDisk(w));
      const tmpW = `${this.worldsFile}.tmp-${process.pid}`;
      const fd = fs.openSync(tmpW, "w", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(worldsArr)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(this.worldsFile)) fs.copyFileSync(this.worldsFile, this.worldsFile + ".bak");
      fs.renameSync(tmpW, this.worldsFile);
      this.dirty = false;
    } catch (err) {
      console.warn("[ServerContext] Failed saving worlds.json:", err);
    }
  }

  public getStats(): Record<string, unknown> {
    return {
      onlinePlayers: this.sessions.size,
      registeredAccounts: this.accounts.size,
      loadedWorlds: this.worlds.size,
      itemsCount: this.itemsDb.items.size,
    };
  }

  public findAccountByUserId(userId: number): PlayerAccount | undefined {
    for (const a of this.accounts.values()) {
      if (a.userId === userId) return a;
    }
    return undefined;
  }

  public findSessionByNameGlobal(name: string): PlayerSession | undefined {
    const q = name.trim().toLowerCase();
    if (!q) return undefined;
    for (const s of this.sessions) {
      if (s.account.name.toLowerCase() === q) return s;
    }
    return undefined;
  }

  public findOnlineSessionByName(name: string): PlayerSession | undefined {
    return this.findSessionByNameGlobal(name);
  }

  public getOrCreateWorld(rawName: string): WorldInstance {
    const destination = worldDestination(rawName);
    if (destination.kind !== "world") throw new Error("Invalid world creation request");
    const clean = destination.name;
    let w = this.worlds.get(clean);
    if (!w) {
      w = generateFreshWorld(clean);
      this.worlds.set(clean, w);
      this.dirty = true;
    }
    return w;
  }

  public findMainDoorPixel(world: WorldInstance): { x: number; y: number } {
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i].fg === 6) {
        const tx = i % world.width;
        const ty = Math.floor(i / world.width);
        return { x: tx * 32, y: ty * 32 };
      }
    }
    return { x: 48 * 32, y: 36 * 32 };
  }

  public sendInventory(session: PlayerSession, syncLocalClothes = true): void {
    session.peer.sendPacket(
      0,
      makeInventoryPacket(session.account.backpackSize, session.account.inventory),
      true
    );
    if (syncLocalClothes && session.world && session.netId > 0) {
      // makeInventoryPacket sends flags=0; follow immediately with OnSetClothing (all 10 slots 0..9!)
      // so client invSlot->flags (0 ^ 1 = 1) and m_clothes[0..9] stay 100% synced!
      session.peer.sendPacket(0, buildSetClothingPacket(session, this.itemsDb, false), true);
    }
  }

  public giveInventoryItem(
    session: PlayerSession,
    itemId: number,
    qty: number,
    syncClient = true
  ): number {
    if (!Number.isSafeInteger(qty) || qty <= 0 || itemId <= 0 || itemId === 6 || !this.itemsDb.get(itemId)) return 0;
    const inv = session.account.inventory;
    let slot = inv.find((s) => s.itemId === itemId);
    let added = 0;
    if (slot) {
      const room = Math.max(0, 200 - slot.count);
      added = Math.min(qty, room);
      slot.count += added;
    } else if (inv.length < session.account.backpackSize) {
      added = Math.min(200, qty);
      slot = { itemId, count: added, equipped: false };
      inv.push(slot);
    }
    if (added > 0) {
      this.dirty = true;
      this.savePlayersNow();
      if (syncClient) {
        if (session.world) {
          session.peer.sendPacket(0, makeModifyInventoryPacket(itemId, added, 0), true);
        } else {
          this.sendInventory(session, false);
        }
      }
    }
    return added;
  }

  public consumeInventoryItem(
    session: PlayerSession,
    itemId: number,
    qty: number,
    sendModifyPacket = true,
    persistNow = true
  ): boolean {
    const idx = session.account.inventory.findIndex((s) => s.itemId === itemId && s.count >= qty);
    if (idx === -1) return false;
    const slot = session.account.inventory[idx];
    const wasEquipped = !!slot.equipped;
    slot.count -= qty;
    if (slot.count <= 0 && itemId !== 18 && itemId !== 32) {
      session.account.inventory.splice(idx, 1);
    } else if (slot.count <= 0) {
      slot.count = 1;
    }
    this.dirty = true;
    if(persistNow)this.savePlayersNow();
    if (sendModifyPacket) {
      if (session.world) {
        session.peer.sendPacket(0, makeModifyInventoryPacket(itemId, 0, qty), true);
      } else {
        this.sendInventory(session, false);
      }
    }
    if (wasEquipped && slot.count <= 0 && session.world) {
      broadcastSetClothing(session.world, session, this.itemsDb, false);
      this.sendCharacterState(session);
    }
    return true;
  }

  public sendCharacterState(session: PlayerSession): void {
    const state = buildCharacterStateForSession(session, this.itemsDb);
    const equipped = new Set(session.account.inventory.filter(i=>i.equipped && i.count>0).map(i=>i.itemId));
    const riftCape = equipped.has(10424), riftWings = equipped.has(11478), infinityAura = equipped.has(14086);
    const pkt = makeSetCharacterStatePacket(state);
    session.peer.sendPacket(0, pkt, true);
    if (session.world) {
      for (const other of session.world.peers) {
        if (other !== session) other.peer.sendPacket(0, pkt, true);
      }
    }
    if (riftCape) {
      session.peer.sendPacket(0, makeVariantPacket(["OnRiftCape", { type: "i32", value: 1 }], session.netId), true);
    }
    if (riftWings) {
      session.peer.sendPacket(0, makeVariantPacket(["OnRiftWings", { type: "i32", value: 1 }], session.netId), true);
    }
    if (infinityAura) {
      session.peer.sendPacket(0, makeVariantPacket(["OnInfinityAura", { type: "i32", value: 1 }], session.netId), true);
    }
  }

  public syncWorldPeersForJoiner(session: PlayerSession): void {
    const world = session.world;
    if (!world) return;
    for (const other of world.peers) {
      if (other === session) continue;
      OnSpawn(session, other, false);
      session.peer.sendPacket(0, makeSetCharacterStatePacket(buildCharacterStateForSession(other, this.itemsDb)), true);
      session.peer.sendPacket(0, buildSetClothingPacket(other, this.itemsDb, false), true);
      session.peer.sendPacket(
        0,
        makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(other.account) >>> 0 }], other.netId),
        true
      );
      OnSpawn(other, session, false);
      // The caller broadcasts the joiner's outfit once after all spawns are sent.
    }
    const entry = `\`5<${displayName(session)} entered, \`w${world.peers.size - 1}\`\` others here>\`\``;
    for (const other of world.peers) {
      if (other === session) continue;
      OnConsoleMessage(other, entry);
      OnTalkBubble(other, session.netId, entry, 1);
      OnTalkBubble(session, other.netId, displayName(other), 1);
    }
  }

  private schedulePostSpawnSkinSync(session: PlayerSession, expectedWorld: WorldInstance, expectedNetId: number): void {
    const skinU32 = effectiveSkin(session.account) >>> 0;
    const skinPkt = makeVariantPacket(["OnChangeSkin", { type: "u32", value: skinU32 }], expectedNetId);
    session.peer.sendPacket(0, skinPkt, true);
    const stillJoined = () => session.world === expectedWorld && session.netId === expectedNetId && this.sessions.has(session);
    const synchronizeRemoteOutfits = () => {
      if (!stillJoined()) return;
      for (const p of expectedWorld.peers) {
        if (p === session || p.world !== expectedWorld || !this.sessions.has(p)) continue;
        // Each send uses current equipment. Never reset anyone else's inventory.
        p.peer.sendPacket(0, buildSetClothingPacket(session, this.itemsDb, false), true);
        session.peer.sendPacket(0, buildSetClothingPacket(p, this.itemsDb, false), true);
        session.peer.sendPacket(0, makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(p.account) >>> 0 }], p.netId), true);
      }
    };
    const first = setTimeout(() => {
      if (!stillJoined()) return;
      // The local inventory packet clears equipped bits; immediately restore.
      this.sendInventory(session, true);
      this.sendCharacterState(session);
      const refreshPkt = makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(session.account) >>> 0 }], expectedNetId);
      for (const p of expectedWorld.peers) p.peer.sendPacket(0, refreshPkt, true);
      synchronizeRemoteOutfits();
    }, 180);
    first.unref();
    // Remote avatars may be created later than 180ms on slow browsers. Retry
    // only remote outfit packets; re-read equipment and guard world/netId.
    for (const delay of [1000, 3000]) {
      const timer = setTimeout(synchronizeRemoteOutfits, delay);
      timer.unref();
    }
  }

  public exitToWorldSelect(session: PlayerSession): void {
    this.leaveCurrentWorld(session, true);
    RequestWorldSelectMenu(session, this.worlds);
  }

  public joinWorld(session: PlayerSession, rawWorldName: string): void {
    const destination = worldDestination(rawWorldName);
    if (destination.kind === "exit") { this.exitToWorldSelect(session); return; }
    if (destination.kind === "invalid") {
      OnConsoleMessage(session, destination.reason);
      session.peer.sendPacket(0, makeVariantPacket(["OnFailedToEnterWorld"]), true); return;
    }
    const world = this.getOrCreateWorld(destination.name);
    this.leaveCurrentWorld(session, false);
    const spawn = this.findMainDoorPixel(world);
    this.enterWorldAtPixel(session, world, spawn.x, spawn.y, "audio/door_shut.wav", true);
  }

  public moveToWorld(session: PlayerSession, world: WorldInstance, x: number, y: number): void {
    if (!isPlayableWorldName(world.name)) return;
    this.leaveCurrentWorld(session, false);
    this.enterWorldAtPixel(session, world, x, y, "audio/teleport.wav", false);
  }

  private enterWorldAtPixel(
    session: PlayerSession,
    world: WorldInstance,
    x: number,
    y: number,
    entrySfx: string,
    announceEntry: boolean
  ): void {
    session.world = world;
    session.respawnUntil = 0;
    session.respawnGeneration = (session.respawnGeneration || 0) + 1;
    session.x = x;
    session.y = y;
    session.netId = this.nextNetId++;
    world.peers.add(session);

    // Record in recentWorlds
    session.account.recentWorlds = [
      world.name,
      ...(session.account.recentWorlds || []).filter((n) => n !== world.name),
    ].slice(0, 8);

    session.peer.sendPacket(
      0,
      makeWorldMapPacket(
        world.name,
        world.width,
        world.height,
        world.tiles,
        world.objects,
        world.lastObjectUid,
        world.weatherId,
        Date.now()
      ),
      true
    );
    OnSpawn(session, session, true);
    this.sendInventory(session, false);
    this.syncWorldPeersForJoiner(session);
    // Broadcast all 10 clothing slots (0..9) + skinColor so invSlot->flags (0^1=1) and m_clothes[0..9] equip cleanly!
    broadcastSetClothing(world, session, this.itemsDb, false);
    this.schedulePostSpawnSkinSync(session, world, session.netId);
    OnSetBux(session);
    this.sendCharacterState(session);
    broadcastPositionedSfx(world, session.netId, entrySfx);
    for (const peer of world.peers) recordProgress(this, peer, undefined, 0);

    if (announceEntry) {
      const owner = world.ownerUserId ? this.findAccountByUserId(world.ownerUserId) : undefined;
      const lockNote = owner
        ? ` \`o[\`wWorld Locked\`\` by \`2${owner.name}\`o]\`\``
        : " `o(Unclaimed - place a World Lock!)``";
      OnConsoleMessage(
        session,
        `World \`w${world.name}\`\` entered. There are \`w${world.peers.size - 1}\`\` other people here, \`w${this.sessions.size}\`\` online.${lockNote}`
      );
    }
  }

  public leaveCurrentWorld(session: PlayerSession, notifySelf: boolean): void {
    const world = session.world;
    if (!world) return;
    world.peers.delete(session);
    session.world = null;
    broadcastOnRemove(world, session);
    for (const other of world.peers) {
      OnConsoleMessage(
        other,
        `\`5< \`w${session.account.name}\`5 left, \`w${world.peers.size}\`5 others here >\`\``
      );
    }
    if (notifySelf) {
      OnConsoleMessage(session, `Left world \`w${world.name}\`\`.`);
    }
  }

  public respawnPlayer(session: PlayerSession, isSpike = false): void {
    const world = session.world;
    if (!world || (session.respawnUntil && Date.now() < session.respawnUntil)) return;
    let spawn = this.findMainDoorPixel(world);
    const {spawnWorld, spawnX, spawnY} = session.account;
    if (spawnWorld === world.name && Number.isFinite(spawnX) && Number.isFinite(spawnY)) {
      const tx = Math.floor(spawnX! / 32), ty = Math.floor(spawnY! / 32);
      if (tx >= 0 && tx < world.width && ty >= 0 && ty < world.height && world.tiles[ty * world.width + tx]?.fg === 23) spawn = {x: spawnX!, y: spawnY!};
    }
    const netId = session.netId;
    session.x = spawn.x; session.y = spawn.y;
    session.respawnUntil = Date.now() + 2020;
    // Follow the client's death lifecycle: freeze, death, delayed position, unfreeze.
    if (!isSpike) {
      session.peer.sendPacket(0, makeVariantPacket(["OnSetFreezeState", {type:"u32",value:2}], netId), true);
      const killedPkt = makeVariantPacket(["OnKilled"], netId);
      for (const p of world.peers) p.peer.sendPacket(0, killedPkt, true);
    }
    const generation = session.respawnGeneration = (session.respawnGeneration || 0) + 1;
    const valid = () => session.world === world && session.netId === netId && session.respawnGeneration === generation && this.sessions.has(session);
    // Server-side delays avoid stale position packets reaching a later world.
    setTimeout(() => {
      if (!valid()) return;
      const position = makeVariantPacket(["OnSetPos", {type:"vec2", x:spawn.x, y:spawn.y}], netId);
      for (const p of world.peers) p.peer.sendPacket(0, position, true);
      broadcastPositionedSfx(world, netId, "audio/teleport.wav");
    }, 2000).unref();
    setTimeout(() => {
      if (!valid()) return;
      session.peer.sendPacket(0, makeVariantPacket(["OnSetFreezeState", {type:"u32",value:0}], netId), true);
      session.respawnUntil = 0;
    }, 2020).unref();
  }

  public sendCustomVariant(session: PlayerSession, fnName: string, ...args: string[]): void {
    session.peer.sendPacket(
      0,
      makeVariantPacket([fnName, ...args], session.netId),
      true,
      false
    );
  }
}
