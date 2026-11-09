import fs from "node:fs";
import path from "node:path";
import type { PlayerAccount } from "../database/peer";
import { isRank, type RankId } from "./definitions";
export class RankService {
  private readonly assignments = new Map<number,RankId>();
  constructor(root: string) {
    const file = path.join(root,"data_store","ranks.json");
    if (fs.existsSync(file)) {
      const config = JSON.parse(fs.readFileSync(file,"utf8"));
      if (config.schemaVersion !== 1 || !config.assignments || typeof config.assignments !== "object" || Array.isArray(config.assignments)) throw new Error("Invalid ranks.json");
      for (const [key,rank] of Object.entries(config.assignments)) {
        if (!/^[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(Number(key)) || !isRank(rank)) throw new Error("Invalid rank assignment");
        this.assignments.set(Number(key),rank);
      }
    }
    for (const [variable,rank] of [["MODERATOR_USER_IDS","moderator"],["ADMIN_USER_IDS","developer"],["DEVELOPER_USER_IDS","developer"]] as const) {
      for (const key of (process.env[variable] || "").split(",").map(s=>s.trim()).filter(Boolean)) {
        if (!/^[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(Number(key))) throw new Error(`Invalid ${variable}`);
        this.assignments.set(Number(key),rank);
      }
    }
  }
  apply(account: PlayerAccount): void {
    account.rank = account.isGuest ? "player" : this.assignments.get(account.userId) || "player";
    account.moderator = account.rank !== "player"; // Legacy compatibility, never a source of authority.
  }
}
