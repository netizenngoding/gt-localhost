/** Classic thresholds: https://growtopia.fandom.com/wiki/Achievements
 * Only goals with authoritative event hooks are published here. No fake completed
 * surgery/fishing/guild goals, and no speculative XP/item rewards.
 */
export interface Achievement { id: string; title: string; metric: string; target: number; division: string; classicId: number; }
const groups: Array<[string, number[], string[], number]> = [
 ['blocks_placed', [100,1000,100000], ['Builder','Pro Builder','Expert Builder'], 0],
 ['trees_harvested', [100,1000,100000], ['Farmer','Farmer In The Dell','Farmasaurus Rex'], 3],
 ['blocks_broken', [100,1000,100000], ['Demolition','Wrecking Crew','Annihilator'], 6],
 ['gems_held', [1000,25000,500000], ['Packrat','Hoarder','Filthy Rich'], 9],
 ['gems_spent', [10000,100000,1000000], ['Big Spender',"Ol' Moneybags",'One MEEELlion'], 12],
 ['items_trashed', [5000,50000,500000], ['Trashman',"Givin' A Hoot",'OCD'], 15],
 ['consumables_used', [100,1000,25000], ['Paint The Town Blue','Splat!','Mad Vandal'], 18],
 ['backpack', [26,86,196], ['Embiggened','Space Commander','Master Of Space And Time'], 21],
 ['level', [10,50,99], ['Ding!','Long Time Fan','Obsessive Growtopian'], 27],
 ['other_players', [20,50,70], ['Social Butterfly','Social Monarch','Kevin Bacon'], 31],
];
export const ACHIEVEMENTS: Achievement[] = groups.flatMap(([metric, targets, titles, firstId]) =>
 targets.map((target, i) => ({id: `${metric}_${i+1}`, metric, target, title: titles[i], division: ['Bronze','Silver','Gold'][i], classicId: firstId + i})));
ACHIEVEMENTS.push(
 {id:'lock_used',title:'Mine, All Mine',metric:'locks_used',target:1,division:'Bronze',classicId:24},
 {id:'world_lock_used',title:'This Land Is My Land',metric:'world_locks_used',target:1,division:'Gold',classicId:26},
 {id:'supporter',title:'Supporter',metric:'supporter',target:1,division:'Gold',classicId:30},
);

/** Native amorkolg atlas, 16 columns: classic achievement IDs 0-63 are
 * arranged bottom-to-top in rows of 16. The client also numbers frames
 * bottom-to-top (verified in a live client), so classic IDs are frame IDs.
 */
export function classicAchievementIcon(classicId: number): number {
 if (!Number.isInteger(classicId) || classicId < 0 || classicId > 63) throw new RangeError('Unsupported classic achievement icon');
 return classicId;
}
export function lockedAchievementIcon(division: string): number {
 return ({Bronze:127, Silver:126, Gold:125, Ruby:123, Emerald:122, Sapphire:121} as Record<string,number>)[division] ?? 124;
}

/** Earned-row descriptions from the Growtopia Wiki achievement list. */
const CLASSIC_DESCRIPTIONS: Record<string,string> = {
  "Builder": "Earned for placing 100 blocks of any type.",
  "Pro Builder": "Earned for placing 1,000 blocks of any type.",
  "Expert Builder": "Earned for placing 100,000 blocks of any type.",
  "Farmer": "Earned for harvesting 100 trees.",
  "Farmer In The Dell": "Earned for harvesting 1,000 trees.",
  "Farmasaurus Rex": "Earned for harvesting 100,000 trees.",
  "Demolition": "Earned for smashing 100 blocks.",
  "Wrecking Crew": "Earned for smashing 1,000 blocks.",
  "Annihilator": "Earned for smashing 100,000 blocks.",
  "Packrat": "Earned for holding 1,000 gems.",
  "Hoarder": "Earned for holding 25,000 gems.",
  "Filthy Rich": "Earned for holding 500,000 gems.",
  "Big Spender": "Earned for spending 10,000 gems.",
  "Ol' Moneybags": "Earned for spending 100,000 gems.",
  "One MEEELlion": "Earned for spending 1,000,000 gems.",
  "Trashman": "Earned for disposing of 5,000 items.",
  "Givin' A Hoot": "Earned for disposing of 50,000 items.",
  "OCD": "Earned for disposing of 500,000 items.",
  "Paint The Town Blue": "Earned for using 100 consumable items.",
  "Splat!": "Earned for using 1,000 consumable items.",
  "Mad Vandal": "Earned for using 25,000 consumable items.",
  "Embiggened": "Earned for upgrading backpack size to 26 slots.",
  "Space Commander": "Earned for upgrading backpack size to 86 slots.",
  "Master Of Space And Time": "Earned for upgrading backpack size to 196 slots.",
  "Ding!": "Earned for reaching Player Level 10.",
  "Long Time Fan": "Earned for reaching player level 50.",
  "Obsessive Growtopian": "Earned for reaching player level 99.",
  "Social Butterfly": "Earned for being in a world with 20 other people.",
  "Social Monarch": "Earned for being in a world with 50 other people.",
  "Kevin Bacon": "Earned for being in a world with 70 other people.",
  "Mine, All Mine": "Earned for using a lock.",
  "This Land Is My Land": "Earned for using a World Lock or Signal Jammer.",
  "Supporter": "Earned for supporting the makers of Growtopia."
};
export const achievementTitle = (a: Achievement): string => `${a.title} (Classic)`;
export const achievementDescription = (a: Achievement): string => CLASSIC_DESCRIPTIONS[a.title] || "Achieved!";
