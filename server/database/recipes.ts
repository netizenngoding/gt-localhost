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
