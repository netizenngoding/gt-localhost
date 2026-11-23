/**
 * Colours of the 30 `Ancestral *` artefacts (clothing slot 9, `actionType === 107`).
 *
 * An artefact record carries no colours - its seed block is all `ff`. The colours
 * live in the paired *Seed* record (`artefactId + 1`), inside the same 24-byte
 * block the item parser reads `seedColor` / `ing1` / `ing2` from:
 *
 *   block+00  count[3]            e.g. `0c 08 04` for the Tesseract seed
 *   block+04  <color1 r,g,b> ff   first RGB triplet, alpha byte `ff`
 *   block+08  <color2 r,g,b> 00   second RGB triplet
 *
 * `color1` is also the value that slot is documented as in the public wiki tables
 * (Tesseract `#C59355FF`, Orb of Time `#C334EAFF`); `color2` is the colour the
 * *effect* renders with (Tesseract cyan `#67D6E9`, Seed of Life green `#76FF64`).
 *
 * Two bugs this file removes:
 *
 *  1. Byte order. Colours are stored as big-endian RGB. Reading the block with
 *     `readUInt32LE(block + 4)` reverses the bytes (`0x5593C5FF` instead of
 *     `0xFFC59355` for the Tesseract), which swaps red and blue for every seed
 *     colour, including the ancestral ones. `seedColor` is now read as
 *     `0xFFRRGGBB`.
 *  2. Slot choice. Anything that tints an ancestral effect from `seedColor`
 *     (= `color1`) paints the Tesseract tan/khaki, the Seed of Life near-black and
 *     the Totem dark brown. Measured against the reference captures, the orbiting
 *     Tesseract renders cyan `color2` (#67D6E9 - 18%/12% of bright pixels in a
 *     140-frame capture, and `#60f0f0`/`#78f0f0` in the level-5 ball capture), so
 *     `color2` is the documented default for `ancestralEffectColour()`. Note the
 *     one counter-measurement on record: the Orb of Time foot plumes read magenta
 *     `color1` (`#f078f0`/`#f090f0`) in the wiki GIF. Treat which triplet a given
 *     particle uses as per-renderer behaviour, not a constant of the format; both
 *     triplets are exposed so a caller never has to guess or reuse `seedColor`.
 *
 * Every row below was extracted from this repository's own item database and is
 * re-checked at boot against the parsed records; `npm run verify:ances` prints the
 * comparison. Do not edit a row by eye - the byte offsets above are the authority.
 */

/** Verified colours of one ancestral artefact, read from its seed record. */
export interface AncestralColours {
  /** Artefact item id (the equipable block, `actionType === 107`). */
  readonly itemId: number;
  /** Seed record the colours were read from (`itemId + 1`). */
  readonly seedItemId: number;
  /** Family display name without the `Ancestral ` prefix, e.g. "Orb of Time". */
  readonly family: string;
  /** 1..6, from the artefact name. */
  readonly level: number;
  /** Seed block +4, 0xFFRRGGBB. Same value the parser exposes as `seedColor`. */
  readonly color1: number;
  /** Seed block +8, 0xFFRRGGBB. The colour the artefact's effect renders with. */
  readonly color2: number;
  /** What the old little-endian read returned (`color1` with red and blue swapped). */
  readonly legacySeedColor: number;
}

/** key = artefact item id. */
export const ANCESTRAL_COLOURS: Readonly<Record<number, Omit<AncestralColours, "itemId">>> = {
  5078: { seedItemId: 5079, family: "Totem of Wisdom", level: 1, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5080: { seedItemId: 5081, family: "Tesseract of Dimensions", level: 1, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5082: { seedItemId: 5083, family: "Seed of Life", level: 1, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5084: { seedItemId: 5085, family: "Lens of Riches", level: 1, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  5126: { seedItemId: 5127, family: "Totem of Wisdom", level: 2, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5128: { seedItemId: 5129, family: "Totem of Wisdom", level: 3, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5130: { seedItemId: 5131, family: "Totem of Wisdom", level: 4, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5132: { seedItemId: 5133, family: "Totem of Wisdom", level: 5, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5134: { seedItemId: 5135, family: "Totem of Wisdom", level: 6, color1: 0xFF884A06, color2: 0xFFF9BF26, legacySeedColor: 0x064A88FF },
  5144: { seedItemId: 5145, family: "Tesseract of Dimensions", level: 2, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5146: { seedItemId: 5147, family: "Tesseract of Dimensions", level: 3, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5148: { seedItemId: 5149, family: "Tesseract of Dimensions", level: 4, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5150: { seedItemId: 5151, family: "Tesseract of Dimensions", level: 5, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5152: { seedItemId: 5153, family: "Tesseract of Dimensions", level: 6, color1: 0xFFC59355, color2: 0xFF67D6E9, legacySeedColor: 0x5593C5FF },
  5162: { seedItemId: 5163, family: "Seed of Life", level: 2, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5164: { seedItemId: 5165, family: "Seed of Life", level: 3, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5166: { seedItemId: 5167, family: "Seed of Life", level: 4, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5168: { seedItemId: 5169, family: "Seed of Life", level: 5, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5170: { seedItemId: 5171, family: "Seed of Life", level: 6, color1: 0xFF05171A, color2: 0xFF76FF64, legacySeedColor: 0x1A1705FF },
  5180: { seedItemId: 5181, family: "Lens of Riches", level: 2, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  5182: { seedItemId: 5183, family: "Lens of Riches", level: 3, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  5184: { seedItemId: 5185, family: "Lens of Riches", level: 4, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  5186: { seedItemId: 5187, family: "Lens of Riches", level: 5, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  5188: { seedItemId: 5189, family: "Lens of Riches", level: 6, color1: 0xFF935630, color2: 0xFFFF0000, legacySeedColor: 0x305693FF },
  7166: { seedItemId: 7167, family: "Orb of Time", level: 1, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
  7168: { seedItemId: 7169, family: "Orb of Time", level: 2, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
  7170: { seedItemId: 7171, family: "Orb of Time", level: 3, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
  7172: { seedItemId: 7173, family: "Orb of Time", level: 4, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
  7174: { seedItemId: 7175, family: "Orb of Time", level: 5, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
  9212: { seedItemId: 9213, family: "Orb of Time", level: 6, color1: 0xFFC334EA, color2: 0xFFC7833B, legacySeedColor: 0xEA34C3FF },
};

function buildIndex(): Map<number, AncestralColours> {
  const map = new Map<number, AncestralColours>();
  for (const key of Object.keys(ANCESTRAL_COLOURS)) {
    const itemId = Number(key);
    map.set(itemId, { itemId, ...ANCESTRAL_COLOURS[itemId]! });
  }
  return map;
}

const INDEX = buildIndex();

/** Verified colour table for `itemId`, or undefined for anything not in the table. */
export function getAncestralColours(itemId: number): AncestralColours | undefined {
  return INDEX.get(itemId);
}

/** The 30 artefact ids, ascending. */
export const ANCESTRAL_ITEM_IDS: readonly number[] = [...INDEX.keys()].sort((a, b) => a - b);

/**
 * Colour an artefact's effect should be tinted with: `color2` from the seed record.
 * Falls back to `fallback` for any other item so callers can stay one-liners.
 */
export function ancestralEffectColour(itemId: number, fallback = 0xffffffff): number {
  return INDEX.get(itemId)?.color2 ?? fallback;
}
