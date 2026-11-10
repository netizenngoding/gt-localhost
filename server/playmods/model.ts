import type { PlayerAccount } from '../database/peer';
/** GTPS3 ae49cffa: standalone effects only. Dependent-system buffs are excluded.
 * Reference table is NOT a claim that every associated gameplay system exists.
 */
export interface ModDefinition {
 id:string; item:number; title:string; seconds:number; flags:number;
 onAdd:string; onRemove:string; icon:number; sound:string; action:string;
 effect:number; text:string; skin?:number; gravity?:number; speed?:number;
}
export const MODS: readonly ModDefinition[] = [
 {
  "id": "stinky",
  "item": 388,
  "title": "Stinky",
  "seconds": 300,
  "flags": 16384,
  "onAdd": "You really really smell.",
  "onRemove": "The air clears.",
  "icon": 372,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-2",
  "item": 1368,
  "title": "Frozen",
  "seconds": 2,
  "flags": 2048,
  "onAdd": "Your body has turned to ice. You can't move!",
  "onRemove": "You've thawed out.",
  "icon": 1368,
  "sound": "freeze.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 4284769380
 },
 {
  "id": "gtps3-4",
  "item": 874,
  "title": "Egged!",
  "seconds": 180,
  "flags": 0,
  "onAdd": "You have egg on your face.",
  "onRemove": "You washed your face!",
  "icon": 874,
  "sound": "",
  "action": "throw",
  "effect": 42,
  "text": "",
  "skin": 16777215
 },
 {
  "id": "envious",
  "item": 540,
  "title": "Envious",
  "seconds": 900,
  "flags": 0,
  "onAdd": "It ain't easy being you.",
  "onRemove": "Healthy color restored.",
  "icon": 540,
  "sound": "eat.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 1627349247
 },
 {
  "id": "blue",
  "item": 196,
  "title": "Feelin' Blue",
  "seconds": 3600,
  "flags": 0,
  "onAdd": "A `!blueberry`` slides down your throat!",
  "onRemove": "The effects of the `!blueberry`` have worn off.",
  "icon": 196,
  "sound": "spray.wav",
  "action": "drop",
  "effect": 0,
  "text": "",
  "skin": 4278190335
 },
 {
  "id": "floating",
  "item": 338,
  "title": "Floating!",
  "seconds": 2,
  "flags": 0,
  "onAdd": "Whoooooooaaaaaaaa...",
  "onRemove": "Gravity - it's the law.",
  "icon": 338,
  "sound": "balloon.wav",
  "action": "drop",
  "effect": 0,
  "text": "",
  "gravity": -30
 },
 {
  "id": "gtps3-19",
  "item": 962,
  "title": "Saucy!",
  "seconds": 180,
  "flags": 0,
  "onAdd": "You are a saucy person.",
  "onRemove": "You got cleaned up.",
  "icon": 962,
  "sound": "",
  "action": "throw",
  "effect": 45,
  "text": "",
  "skin": 2554747
 },
 {
  "id": "halo",
  "item": 128,
  "title": "Golden Halo!",
  "seconds": 1800,
  "flags": 128,
  "onAdd": "You have been good.",
  "onRemove": "You're falling out of favor.",
  "icon": 128,
  "sound": "",
  "action": "drop",
  "effect": 25,
  "text": "",
  "skin": 2190853119
 },
 {
  "id": "gtps3-38",
  "item": 614,
  "title": "Rotten Egg",
  "seconds": 300,
  "flags": 16384,
  "onAdd": "You really really smell.",
  "onRemove": "The air clears.",
  "icon": 614,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-42",
  "item": 4766,
  "title": "Blushing Red",
  "seconds": 1800,
  "flags": 0,
  "onAdd": "`4Cherry`` red lips!",
  "onRemove": "The effects of the `!Cherry`` have worn off.",
  "icon": 4766,
  "sound": "spray.wav",
  "action": "drop",
  "effect": 0,
  "text": "",
  "skin": 842203135
 },
 {
  "id": "gtps3-47",
  "item": 1634,
  "title": "Caffeinated",
  "seconds": 5,
  "flags": 16384,
  "onAdd": "You are full of caffeine!",
  "onRemove": "Ugh. Caffeine crash.",
  "icon": 1634,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "speed": 420
 },
 {
  "id": "gtps3-48",
  "item": 4672,
  "title": "Envious",
  "seconds": 900,
  "flags": 0,
  "onAdd": "It ain't easy being you.",
  "onRemove": "Healthy color restored.",
  "icon": 4672,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 1234743295
 },
 {
  "id": "gtps3-49",
  "item": 6314,
  "title": "Frozen",
  "seconds": 2,
  "flags": 2048,
  "onAdd": "Your body has turned to ice. You can't move!",
  "onRemove": "You've thawed out.",
  "icon": 6314,
  "sound": "freeze.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 4284769380
 },
 {
  "id": "gtps3-50",
  "item": 3064,
  "title": "",
  "seconds": 0,
  "flags": 0,
  "onAdd": "",
  "onRemove": "",
  "icon": 3064,
  "sound": "",
  "action": "throw",
  "effect": 34,
  "text": ""
 },
 {
  "id": "gtps3-67",
  "item": 126,
  "title": "Devil Horns",
  "seconds": 1800,
  "flags": 64,
  "onAdd": "You little devil...",
  "onRemove": "Off the naughty list!",
  "icon": 126,
  "sound": "spray.wav",
  "action": "drop",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-68",
  "item": 1964,
  "title": "Devil Horns",
  "seconds": 1800,
  "flags": 64,
  "onAdd": "You little devil...",
  "onRemove": "Off the naughty list!",
  "icon": 1964,
  "sound": "spray.wav",
  "action": "drop",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-69",
  "item": 960,
  "title": "ON FIRE!!!",
  "seconds": 5,
  "flags": 131072,
  "onAdd": "You are burning up!",
  "onRemove": "The fire's out.",
  "icon": 960,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 842203135
 },
 {
  "id": "gtps3-70",
  "item": 712,
  "title": "ON FIRE!!!",
  "seconds": 5,
  "flags": 131072,
  "onAdd": "You are burning up!",
  "onRemove": "The fire's out.",
  "icon": 712,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 842203135
 },
 {
  "id": "gtps3-71",
  "item": 1988,
  "title": "Haunted!",
  "seconds": 1800,
  "flags": 262144,
  "onAdd": "You are haunted!",
  "onRemove": "Not anymore.",
  "icon": 372,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-72",
  "item": 1772,
  "title": "Floating!",
  "seconds": 2,
  "flags": 0,
  "onAdd": "Whoooooooaaaaaaaa...",
  "onRemove": "Gravity - it's the law.",
  "icon": 1772,
  "sound": "balloon.wav",
  "action": "drop",
  "effect": 0,
  "text": "",
  "gravity": -30
 },
 {
  "id": "gtps3-73",
  "item": 5262,
  "title": "Neon Gum!",
  "seconds": 5,
  "flags": 268435456,
  "onAdd": "Dazzle your friends as super funky neon lines course across your skin.",
  "onRemove": "Party's over.",
  "icon": 5262,
  "sound": "spray.wav",
  "action": "drop",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-89",
  "item": 4602,
  "title": "Stinky",
  "seconds": 300,
  "flags": 16384,
  "onAdd": "You really really smell.",
  "onRemove": "The air clears.",
  "icon": 4602,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-99",
  "item": 8384,
  "title": "Gross Bean",
  "seconds": 10,
  "flags": 16384,
  "onAdd": "You really really smell.",
  "onRemove": "The air clears.",
  "icon": 8384,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": ""
 },
 {
  "id": "gtps3-115",
  "item": 1602,
  "title": "Minty",
  "seconds": 900,
  "flags": 0,
  "onAdd": "Ya'll are feelin' minty, sugah.",
  "onRemove": "Healthy color restored.",
  "icon": 1602,
  "sound": "eat.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "skin": 1627349247
 },
 {
  "id": "gtps3-116",
  "item": 12152,
  "title": "Janeway's Coffee: Speedy",
  "seconds": 600,
  "flags": 16384,
  "onAdd": "On my mark... Go Fast!",
  "onRemove": "Speed normalized!",
  "icon": 12152,
  "sound": "spray.wav",
  "action": "",
  "effect": 0,
  "text": "",
  "speed": 420
 }
];
export const SIMPLE_FOODS: readonly {item:number;text:string}[] = [
 {
  "item": 3404,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3406,
  "text": ":D`#YUM!``"
 },
 {
  "item": 4422,
  "text": ":D`#YUM!``"
 },
 {
  "item": 950,
  "text": ":D`#YUM!``"
 },
 {
  "item": 968,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1058,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1096,
  "text": ":D`#YUM!``"
 },
 {
  "item": 868,
  "text": ":D`#YUM!``"
 },
 {
  "item": 4668,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1094,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1098,
  "text": ":D`#YUM!``"
 },
 {
  "item": 4378,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1374,
  "text": ":D`#YUM!``"
 },
 {
  "item": 966,
  "text": ":D`#YUM!``"
 },
 {
  "item": 958,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1580,
  "text": ":D`#YUM!``"
 },
 {
  "item": 7052,
  "text": ":D`#YUM!``"
 },
 {
  "item": 8520,
  "text": ":D`#YUM!``"
 },
 {
  "item": 10628,
  "text": "/dab"
 },
 {
  "item": 3546,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3600,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3836,
  "text": ":D`#YUM!``"
 },
 {
  "item": 4410,
  "text": ":P`#Bleh.``"
 },
 {
  "item": 3622,
  "text": ":D`#YUM!``"
 },
 {
  "item": 10988,
  "text": ":D`#YUM!``"
 },
 {
  "item": 4764,
  "text": ":D`#YUM!``"
 },
 {
  "item": 964,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3428,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3816,
  "text": ":D`#YUM!``"
 },
 {
  "item": 1208,
  "text": ":D`#YUM!``"
 },
 {
  "item": 3536,
  "text": "Mmm, sugar!"
 },
 {
  "item": 4232,
  "text": "`#:D YUM!``"
 },
 {
  "item": 11068,
  "text": "`#:D Ahhh! That is REFRESHING!``"
 },
 {
  "item": 4984,
  "text": "`#:D YUM!``"
 }
];
export interface TimedMod { id: string; expiresAt: number; }
export function normalizeMods(raw: unknown, now=Date.now()): TimedMod[] {
 if(!Array.isArray(raw))return [];
 const seen=new Set<string>();
 return raw.filter(m=>{
  const def=MODS.find(d=>d.id===m?.id);
  if(!def || seen.has(m.id) || !Number.isSafeInteger(m.expiresAt) || m.expiresAt<=now || m.expiresAt>now+def.seconds*1000) return false;
  seen.add(m.id);return true;
 }).map(m=>({id:m.id,expiresAt:m.expiresAt}));
}
export function activeMods(a: PlayerAccount, now=Date.now()) {
 return (a.playmods || []).filter(m=>m.expiresAt>now).flatMap(m=>{const d=MODS.find(d=>d.id===m.id);return d?[d]:[];});
}
export function effectiveSkin(a: PlayerAccount): number {
 // GTPS3 update_clothes chooses the FIRST active skin override, not latest.
 return activeMods(a).find(d=>d.skin!==undefined)?.skin ?? a.skinColor;
}
