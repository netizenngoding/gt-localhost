// EXIT is a navigation sentinel, NEVER a generated world.
// Identity names are corroborated in GTOSLatest handle_world; this is not an exhaustive official list.
export const RESERVED_WORLDS = new Set([
  "EXIT", "ERROR", "ADMIN", "MODERATOR", "SYSTEM", "SETH", "HAMUMU", "RTSOFT", "MIKEHOMMEL",
]);
// These event/quest entry conditions are not implemented locally. Do not generate fake empty event worlds.
export const CLOSED_EVENT_WORLDS = new Set(["GROWGANOTH", "LEGENDARYMOUNTAIN"]);
export function worldDestination(raw: string): {kind:"exit"} | {kind:"world";name:string} | {kind:"invalid";reason:string} {
  const name = String(raw || "").trim().toUpperCase();
  if (!name || name === "EXIT") return {kind:"exit"};
  if (!/^[A-Z0-9]{1,24}$/.test(name)) return {kind:"invalid",reason:"Use 1–24 letters or numbers only for a world name."};
  if (RESERVED_WORLDS.has(name)) return {kind:"invalid",reason:"That world name is reserved to prevent confusion."};
  if (CLOSED_EVENT_WORLDS.has(name)) return {kind:"invalid",reason:"This special world is not open on this server."};
  return {kind:"world",name};
}
export function isPlayableWorldName(name: string): boolean { return worldDestination(name).kind === "world"; }
