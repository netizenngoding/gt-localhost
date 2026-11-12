/**
 * Reverse engineered GTPS3 / Growtopia Recipes & Tables
 * Source: LyNnz01/GTPS3/SERVER/Base.h
 */

export interface CombinerRecipe {
  ingredients: Array<[itemId: number, count: number]>;
  result: [itemId: number, count: number];
}

// 36 Chemical Combiner & Laboratory recipes from Base.h:60
export const GTPS3_COMBINER_RECIPES: CombinerRecipe[] = [
  { ingredients: [[914, 5], [924, 4], [920, 2]], result: [926, 5] },
  { ingredients: [[914, 6], [924, 3], [918, 4]], result: [1114, 1] },
  { ingredients: [[914, 15], [920, 4], [918, 2]], result: [978, 4] },
  { ingredients: [[917, 10], [924, 3], [918, 3]], result: [772, 1] },
  { ingredients: [[917, 2], [920, 4], [918, 3]], result: [904, 1] },
  { ingredients: [[924, 20], [920, 4], [918, 5]], result: [922, 1] },
  { ingredients: [[914, 20], [916, 10], [922, 1]], result: [1162, 1] },
  { ingredients: [[914, 10], [920, 2], [922, 1]], result: [1746, 5] },
  { ingredients: [[914, 20], [918, 15], [922, 10]], result: [1542, 1] },
  { ingredients: [[916, 8], [924, 4], [922, 1]], result: [2588, 1] },
  { ingredients: [[916, 1], [918, 1], [922, 1]], result: [1866, 10] },
  { ingredients: [[924, 3], [920, 3], [922, 3]], result: [908, 1] },
  { ingredients: [[924, 4], [918, 3], [922, 1]], result: [1310, 1] },
  { ingredients: [[920, 200], [918, 200], [922, 200]], result: [910, 1] },
  { ingredients: [[914, 10], [922, 10], [1962, 10]], result: [4582, 1] },
  { ingredients: [[916, 9], [924, 5], [1962, 1]], result: [4552, 1] },
  { ingredients: [[6970, 50], [7006, 50], [6986, 50]], result: [6948, 1] }, // Heart of Gaia
  { ingredients: [[7156, 20], [6986, 5], [7154, 5]], result: [7150, 1] },
  { ingredients: [[7006, 10], [6970, 5], [6988, 5]], result: [7008, 1] },
  { ingredients: [[6828, 2], [186, 100], [6972, 20]], result: [6934, 1] },
  { ingredients: [[6834, 2], [186, 100], [6960, 2]], result: [6936, 1] },
  { ingredients: [[6250, 2], [186, 100], [6978, 20]], result: [6930, 1] },
  { ingredients: [[6940, 2], [186, 100], [6976, 2]], result: [6944, 1] },
  { ingredients: [[6236, 1], [6962, 1], [6992, 5]], result: [6918, 1] },
  { ingredients: [[6238, 1], [6960, 5], [7012, 1]], result: [6920, 1] },
  { ingredients: [[6988, 100], [7010, 15], [6976, 50]], result: [6946, 1] }, // Unstable Tesseract
  { ingredients: [[6244, 1], [260, 100], [6962, 2]], result: [6928, 1] },
  { ingredients: [[6256, 1], [260, 100], [6994, 10]], result: [6932, 1] },
  { ingredients: [[6238, 1], [260, 100], [6960, 2]], result: [6926, 1] },
  { ingredients: [[7308, 1], [260, 100], [7012, 10]], result: [7306, 1] },
  { ingredients: [[6926, 1], [6972, 1], [7010, 1]], result: [6922, 1] },
  { ingredients: [[6240, 1], [6972, 1], [6992, 10]], result: [6924, 1] },
  { ingredients: [[7158, 20], [7160, 3], [6978, 3]], result: [7152, 1] },
  { ingredients: [[6994, 100], [6978, 100], [6964, 100]], result: [6950, 1] },
  { ingredients: [[6980, 100], [6998, 100], [7016, 100]], result: [6952, 1] },
  { ingredients: [[6984, 75], [7018, 75], [6968, 75]], result: [6954, 1] },
];

// Fishing Loot Table by Bait ID from Base.h:2524-2536
export const GTPS3_FISHING_LOOT: Record<number, number[]> = {
  2914: [846, 344, 8964, 3000, 3000, 3034, 3034, 3038, 3038, 3028, 3012],
  3012: [3000, 3000, 3030, 3030, 3038, 3038, 3036, 3036, 846, 444, 8966, 344, 3028, 3022, 3014, 3000, 3000],
  3014: [3030, 3030, 3026, 3026, 3038, 3038, 3000, 3000, 3032, 3032, 344, 444, 846, 8966, 8964, 3016],
  3016: [846, 3026, 3026, 3038, 3038, 3032, 3032, 3036, 3036, 444, 1522, 8256, 8964, 3184, 1542, 3018],
  3018: [5636, 846, 3036, 3036, 3034, 3034, 3032, 3032, 3024, 846, 3036, 3036, 3034, 3034, 3032, 3032, 3024, 3020],
  3020: [5636, 1542, 3022, 1520, 1522, 3028, 3038, 3038, 3026, 3026, 3030, 3036, 3036, 3030, 7744, 3034],
  5526: [3584, 8254, 5542, 5538, 5620, 5622, 5612, 5526, 5580, 3020, 11734],
  5528: [5636, 3584, 5574, 8968, 5552, 5548, 5618, 5624, 5602, 5528, 5614, 8252, 11052, 5616, 3020],
};

// Geiger Hunting Rewards pool from Source.cpp:287-290
export const GTPS3_GEIGER_REWARDS = [
  6416, 3196, 2206, 1500, 1498, 2806, 2804, 8270, 8272, 8274,
  2244, 2246, 2242, 3792, 3306, 4676, 4678, 4680, 4682, 4652,
  4650, 4648, 4646, 11186, 10086,
];

export function findCombinerRecipe(
  drops: Array<{ itemId: number; count: number }>
): CombinerRecipe | null {
  if (drops.length !== 3) return null;
  const dropMap = new Map<number, number>();
  for (const d of drops) {
    dropMap.set(d.itemId, (dropMap.get(d.itemId) || 0) + d.count);
  }

  for (const recipe of GTPS3_COMBINER_RECIPES) {
    let matches = true;
    for (const [ingId, reqCount] of recipe.ingredients) {
      const avail = dropMap.get(ingId) || 0;
      if (avail < reqCount) {
        matches = false;
        break;
      }
    }
    if (matches && recipe.ingredients.length === drops.length) {
      return recipe;
    }
  }
  return null;
}

export interface CrystalRecipe {
  requirements: Record<number, number>; // itemId (2242..2250) -> count
  result: [itemId: number, count: number];
}

// 44 Crystal Shattering recipes from GTPS3 Base.h:15-59
const CRYSTAL_RAW: Array<[number, number, number, number, number, number, number]> = [
  [2, 0, 0, 3, 0, 2254, 1],
  [1, 1, 0, 3, 0, 2262, 1],
  [2, 3, 0, 0, 0, 2942, 1],
  [0, 0, 2, 3, 0, 2258, 1],
  [0, 1, 1, 3, 0, 2264, 1],
  [0, 3, 2, 0, 0, 2944, 1],
  [0, 2, 0, 3, 0, 2256, 1],
  [1, 0, 1, 3, 0, 2260, 1],
  [3, 0, 2, 0, 0, 2940, 1],
  [0, 0, 0, 0, 5, 2212, 1],
  [2, 0, 2, 1, 0, 2972, 1],
  [2, 1, 2, 0, 0, 2268, 1],
  [0, 2, 0, 1, 2, 2266, 1],
  [2, 0, 0, 0, 3, 2754, 1],
  [1, 0, 0, 3, 1, 2756, 1],
  [0, 3, 0, 2, 0, 2706, 1],
  [1, 1, 1, 0, 2, 3180, 1],
  [0, 0, 0, 2, 3, 4124, 1],
  [3, 0, 0, 2, 0, 5268, 1],
  [3, 1, 0, 1, 0, 5266, 1],
  [0, 0, 0, 1, 4, 6848, 1],
  [0, 0, 3, 2, 0, 6820, 1],
  [0, 2, 3, 0, 0, 2272, 3],
  [2, 0, 3, 0, 0, 2276, 5],
  [0, 2, 1, 2, 0, 2252, 1],
  [3, 0, 1, 1, 0, 2274, 1],
  [1, 2, 2, 0, 0, 2270, 10],
  [2, 1, 1, 1, 0, 2590, 5],
  [2, 1, 1, 1, 0, 2812, 1],
  [2, 2, 0, 1, 0, 3424, 1],
  [2, 2, 1, 0, 0, 3770, 3],
  [3, 2, 0, 0, 0, 3526, 20],
  [2, 2, 0, 0, 1, 3582, 1],
  [2, 0, 2, 0, 1, 4762, 1],
  [2, 1, 0, 2, 0, 5204, 1],
  [1, 0, 2, 2, 0, 5106, 1],
  [1, 1, 1, 2, 0, 5104, 1],
  [1, 2, 1, 1, 0, 5272, 10],
  [1, 3, 1, 0, 1, 5274, 1],
  [1, 1, 1, 3, 0, 5270, 1],
  [1, 3, 1, 0, 0, 5280, 10],
  [3, 0, 0, 1, 1, 392, 1],
  [4, 0, 4, 5, 5, 12304, 1],
];

export const GTPS3_CRYSTAL_RECIPES: CrystalRecipe[] = CRYSTAL_RAW.map(([r, g, b, w, bk, resId, resCnt]) => ({
  requirements: { 2242: r, 2244: g, 2246: b, 2248: w, 2250: bk },
  result: [resId, resCnt],
}));

// Food Grinder recipes from GTPS3 Base.h:1737-1837
export const GTPS3_GRINDER_RECIPES: Readonly<Record<number, { count: number; prize: number }>> = {
  326: { count: 30, prize: 4586 },
  4422: { count: 20, prize: 4610 },
  2564: { count: 20, prize: 4610 },
  2566: { count: 20, prize: 4610 },
  5372: { count: 20, prize: 4610 },
  6956: { count: 1, prize: 6958 },
  6972: { count: 5, prize: 6974 },
  7002: { count: 12, prize: 7004 },
  7050: { count: 20, prize: 7054 },
  4668: { count: 50, prize: 4670 },
  7012: { count: 1, prize: 7014 },
  440: { count: 100, prize: 6314 },
  880: { count: 50, prize: 4562 },
  5348: { count: 100, prize: 5416 },
  5350: { count: 100, prize: 5416 },
  5352: { count: 100, prize: 5416 },
  5354: { count: 100, prize: 5416 },
  4578: { count: 1, prize: 4580 },
  7460: { count: 25, prize: 7462 },
  192: { count: 50, prize: 4564 },
  1004: { count: 50, prize: 4564 },
  4982: { count: 100, prize: 4984 },
  4584: { count: 100, prize: 4570 },
  712: { count: 1, prize: 4570 },
  960: { count: 1, prize: 4570 },
  2734: { count: 50, prize: 4764 },
  6988: { count: 10, prize: 6990 },
  4566: { count: 100, prize: 4568 },
  6998: { count: 2, prize: 7000 },
  3404: { count: 20, prize: 4572 },
  3836: { count: 20, prize: 4572 },
  3406: { count: 10, prize: 4572 },
  954: { count: 100, prize: 4572 },
  10268: { count: 3, prize: 10272 },
};
