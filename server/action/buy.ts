import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnSetBux } from "../onVariant";
import { makeVariantPacket } from "../proton/packet";
import { STORE_CATALOG, backpackPrice } from "../database/store-catalog";
import { handleStore } from "./store";

export function handleBuy(ctx: ServerContext, session: PlayerSession, itemIdOrKey: string | number): void {
  const key = String(itemIdOrKey).trim();
  if (["main","locks","bigitems","weather"].includes(key.replace(/_menu$/, ""))) { handleStore(ctx, session, key); return; }
  const result = (message: string): void => { session.peer.sendPacket(0, makeVariantPacket(["OnStorePurchaseResult", message]), true); };
  const product = STORE_CATALOG.find(p => p.key === key);
  if (!product || product.items.some(([id]) => id === 6 || !ctx.itemsDb.get(id))) { result("This product is unavailable."); return; }
  const a = session.account, upgrade = key === "upgrade_backpack";
  if (upgrade && a.backpackSize >= 396) { result("Your backpack is already at maximum capacity."); return; }
  const price = upgrade ? backpackPrice(a.backpackSize) : product.price;
  if (!Number.isSafeInteger(a.gems) || a.gems < price) { result(`You need ${price} Gems for this product.`); return; }
  // Stage the whole purchase before charging or granting anything.
  const inventory = a.inventory.map(s=>({...s}));
  for (const [id, count] of product.items) {
    let slot = inventory.find(s=>s.itemId===id);
    if (slot ? slot.count + count > 200 : inventory.length >= a.backpackSize) { result("Not enough inventory space for the entire purchase."); return; }
    if (slot) slot.count += count; else inventory.push({itemId:id,count,equipped:false});
  }
  const before = {inventory:a.inventory,gems:a.gems,backpackSize:a.backpackSize};
  a.inventory = inventory; a.gems -= price;
  if (upgrade) a.backpackSize = Math.min(396,a.backpackSize+10);
  try { ctx.savePlayersNow(); } catch { Object.assign(a,before); result("Purchase was not completed: storage error."); return; }
  ctx.sendInventory(session,true); OnSetBux(session);
  result(`Purchased ${product.name} for ${price} Gems.`);
}
