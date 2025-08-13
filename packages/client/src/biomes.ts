// Define the BiomeName type as a union of all possible biome names
export type BiomeName =
  | "Badlands"
  | "BambooJungle"
  | "Beach"
  | "BirchForest"
  | "ColdOcean"
  | "DarkForest"
  | "DeepColdOcean"
  | "DeepDark"
  | "DeepFrozenOcean"
  | "DeepLukewarmOcean"
  | "DeepOcean"
  | "Desert"
  | "DripstoneCaves"
  | "ErodedBadlands"
  | "FlowerForest"
  | "Forest"
  | "FrozenOcean"
  | "FrozenPeaks"
  | "FrozenRiver"
  | "IceSpikes"
  | "JaggedPeaks"
  | "Jungle"
  | "LukewarmOcean"
  | "LushCaves"
  | "MangroveSwamp"
  | "Meadow"
  | "Ocean"
  | "OldGrowthBirchForest"
  | "OldGrowthPineTaiga"
  | "OldGrowthSpruceTaiga"
  | "Plains"
  | "River"
  | "Savanna"
  | "SavannaPlateaus"
  | "SnowyBeach"
  | "SnowyPlains"
  | "SnowySlopes"
  | "SnowyTaiga"
  | "SparseJungle"
  | "StonyPeaks"
  | "SunflowerPlains"
  | "Swamp"
  | "Taiga"
  | "WarmOcean"
  | "WindsweptForest"
  | "WindsweptGravellyHills"
  | "WindsweptHills"
  | "WoodedBadlands"
  | "AndesiteCaves"
  | "DeepCaves"
  | "DioriteCaves"
  | "FrostfireCaves"
  | "FungalCaves"
  | "GraniteCaves"
  | "InfestedCaves"
  | "MantleCaves"
  | "ThermalCaves"
  | "TuffCaves"
  | "UndergroundJungle"
  | "AlpineHighlands"
  | "AmethystRainforest"
  | "AridHighlands"
  | "AshenSavanna"
  | "BirchTaiga"
  | "BloomingValley"
  | "Brushland"
  | "ColdShrubland"
  | "ForestedHighlands"
  | "GlacialChasm"
  | "GravelBeach"
  | "Highlands"
  | "HotShrubland"
  | "IceMarsh"
  | "LavenderValley"
  | "LushValley"
  | "PaintedMountains"
  | "RedOasis"
  | "RockyJungle"
  | "RockyMountains"
  | "SakuraGrove"
  | "SakuraValley"
  | "Shield"
  | "SiberianTaiga"
  | "SkylandsAutumn"
  | "SkylandsSpring"
  | "SnowyBadlands"
  | "SnowyCherryGrove"
  | "Steppe"
  | "TemperateHighlands"
  | "TropicalJungle"
  | "VolcanicPeaks"
  | "WarmRiver"
  | "Yellowstone";

// Define the BiomeObject interface with optional descriptors
interface BiomeObject {
  id: number;
  name: BiomeName;
  descriptors?: string[]; // Optional array of descriptors
}

// Define the biomes array with descriptors
export const biomes: BiomeObject[] = [
  { id: 0, name: "Badlands", descriptors: ["arid", "rocky", "windswept"] },
  { id: 1, name: "BambooJungle", descriptors: ["dense", "green", "humid"] },
  { id: 3, name: "Beach", descriptors: ["sandy", "coastal", "breezy"] },
  { id: 4, name: "BirchForest", descriptors: ["bright", "peaceful", "white-barked"] },
  { id: 6, name: "ColdOcean", descriptors: ["frigid", "deep", "choppy"] },
  { id: 8, name: "DarkForest", descriptors: ["shadowy", "mysterious", "dense"] },
  { id: 9, name: "DeepColdOcean", descriptors: ["abyssal", "icy", "dark"] },
  { id: 10, name: "DeepDark", descriptors: ["ancient", "silent", "foreboding"] },
  { id: 11, name: "DeepFrozenOcean", descriptors: ["glacial", "bottomless", "frozen"] },
  { id: 12, name: "DeepLukewarmOcean", descriptors: ["temperate", "vast", "calm"] },
  { id: 13, name: "DeepOcean", descriptors: ["endless", "blue", "profound"] },
  { id: 14, name: "Desert", descriptors: ["scorching", "sandy", "barren"] },
  { id: 15, name: "DripstoneCaves", descriptors: ["stalactite-filled", "echoing", "limestone"] },
  { id: 19, name: "ErodedBadlands", descriptors: ["weathered", "carved", "ancient"] },
  { id: 20, name: "FlowerForest", descriptors: ["colorful", "fragrant", "blooming"] },
  { id: 21, name: "Forest", descriptors: ["verdant", "lush", "peaceful"] },
  { id: 22, name: "FrozenOcean", descriptors: ["icy", "crystalline", "cold"] },
  { id: 23, name: "FrozenPeaks", descriptors: ["snow-capped", "towering", "pristine"] },
  { id: 24, name: "FrozenRiver", descriptors: ["ice-covered", "winding", "frozen"] },
  { id: 26, name: "IceSpikes", descriptors: ["crystalline", "sharp", "glittering"] },
  { id: 27, name: "JaggedPeaks", descriptors: ["sharp", "treacherous", "steep"] },
  { id: 28, name: "Jungle", descriptors: ["tropical", "dense", "vibrant"] },
  { id: 29, name: "LukewarmOcean", descriptors: ["mild", "pleasant", "azure"] },
  { id: 30, name: "LushCaves", descriptors: ["verdant", "dripping", "moss-covered"] },
  { id: 31, name: "MangroveSwamp", descriptors: ["tangled", "murky", "root-filled"] },
  { id: 32, name: "Meadow", descriptors: ["grassy", "rolling", "serene"] },
  { id: 35, name: "Ocean", descriptors: ["vast", "blue", "endless"] },
  { id: 36, name: "OldGrowthBirchForest", descriptors: ["ancient", "towering", "majestic"] },
  { id: 37, name: "OldGrowthPineTaiga", descriptors: ["primeval", "coniferous", "tall"] },
  { id: 38, name: "OldGrowthSpruceTaiga", descriptors: ["ancient", "evergreen", "massive"] },
  { id: 39, name: "Plains", descriptors: ["open", "grassy", "windswept"] },
  { id: 40, name: "River", descriptors: ["flowing", "clear", "meandering"] },
  { id: 41, name: "Savanna", descriptors: ["golden", "sparse", "dry"] },
  { id: 42, name: "SavannaPlateaus", descriptors: ["elevated", "flat-topped", "arid"] },
  { id: 44, name: "SnowyBeach", descriptors: ["white", "cold", "pristine"] },
  { id: 45, name: "SnowyPlains", descriptors: ["snow-covered", "flat", "white"] },
  { id: 46, name: "SnowySlopes", descriptors: ["slanted", "powdery", "steep"] },
  { id: 47, name: "SnowyTaiga", descriptors: ["snow-laden", "coniferous", "cold"] },
  { id: 49, name: "SparseJungle", descriptors: ["scattered", "open", "tropical"] },
  { id: 50, name: "StonyPeaks", descriptors: ["rocky", "barren", "high"] },
  { id: 52, name: "SunflowerPlains", descriptors: ["bright", "yellow", "cheerful"] },
  { id: 53, name: "Swamp", descriptors: ["murky", "humid", "boggy"] },
  { id: 54, name: "Taiga", descriptors: ["coniferous", "cool", "northern"] },
  { id: 57, name: "WarmOcean", descriptors: ["tropical", "warm", "inviting"] },
  { id: 59, name: "WindsweptForest", descriptors: ["blustery", "exposed", "hardy"] },
  { id: 60, name: "WindsweptGravellyHills", descriptors: ["rocky", "exposed", "harsh"] },
  { id: 61, name: "WindsweptHills", descriptors: ["rolling", "breezy", "exposed"] },
  { id: 63, name: "WoodedBadlands", descriptors: ["sparse", "rugged", "mixed"] },
  { id: 65, name: "AndesiteCaves", descriptors: ["gray", "volcanic", "smooth"] },
  { id: 67, name: "DeepCaves", descriptors: ["profound", "dark", "echoing"] },
  { id: 69, name: "DioriteCaves", descriptors: ["speckled", "white", "crystalline"] },
  { id: 70, name: "FrostfireCaves", descriptors: ["icy", "glowing", "mystical"] },
  { id: 71, name: "FungalCaves", descriptors: ["mushroom-filled", "damp", "organic"] },
  { id: 72, name: "GraniteCaves", descriptors: ["pink", "hard", "speckled"] },
  { id: 74, name: "InfestedCaves", descriptors: ["crawling", "dangerous", "teeming"] },
  { id: 75, name: "MantleCaves", descriptors: ["deep", "hot", "molten"] },
  { id: 76, name: "ThermalCaves", descriptors: ["steamy", "warm", "mineral-rich"] },
  { id: 77, name: "TuffCaves", descriptors: ["porous", "volcanic", "rough"] },
  { id: 78, name: "UndergroundJungle", descriptors: ["subterranean", "lush", "hidden"] },
  { id: 82, name: "AlpineHighlands", descriptors: ["mountainous", "crisp", "elevated"] },
  { id: 84, name: "AmethystRainforest", descriptors: ["crystalline", "purple", "magical"] },
  { id: 86, name: "AridHighlands", descriptors: ["dry", "elevated", "sparse"] },
  { id: 87, name: "AshenSavanna", descriptors: ["gray", "volcanic", "desolate"] },
  { id: 89, name: "BirchTaiga", descriptors: ["mixed", "white-barked", "northern"] },
  { id: 91, name: "BloomingValley", descriptors: ["flowering", "colorful", "fertile"] },
  { id: 92, name: "Brushland", descriptors: ["scrubby", "thorny", "dry"] },
  { id: 96, name: "ColdShrubland", descriptors: ["hardy", "low", "chilly"] },
  { id: 100, name: "ForestedHighlands", descriptors: ["wooded", "elevated", "cool"] },
  { id: 103, name: "GlacialChasm", descriptors: ["icy", "deep", "crevassed"] },
  { id: 105, name: "GravelBeach", descriptors: ["pebbly", "rough", "coastal"] },
  { id: 108, name: "Highlands", descriptors: ["elevated", "rolling", "misty"] },
  { id: 109, name: "HotShrubland", descriptors: ["scorching", "sparse", "thorny"] },
  { id: 110, name: "IceMarsh", descriptors: ["frozen", "boggy", "treacherous"] },
  { id: 113, name: "LavenderValley", descriptors: ["purple", "fragrant", "peaceful"] },
  { id: 115, name: "LushValley", descriptors: ["green", "fertile", "sheltered"] },
  { id: 121, name: "PaintedMountains", descriptors: ["colorful", "striped", "artistic"] },
  { id: 122, name: "RedOasis", descriptors: ["crimson", "rare", "life-giving"] },
  { id: 123, name: "RockyJungle", descriptors: ["stone-filled", "tropical", "rugged"] },
  { id: 124, name: "RockyMountains", descriptors: ["granite", "towering", "majestic"] },
  { id: 126, name: "SakuraGrove", descriptors: ["pink", "delicate", "serene"] },
  { id: 127, name: "SakuraValley", descriptors: ["blossoming", "peaceful", "beautiful"] },
  { id: 133, name: "Shield", descriptors: ["ancient", "stable", "weathered"] },
  { id: 136, name: "SiberianTaiga", descriptors: ["vast", "cold", "endless"] },
  { id: 137, name: "SkylandsAutumn", descriptors: ["floating", "golden", "ethereal"] },
  { id: 138, name: "SkylandsSpring", descriptors: ["aerial", "fresh", "blooming"] },
  { id: 142, name: "SnowyBadlands", descriptors: ["white", "harsh", "desolate"] },
  { id: 143, name: "SnowyCherryGrove", descriptors: ["pink-white", "delicate", "cold"] },
  { id: 146, name: "Steppe", descriptors: ["grassland", "vast", "windswept"] },
  { id: 148, name: "TemperateHighlands", descriptors: ["mild", "elevated", "pleasant"] },
  { id: 149, name: "TropicalJungle", descriptors: ["steamy", "dense", "exotic"] },
  { id: 152, name: "VolcanicPeaks", descriptors: ["fiery", "smoking", "dangerous"] },
  { id: 153, name: "WarmRiver", descriptors: ["gentle", "flowing", "temperate"] },
  { id: 160, name: "Yellowstone", descriptors: ["geothermal", "steaming", "sulfurous"] },
];

// Create the biomeNamesById mapping
export const biomeNamesById: Record<number, BiomeName> = biomes.reduce(
  (acc, biome) => {
    acc[biome.id] = biome.name;
    return acc;
  },
  {} as Record<number, BiomeName>,
);

// Create a mapping of id to descriptors for easy lookup
export const biomeDescriptorsById: Record<number, string[] | undefined> = biomes.reduce(
  (acc, biome) => {
    acc[biome.id] = biome.descriptors;
    return acc;
  },
  {} as Record<number, string[] | undefined>,
);

// Utility function to get a random descriptor for a given biome ID
export function getRandomBiomeDescriptor(biomeId: number): string | undefined {
  const descriptors = biomeDescriptorsById[biomeId];
  if (!descriptors || descriptors.length === 0) return undefined;
  return descriptors[Math.floor(Math.random() * descriptors.length)];
}

// Enable descriptors only for specific biome IDs
export function getBiomeDescriptorForAllowedBiomes(biomeId: number, allowedIds: number[]): string | undefined {
  if (!allowedIds.includes(biomeId)) return undefined;
  return getRandomBiomeDescriptor(biomeId);
}

// Example usage: only show descriptors for cave biomes
export const CAVE_BIOME_IDS = [15, 30, 65, 67, 69, 70, 71, 72, 74, 75, 76, 77, 78];

export function getCaveDescriptor(biomeId: number): string | undefined {
  return getBiomeDescriptorForAllowedBiomes(biomeId, CAVE_BIOME_IDS);
}

// Example usage: only show descriptors for ocean biomes
export const OCEAN_BIOME_IDS = [6, 9, 11, 12, 13, 22, 29, 35, 57];

export function getOceanDescriptor(biomeId: number): string | undefined {
  return getBiomeDescriptorForAllowedBiomes(biomeId, OCEAN_BIOME_IDS);
}

