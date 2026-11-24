import { OnPlayPositioned } from "../onVariant/OnPlayPositioned";
import { cancelTrade } from '../action/trade';
import { effectiveSkin } from "../playmods/model";
import { expireMods } from "../playmods/service";
import { progression, recordProgress } from "../progression/service";
import {
  buildCharacterStateForSession,
  clearSessionMagplantLink,
  sendPlanterActivated,
} from "./peer";
import { staffInteractionReach } from "../ranks/interaction";
import { displayName, hasPermission } from "../ranks";
import { RankService } from "../ranks/service";
import { canSeePlayer } from "../ranks/visibility";
import { isHiddenStaff } from "../ranks/staff_hidden";
import { worldDestination, isPlayableWorldName } from "./world-policy";
import { PORTRAIT_IDS, normalizePortraitSlots } from "./portrait";
import { RequestWorldSelectMenu } from "../onVariant/RequestWorldSelectMenu";
import fs from "node:fs";
import path from "node:path";
import {
  makeInventoryPacket,
  makeModifyInventoryPacket,
  makeParticleEffectPacket,
  makeSetCharacterStatePacket,
  makeVariantPacket,
  makeWorldMapPacket,
  TILE_FLAG_OPEN,
} from "../proton/packet";
import {
  broadcastConsoleMessage,
  broadcastOnRemove,
  broadcastPositionedSfx,
  broadcastSetClothing,
  broadcastSetPos,
  buildSetClothingPacket,
  OnBillboardChange,
  broadcastBillboardChange,
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
  logCctvEvent,
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
    this.dataStoreDir = process.env.DATA_STORE_DIR
      ? path.resolve(process.env.DATA_STORE_DIR)
      : path.join(rootDir, "data_store");
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
              // Migrate paintings saved before the portrait hat/hair slots were split:
              // headwear used to sit in the tinted c_hair field and inherited Hair Dye.
              if (tile.fg && PORTRAIT_IDS.has(tile.fg) && tile.extra?.kind === "portrait") {
                if (normalizePortraitSlots(this.itemsDb, tile.extra)) this.dirty = true;
              }
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

  private atomicWriteJson(targetFile: string, payload: unknown): void {
    const tmp = `${targetFile}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(payload)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      if (fs.existsSync(targetFile)) fs.copyFileSync(targetFile, targetFile + ".bak");
    } catch {
      // Transient .bak file lock on Windows must not abort primary state persistence.
    }
    fs.renameSync(tmp, targetFile);
  }

  public savePlayersNow(): void {
    try {
      const sanitized = Array.from(this.accounts.values()).map((acc) => ({
        ...acc,
        inventory: acc.inventory.filter((s) => s.itemId !== 5640),
      }));
      this.atomicWriteJson(this.playersFile, sanitized);
    } catch (err) {
      this.dirty = true;
      throw new Error("Player save failed; mutation was not acknowledged", { cause: err });
    }
  }

  public savePersistentState(): void {
    this.savePlayersNow();
    try {
      this.atomicWriteJson(
        this.worldsFile,
        Array.from(this.worlds.values()).map((w) => serializeWorldForDisk(w))
      );
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
    const sessions = [...this.sessions];
    const exact = sessions.find(s => s.account.name.toLowerCase() === q);
    if (exact) return exact;
    // Only a unique prefix may resolve: never guess between similarly named players.
    const matches = sessions.filter(s => s.account.name.toLowerCase().startsWith(q));
    return matches.length === 1 ? matches[0] : undefined;
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
    if (!session.world) {
      session.account.inventory = session.account.inventory.filter((s) => s.itemId !== 5640);
    }
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

  private buildRiftPackets(session: PlayerSession): Buffer[] {
    const equipped = new Set(
      session.account.inventory.filter((i) => i.equipped && i.count > 0).map((i) => i.itemId)
    );
    const packets: Buffer[] = [];
    if (equipped.has(10424)) {
      // Upstream fid 4581 / fid 4389 / fid 4390: 6-arg OnRiftCape
      // 0x0033 = drawCollar (bits 0,1) + capeMovement (bits 4,5); closedCape=0 (no torso overlap), aura=0 (no giant orb), cycle=0
      packets.push(
        makeVariantPacket(
          [
            "OnRiftCape",
            { type: "u32", value: 0x0033 },
            { type: "u32", value: 0xe258eaff },
            { type: "u32", value: 0xe258eaff },
            { type: "u32", value: 0x7e3182ff },
            { type: "u32", value: 0x7e3182ff },
            { type: "i32", value: 10 },
          ],
          session.netId
        )
      );
    }
    if (equipped.has(11478)) {
      // Upstream fid 4580 / fid 2534 / fid 4388: 6-arg OnRiftWings
      // 0x55f0 = style 0 (Angel/Rift Feathers) on BOTH state0 (bit12) & state1 (bit14), trail 0 on BOTH (bits 8,10),
      // aura+trail enabled (bits 4..7), cycleTime=0 (bit16=0 so wings never switch to unconfigured/invisible state1)
      packets.push(
        makeVariantPacket(
          [
            "OnRiftWings",
            { type: "u32", value: 0x55f0 },
            { type: "u32", value: 0xc8165dff },
            { type: "u32", value: 0x2b1e89ff },
            { type: "u32", value: 0xff48dcff },
            { type: "u32", value: 0x3f2322ff },
            { type: "u32", value: 15 },
          ],
          session.netId
        )
      );
    }
    if (equipped.has(14086)) {
      packets.push(makeVariantPacket(["OnInfinityAura", { type: "i32", value: 1 }], session.netId));
    }
    return packets;
  }

  public sendCharacterState(session: PlayerSession): void {
    const state = buildCharacterStateForSession(session, this.itemsDb);
    const pkt = makeSetCharacterStatePacket(state);
    const riftPkts = this.buildRiftPackets(session);
    session.peer.sendPacket(0, pkt, true);
    for (const rp of riftPkts) session.peer.sendPacket(0, rp, true);
    if (session.world) {
      for (const other of session.world.peers) {
        if (other !== session && canSeePlayer(other, session)) {
          other.peer.sendPacket(0, pkt, true);
          for (const rp of riftPkts) other.peer.sendPacket(0, rp, true);
        }
      }
    }
  }

  public syncWorldPeersForJoiner(session: PlayerSession): void {
    const world = session.world;
    if (!world) return;
    for (const other of world.peers) {
      if (other === session) continue;
      if (!canSeePlayer(session, other)) continue;
      OnSpawn(session, other, false);
      session.peer.sendPacket(0, makeSetCharacterStatePacket(buildCharacterStateForSession(other, this.itemsDb)), true);
      session.peer.sendPacket(0, buildSetClothingPacket(other, this.itemsDb, false), true);
      session.peer.sendPacket(
        0,
        makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(other.account, !!other.invis) >>> 0 }], other.netId),
        true
      );
      for (const rp of this.buildRiftPackets(other)) {
        session.peer.sendPacket(0, rp, true);
      }
      if (other.lastIconStatePacket) {
        session.peer.sendPacket(0, other.lastIconStatePacket, true);
      }
      // The caller broadcasts the joiner's outfit once after all spawns are sent.
    }
    for (const other of world.peers) {
      if (other === session) continue;
      if (!canSeePlayer(other, session)) continue;
      OnSpawn(other, session, false);
      other.peer.sendPacket(0, makeSetCharacterStatePacket(buildCharacterStateForSession(session, this.itemsDb)), true);
    }
    // The joiner's own "entered" broadcast is sent once by enterWorldAtPixel
    // (it also respects announceEntry). Only show the other players here.
    for (const other of world.peers) {
      if (other === session) continue;
      if (!canSeePlayer(session, other)) continue;
      OnTalkBubble(session, other.netId, displayName(other), 1);
    }
  }

  private schedulePostSpawnSkinSync(session: PlayerSession, expectedWorld: WorldInstance, expectedNetId: number): void {
    const skinU32 = effectiveSkin(session.account, !!session.invis) >>> 0;
    const skinPkt = makeVariantPacket(["OnChangeSkin", { type: "u32", value: skinU32 }], expectedNetId);
    session.peer.sendPacket(0, skinPkt, true);
    const stillJoined = () => session.world === expectedWorld && session.netId === expectedNetId && this.sessions.has(session);
    const synchronizeRemoteOutfits = () => {
      if (!stillJoined()) return;
      const joinerRifts = this.buildRiftPackets(session);
      for (const p of expectedWorld.peers) {
        if (p === session || p.world !== expectedWorld || !this.sessions.has(p)) continue;
        // Each send uses current equipment. Never reset anyone else's inventory.
        p.peer.sendPacket(0, buildSetClothingPacket(session, this.itemsDb, false), true);
        for (const rp of joinerRifts) p.peer.sendPacket(0, rp, true);
        session.peer.sendPacket(0, buildSetClothingPacket(p, this.itemsDb, false), true);
        session.peer.sendPacket(0, makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(p.account, !!p.invis) >>> 0 }], p.netId), true);
        for (const rp of this.buildRiftPackets(p)) session.peer.sendPacket(0, rp, true);
      }
    };
    const first = setTimeout(() => {
      if (!stillJoined()) return;
      // The local inventory packet clears equipped bits; immediately restore.
      this.sendInventory(session, true);
      this.sendCharacterState(session);
      const refreshPkt = makeVariantPacket(["OnChangeSkin", { type: "u32", value: effectiveSkin(session.account, !!session.invis) >>> 0 }], expectedNetId);
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
    if (!hasPermission(session.account,"moderate") && (world.worldBans?.[String(session.account.userId)] || 0) > Date.now()) {
      OnConsoleMessage(session, `You are temporarily banned from ${world.name}.`);
      session.peer.sendPacket(0, makeVariantPacket(["OnFailedToEnterWorld"]), true); return;
    }
    const minLevel = world.entryLevel ?? 1;
    if (
      minLevel > 1 &&
      world.ownerUserId !== session.account.userId &&
      !hasPermission(session.account, "moderate") &&
      progression(session.account).level < minLevel
    ) {
      OnConsoleMessage(session, `\`4You need to be at least Level ${minLevel} to enter ${world.name}!\`\``);
      session.peer.sendPacket(0, makeVariantPacket(["OnFailedToEnterWorld"]), true); return;
    }
    this.leaveCurrentWorld(session, false);
    const spawn = this.findMainDoorPixel(world);
    this.enterWorldAtPixel(session, world, spawn.x, spawn.y, "audio/door_open.wav", true);
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
    session.hp = 100;
    session.lastHazardHitAt = 0;
    session.lastHazardRegenAt = 0;
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
    if (session.account.billboard?.show && session.account.billboard.itemId) {
      broadcastBillboardChange(world, session);
    }
    for (const p of world.peers) {
      if (p !== session && p.account.billboard?.show && p.account.billboard.itemId) {
        OnBillboardChange(session, p);
      }
    }
    logCctvEvent(world, session, "entered");
    // Play the entry door sound at the joiner's avatar for everyone (incl.
    // self). A short delay lets the client finish OnSpawn so netId resolves.
    if (!session.invis) broadcastPositionedSfx(world, session.netId, entrySfx, 250);
    for (const peer of world.peers) recordProgress(this, peer, undefined, 0);

    if (announceEntry && !isHiddenStaff(session) && !session.invis) {
      const owner = world.ownerUserId ? this.findAccountByUserId(world.ownerUserId) : undefined;
      const worldMods: string[] = [];
      let hasJam226 = false;
      let hasJam1276 = false;
      let hasJam1278 = false;
      let hasJam4884 = false;
      let hasJam4992 = false;
      for (const t of world.tiles) {
        if ((t.flags & TILE_FLAG_OPEN) === 0) continue;
        if (t.fg === 226) hasJam226 = true;
        else if (t.fg === 1276) hasJam1276 = true;
        else if (t.fg === 1278) hasJam1278 = true;
        else if (t.fg === 4884) hasJam4884 = true;
        else if (t.fg === 4992) hasJam4992 = true;
      }
      if (hasJam226) worldMods.push("`4JAMMED``");
      if (hasJam1276) worldMods.push("`2NOPUNCH``");
      if (hasJam1278) worldMods.push("`2IMMUNE``");
      if (hasJam4884) worldMods.push("`2NOWAR``");
      if (hasJam4992) worldMods.push("`2ANTIGRAVITY``");
      if (world.disableMusicBlocks) worldMods.push("`6NOMUSIC``");
      if (world.royalSilence) worldMods.push("`6SILENCED``");
      if (world.royalRainbows) worldMods.push("`6RAINBOWS``");
      if (world.entryLevel && world.entryLevel > 0) worldMods.push(`\`2LVL ${world.entryLevel}\`\``);
      if (world.worldCategory) worldMods.push(`\`6${world.worldCategory}\`\``);

      const modsText = worldMods.length > 0 ? `\`0[\`\`${worldMods.join(", ")}\`0]\`\` ` : "";
      const otherCount = world.peers.size - 1;
      OnConsoleMessage(
        session,
        `World \`w${world.name}\`\` ${modsText}entered.  There are \`w${otherCount}\`\` other people here, \`w${this.sessions.size}\`\` online.`
      );

      if (world.xenonite?.enabled) {
        const x = world.xenonite;
        const xText =
          "Xenonite has changed everyone's powers!" +
          (x.doubleJump === 1 ? " `2Double Jump granted!``" : x.doubleJump === 2 ? " `6Double Jump blocked!``" : "") +
          (x.highJump === 1 ? " `2High Jump granted!``" : x.highJump === 2 ? " `6High Jump blocked!``" : "") +
          (x.heatResist === 1 ? " `2Heat Resist granted!``" : "") +
          (x.strongPunch === 1 ? " `2Strong Punch granted!``" : x.strongPunch === 2 ? " `6Strong Punch blocked!``" : "") +
          (x.speedy === 1 ? " `2Super Speed granted!``" : x.speedy === 2 ? " `6Super Speed blocked!``" : "") +
          (x.longPunch === 1 ? " `2Long Punch granted!``" : x.longPunch === 2 ? " `6Long Punch blocked!``" : "") +
          (x.longBuild === 1 ? " `2Long Build granted!``" : x.longBuild === 2 ? " `6Long Build blocked!``" : "");
        OnConsoleMessage(session, xText);
        OnTalkBubble(session, session.netId, xText, 0, true);
      }

      if (owner) {
        OnConsoleMessage(session, `[\`w${world.name}\`\` World Locked by \`2${owner.name}\`\`]`);
      }

      const enterMsg = `\`5<\`w${session.account.name}\`\` entered, \`w${otherCount}\`\` others here>\`\``;
      for (const peer of world.peers) {
        if (peer !== session) {
          if (otherCount >= 1 && otherCount <= 14) {
            OnTalkBubble(peer, session.netId, enterMsg, 1, false);
          }
          OnConsoleMessage(peer, enterMsg);
        }
      }

      if (session.account.inventory.some((s) => s.itemId === 5640 && s.count > 0)) {
        const worldKey = world.name.toUpperCase();
        const saved = session.account.magplantLinks?.[worldKey];
        let targetRemote: { x: number; y: number; itemId: number } | null = null;
        if (saved && saved.x >= 0 && saved.x < world.width && saved.y >= 0 && saved.y < world.height) {
          const st = world.tiles[saved.y * world.width + saved.x];
          if (st?.fg === 5638 && st.extra?.kind === "sucker" && st.extra.itemId > 0) {
            targetRemote = { x: saved.x, y: saved.y, itemId: st.extra.itemId };
          }
        }
        if (!targetRemote) {
          let fallbackActive: { x: number; y: number; itemId: number } | null = null;
          for (let ty = 0; ty < world.height; ty++) {
            for (let tx = 0; tx < world.width; tx++) {
              const mt = world.tiles[ty * world.width + tx];
              if (mt.fg === 5638 && mt.extra?.kind === "sucker" && mt.extra.itemId > 0 && mt.extra.magnetron) {
                const candidate = { x: tx, y: ty, itemId: mt.extra.itemId };
                if (mt.extra.count > 0) {
                  targetRemote = candidate;
                  break;
                }
                if (!fallbackActive) fallbackActive = candidate;
              }
            }
            if (targetRemote) break;
          }
          if (!targetRemote) targetRemote = fallbackActive;
        }
        if (targetRemote) {
          session.magplantRemote = targetRemote;
          const expectedNetId = session.netId;
          const sendPlanterSync = () => {
            if (
              session.world !== world ||
              session.netId !== expectedNetId ||
              !this.sessions.has(session) ||
              !session.magplantRemote
            ) {
              return;
            }
            const { x: rx, y: ry, itemId: rItem } = session.magplantRemote;
            sendPlanterActivated(session, rItem, rx, ry);
          };
          sendPlanterSync();
          // Re-send after OnSpawn finishes creating the local NetAvatar in client memory.
          for (const delay of [200, 800]) {
            const timer = setTimeout(sendPlanterSync, delay);
            if (timer.unref) timer.unref();
          }
        }
      }
    }
  }

  public leaveCurrentWorld(session: PlayerSession, notifySelf: boolean): void {
    cancelTrade(session, "Trade cancelled: player left the world.");
    const world = session.world;
    if (!world) return;
    logCctvEvent(world, session, "left");
    // Door shut plays at the leaver's avatar for everyone still in the world.
    broadcastPositionedSfx(world, session.netId, "audio/door_shut.wav");
    session.pullGeneration=(session.pullGeneration||0)+1; session.pullUntil=0; session.pullImmuneUntil=0;
    session.brb = false;
    session.iconState = 0;
    session.lastIconStatePacket = undefined;
    if (session.magplantRemote) {
      clearSessionMagplantLink(session, undefined, false);
    }
    // Magplant 5000 Remote (5640) is a temporary per-world item: remove it whenever leaving a world.
    let removedRemote = 0;
    for (let i = session.account.inventory.length - 1; i >= 0; i--) {
      if (session.account.inventory[i].itemId === 5640) {
        removedRemote += session.account.inventory[i].count;
        session.account.inventory.splice(i, 1);
      }
    }
    if (removedRemote > 0) {
      this.dirty = true;
      session.peer.sendPacket(0, makeModifyInventoryPacket(5640, 0, removedRemote), true);
    }
    world.peers.delete(session);
    session.world = null;
    broadcastOnRemove(world, session);
    for (const other of world.peers) {
      if (!canSeePlayer(other, session)) continue;
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
    cancelTrade(session);
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
    session.hp = 100;
    session.lastHazardHitAt = 0;
    session.lastHazardRegenAt = 0;
    session.respawnUntil = Date.now() + 1000;
    const generation = session.respawnGeneration = (session.respawnGeneration || 0) + 1;
    const valid = () => session.world === world && session.netId === netId && session.respawnGeneration === generation && this.sessions.has(session);
    session.peer.sendPacket(0, makeVariantPacket(["OnSetFreezeState", {type:"i32",value:2}], netId), true);
    const respawnPos = makeVariantPacket(["SetRespawnPos", {type:"i32",value:Math.floor(spawn.y / 32) * world.width + Math.floor(spawn.x / 32)}], netId);
    session.peer.sendPacket(0, respawnPos, true);
    // AstroVerse does not print a spike message and only sends OnKilled for a
    // regular death (respawn_spike passes kill=false). The position goes to the
    // dying peer; the teleport sound is broadcast to everyone in the world.
    if (!isSpike) session.peer.sendPacket(0, makeVariantPacket(["OnKilled"], netId), true);
    session.peer.sendPacket(0, makeVariantPacket(["OnSetPos", {type:"vec2", x:spawn.x, y:spawn.y}], netId, 2000), true);
    const pearl = makeVariantPacket(["OnSetPearl", {type:"i32", value:100}], netId, 2000);
    session.peer.sendPacket(0, pearl, true);
    for (const p of world.peers) p.peer.sendPacket(0, makeVariantPacket(["OnPlayPositioned", "audio/teleport.wav"], netId, 2020), true);
    session.peer.sendPacket(0, makeVariantPacket(["OnSetFreezeState", {type:"i32",value:0}], netId, 2000), true);
    setTimeout(() => {
      if (valid() && session.respawnUntil) session.respawnUntil = 0;
    }, 1000).unref();
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
