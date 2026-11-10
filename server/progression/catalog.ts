/** Classic thresholds: https://growtopia.fandom.com/wiki/Achievements
 * Only goals with authoritative event hooks are published here. No fake completed
 * surgery/fishing/guild goals, and no speculative XP/item rewards.
 */
export interface Achievement { id: string; title: string; metric: string; target: number; division: string; }
const groups: Array<[string, number[], string[]]> = [
 ['blocks_placed', [100,1000,100000], ['Builder','Pro Builder','Expert Builder']],
 ['trees_harvested', [100,1000,100000], ['Farmer','Farmer In The Dell','Farmasaurus Rex']],
 ['blocks_broken', [100,1000,100000], ['Demolition','Wrecking Crew','Annihilator']],
 ['gems_held', [1000,25000,500000], ['Packrat','Hoarder','Filthy Rich']],
 ['gems_spent', [10000,100000,1000000], ['Big Spender',"Ol' Moneybags",'One MEEELlion']],
 ['items_trashed', [5000,50000,500000], ['Trashman',"Givin' A Hoot",'OCD']],
 ['consumables_used', [100,1000,25000], ['Paint The Town Blue','Splat!','Mad Vandal']],
 ['backpack', [26,86,196], ['Embiggened','Space Commander','Master Of Space And Time']],
 ['level', [10,50,99], ['Ding!','Long Time Fan','Obsessive Growtopian']],
 ['other_players', [20,50,70], ['Social Butterfly','Social Monarch','Kevin Bacon']],
];
export const ACHIEVEMENTS: Achievement[] = groups.flatMap(([metric, targets, titles]) =>
 targets.map((target, i) => ({id: `${metric}_${i+1}`, metric, target, title: titles[i], division: ['Bronze','Silver','Gold'][i]})));
ACHIEVEMENTS.push(
 {id:'lock_used',title:'Mine, All Mine',metric:'locks_used',target:1,division:'Bronze'},
 {id:'world_lock_used',title:'This Land Is My Land',metric:'world_locks_used',target:1,division:'Gold'},
 {id:'supporter',title:'Supporter',metric:'supporter',target:1,division:'Gold'},
);
