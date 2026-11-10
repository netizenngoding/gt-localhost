import { STORE_CATALOG } from '../database/store-catalog';
export function recycleValue(itemId: number, amount: number): number {
 const prices=STORE_CATALOG.filter(p=>p.items.length===1 && p.items[0][0]===itemId && p.items[0][1]>0).map(p=>p.price/p.items[0][1]);
 // Wiki Recycle Tool: store items return 10% purchase price. Other item drop
 // gem distributions are not available in this baseline; do not invent them.
 return prices.length ? Math.floor(Math.min(...prices)/10)*amount : 0;
}
