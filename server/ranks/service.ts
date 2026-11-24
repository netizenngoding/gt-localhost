import path from "node:path";
import type { PlayerAccount } from "../database/peer";
import { isRank, type RankId } from "./definitions";
import { assignmentOf, loadRanks, rankExists, saveRanks, setAssignment } from "./registry";

/**
 * Owns rank persistence. Rank definitions and per-user assignments now live in
 * `data_store/ranks.json` (schema 2) and are managed at runtime by the
 * `/createrank`, `/delrank`, `/rankedit`, `/setrank` and `/grole` commands.
 */
export class RankService {
  private readonly rootDir: string;
  constructor(root: string) {
    this.rootDir = root;
    loadRanks(root);
    // Environment overrides still work: MODERATOR_USER_IDS / DEVELOPER_USER_IDS.
    for (const [variable, rank] of [
      ["MODERATOR_USER_IDS", "moderator"],
      ["ADMIN_USER_IDS", "administrator"],
      ["DEVELOPER_USER_IDS", "administrator"],
      ["OWNER_USER_IDS", "owner"],
    ] as const) {
      for (const key of (process.env[variable] || "").split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!/^[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(Number(key))) throw new Error(`Invalid ${variable}`);
        if (!rankExists(rank)) continue;
        setAssignment(Number(key), rank);
      }
    }
    saveRanks();
  }

  /** Applies the stored rank of an account (assignment first, then players.json). */
  apply(account: PlayerAccount): void {
    const assigned = assignmentOf(account.userId);
    const stored = isRank(account.rank) ? (account.rank as RankId) : undefined;
    const chosen = assigned ?? stored ?? "player";
    account.rank = chosen;
    account.moderator = chosen !== "player";
  }

  get dataFile(): string {
    return path.join(this.rootDir, "data_store", "ranks.json");
  }

  save(): void {
    saveRanks();
  }
}
