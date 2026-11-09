import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { makeVariantPacket } from "../proton/packet";
import { STORE_CATALOG, backpackPrice } from "../database/store-catalog";

export function handleStore(ctx: ServerContext, session: PlayerSession, requestedTab = "main"): void {
  const tab = requestedTab.replace(/_menu$/, "");
  const tabs: Array<[string,string,number]> = [["main","Home",0],["locks","Locks And Stuff",1],["bigitems","Awesome Items",4],["weather","Weather Machines",5]];
  const active = tabs.some(t => t[0] === tab) ? tab : "main";
  let ui = "set_description_text|Welcome to the Store! Select an item for details. Purchases use in-game Gems only.\nenable_tabs|1\n";
  for (const [key,label,icon] of tabs)
    ui += `add_tab_button|${key}_menu|${label}|interface/large/btn_shop.rttex||${active === key ? 1 : 0}|${icon}|0|0||||-1|-1|||0|0|CustomParams:|\n`;
  for (const product of STORE_CATALOG) {
    if (active !== "main" && product.tab !== active) continue;
    if (product.items.some(([id]) => !ctx.itemsDb.get(id))) continue;
    if (product.key === "upgrade_backpack" && session.account.backpackSize >= 396) continue;
    const price = product.key === "upgrade_backpack" ? backpackPrice(session.account.backpackSize) : product.price;
    const description = product.key === "upgrade_backpack" ? "Adds 10 inventory slots. Maximum 396 slots." : product.items.map(([id,n])=>`${n} x ${ctx.itemsDb.get(id)!.name}`).join(", ");
    ui += `add_button|${product.key}|${product.name}|${product.texture}|${description}|${product.x}|${product.y}|${price}|0|||-1|-1||-1|-1||1||||||0|0|CustomParams:|\n`;
  }
  session.peer.sendPacket(0, makeVariantPacket(["OnStoreRequest", ui]), true);
}
