import type { PlayerAccount } from "../database/peer";
import { hasPermission } from "./index";

// Server policy for the requested MOD/DEV long-punch/build feature, not an item
// effect or a claim about official ranks. Native state bytes encode range + 126
// and the packet encoder caps them at 250, hence at most 124 tiles.
export function staffInteractionReach(account: Pick<PlayerAccount, "rank">): number | null {
  return hasPermission(account, "moderate") ? 124 : null;
}
