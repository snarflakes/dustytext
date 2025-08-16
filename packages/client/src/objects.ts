// Define the ObjectName type as a union of all possible names
export type ObjectName =
  | "Null"
  | "Air"
  | "Water"
  | "Bedrock"
  | "Stone"
  | "Deepslate"
  | "Granite"
  | "Tuff"
  | "Calcite"
  | "Basalt"
  | "SmoothBasalt"
  | "Andesite"
  | "Diorite"
  | "Cobblestone"
  | "MossyCobblestone"
  | "Obsidian"
  | "Dripstone"
  | "Blackstone"
  | "CobbledDeepslate"
  | "Amethyst"
  | "Glowstone"
  | "Grass"
  | "Dirt"
  | "Moss"
  | "Podzol"
  | "DirtPath"
  | "Mud"
  | "PackedMud"
  | "Farmland"
  | "WetFarmland"
  | "UnrevealedOre"
  | "Gravel"
  | "Sand"
  | "RedSand"
  | "Sandstone"
  | "RedSandstone"
  | "Clay"
  | "Terracotta"
  | "BrownTerracotta"
  | "OrangeTerracotta"
  | "WhiteTerracotta"
  | "LightGrayTerracotta"
  | "YellowTerracotta"
  | "RedTerracotta"
  | "LightBlueTerracotta"
  | "CyanTerracotta"
  | "BlackTerracotta"
  | "PurpleTerracotta"
  | "BlueTerracotta"
  | "MagentaTerracotta"
  | "OakLog"
  | "BirchLog"
  | "JungleLog"
  | "SakuraLog"
  | "AcaciaLog"
  | "SpruceLog"
  | "DarkOakLog"
  | "MangroveLog"
  | "OakLeaf"
  | "BirchLeaf"
  | "JungleLeaf"
  | "SakuraLeaf"
  | "SpruceLeaf"
  | "AcaciaLeaf"
  | "DarkOakLeaf"
  | "AzaleaLeaf"
  | "FloweringAzaleaLeaf"
  | "MangroveLeaf"
  | "MangroveRoots"
  | "MuddyMangroveRoots"
  | "AzaleaFlower"
  | "BellFlower"
  | "DandelionFlower"
  | "DaylilyFlower"
  | "LilacFlower"
  | "RoseFlower"
  | "FireFlower"
  | "MorninggloryFlower"
  | "PeonyFlower"
  | "Ultraviolet"
  | "SunFlower"
  | "FlyTrap"
  | "FescueGrass"
  | "SwitchGrass"
  | "VinesBush"
  | "IvyVine"
  | "HempBush"
  | "GoldenMushroom"
  | "RedMushroom"
  | "CoffeeBush"
  | "StrawberryBush"
  | "RaspberryBush"
  | "Wheat"
  | "CottonBush"
  | "Pumpkin"
  | "Melon"
  | "RedMushroomBlock"
  | "BrownMushroomBlock"
  | "MushroomStem"
  | "BambooBush"
  | "Cactus"
  | "Coral"
  | "SeaAnemone"
  | "Algae"
  | "HornCoralBlock"
  | "FireCoralBlock"
  | "TubeCoralBlock"
  | "BubbleCoralBlock"
  | "BrainCoralBlock"
  | "Snow"
  | "Ice"
  | "Lava"
  | "SpiderWeb"
  | "Bone"
  | "CoalOre"
  | "CopperOre"
  | "IronOre"
  | "GoldOre"
  | "DiamondOre"
  | "NeptuniumOre"
  | "TextSign"
  | "OakPlanks"
  | "BirchPlanks"
  | "JunglePlanks"
  | "SakuraPlanks"
  | "SprucePlanks"
  | "AcaciaPlanks"
  | "DarkOakPlanks"
  | "MangrovePlanks"
  | "CopperBlock"
  | "IronBlock"
  | "GoldBlock"
  | "DiamondBlock"
  | "NeptuniumBlock"
  | "WheatSeed"
  | "PumpkinSeed"
  | "MelonSeed"
  | "OakSapling"
  | "BirchSapling"
  | "JungleSapling"
  | "SakuraSapling"
  | "AcaciaSapling"
  | "SpruceSapling"
  | "DarkOakSapling"
  | "MangroveSapling"
  | "ForceField"
  | "Chest"
  | "SpawnTile"
  | "Bed"
  | "Workbench"
  | "Powerstone"
  | "Furnace"
  | "Torch"
  | "GreenTerracotta"
  | "PinkTerracotta"
  | "LimeTerracotta"
  | "GrayTerracotta"
  | "Stonecutter"
  | "StoneBricks"
  | "TuffBricks"
  | "DeepslateBricks"
  | "PolishedAndesite"
  | "PolishedGranite"
  | "PolishedDiorite"
  | "PolishedTuff"
  | "PolishedBasalt"
  | "PolishedBlackstone"
  | "ChiseledStoneBricks"
  | "ChiseledTuffBricks"
  | "ChiseledDeepslate"
  | "ChiseledPolishedBlackstone"
  | "ChiseledSandstone"
  | "ChiseledRedSandstone"
  | "CrackedStoneBricks"
  | "CrackedDeepslateBricks"
  | "SmoothSandstone"
  | "SmoothRedSandstone"
  | "SmoothStone"
  | "PolishedDeepslate"
  | "PolishedBlackstoneBricks"
  | "CrackedPolishedBlackstoneBricks"
  | "MossyStoneBricks"
  | "CutSandstone"
  | "CutRedSandstone"
  | "RedDye"
  | "YellowDye"
  | "BlueDye"
  | "GreenDye"
  | "WhiteDye"
  | "BlackDye"
  | "BrownDye"
  | "OrangeDye"
  | "PinkDye"
  | "LimeDye"
  | "CyanDye"
  | "GrayDye"
  | "PurpleDye"
  | "MagentaDye"
  | "LightBlueDye"
  | "LightGrayDye"
  | "Glass";

// Define the GameObject interface with optional descriptors
interface GameObject {
  id: number;
  name: ObjectName;
  descriptors?: string[]; // Optional array of descriptors
}

// Define the objects array with descriptors for some objects
export const objects: GameObject[] = [
  { id: 0, name: "Null", descriptors: ["empty", "void"] },
  { id: 1, name: "Air", descriptors: ["clear", "transparent"] },
  { id: 2, name: "Water", descriptors: ["clear", "rippling", "murky"] },
  { id: 3, name: "Bedrock", descriptors: ["unbreakable", "dark", "solid"] },
  { id: 4, name: "Stone", descriptors: ["smooth", "gray", "rugged"] },
  { id: 5, name: "Deepslate", descriptors: ["dark", "dense", "shadowy"] },
  { id: 6, name: "Granite", descriptors: ["speckled", "pinkish", "hard"] },
  { id: 7, name: "Tuff", descriptors: ["porous", "ashen", "rough"] },
  { id: 8, name: "Calcite", descriptors: ["creamy", "smooth", "pale"] },
  { id: 9, name: "Basalt", descriptors: ["dark", "columnar", "volcanic"] },
  { id: 10, name: "SmoothBasalt", descriptors: ["polished", "dark", "sleek"] },
  { id: 11, name: "Andesite", descriptors: ["gray", "smooth", "speckled"] },
  { id: 12, name: "Diorite", descriptors: ["white", "speckled", "polished"] },
  { id: 13, name: "Cobblestone", descriptors: ["rough", "bumpy", "worn"] },
  { id: 14, name: "MossyCobblestone", descriptors: ["mossy", "aged", "green"] },
  { id: 15, name: "Obsidian", descriptors: ["glossy", "black", "volcanic"] },
  { id: 16, name: "Dripstone", descriptors: ["pointed", "stalactite", "calcareous"] },
  { id: 17, name: "Blackstone", descriptors: ["dark", "smooth", "basaltic"] },
  { id: 18, name: "CobbledDeepslate", descriptors: ["dark", "rough", "craggy"] },
  { id: 19, name: "Amethyst", descriptors: ["sparkling", "purple", "crystalline"] },
  { id: 20, name: "Glowstone", descriptors: ["luminous", "golden", "radiant"] },
  { id: 21, name: "Grass", descriptors: ["lush", "green", "soft"] },
  { id: 22, name: "Dirt", descriptors: ["finely ground brown", "dusty", "yellow", "loamy", "hardpacked"] },
  { id: 23, name: "Moss", descriptors: ["velvety", "green", "spongy"] },
  { id: 24, name: "Podzol", descriptors: ["rich", "brown", "fertile"] },
  { id: 25, name: "DirtPath", descriptors: ["worn", "trodden", "earthy"] },
  { id: 26, name: "Mud", descriptors: ["sticky", "wet", "squelchy"] },
  { id: 27, name: "PackedMud", descriptors: ["compact", "firm", "earthy"] },
  { id: 28, name: "Farmland", descriptors: ["tilled", "fertile", "moist"] },
  { id: 29, name: "WetFarmland", descriptors: ["sodden", "fertile", "muddy"] },
  { id: 30, name: "UnrevealedOre", descriptors: ["mysterious", "hidden", "unexplored"] },
  { id: 31, name: "Gravel", descriptors: ["pebbly", "loose", "crunchy"] },
  { id: 32, name: "Sand", descriptors: ["fine", "golden", "shifting"] },
  { id: 33, name: "RedSand", descriptors: ["rusty", "fine", "warm"] },
  { id: 34, name: "Sandstone", descriptors: ["smooth", "pale", "layered"] },
  { id: 35, name: "RedSandstone", descriptors: ["reddish", "smooth", "layered"] },
  { id: 36, name: "Clay", descriptors: ["smooth", "gray", "malleable"] },
  { id: 37, name: "Terracotta", descriptors: ["hardened", "earthy", "baked"] },
  { id: 38, name: "BrownTerracotta", descriptors: ["rich", "brown", "baked"] },
  { id: 39, name: "OrangeTerracotta", descriptors: ["vibrant", "orange", "baked"] },
  { id: 40, name: "WhiteTerracotta", descriptors: ["clean", "white", "baked"] },
  { id: 41, name: "LightGrayTerracotta", descriptors: ["pale", "gray", "baked"] },
  { id: 42, name: "YellowTerracotta", descriptors: ["bright", "yellow", "baked"] },
  { id: 43, name: "RedTerracotta", descriptors: ["deep", "red", "baked"] },
  { id: 44, name: "LightBlueTerracotta", descriptors: ["soft", "blue", "baked"] },
  { id: 45, name: "CyanTerracotta", descriptors: ["cool", "cyan", "baked"] },
  { id: 46, name: "BlackTerracotta", descriptors: ["dark", "black", "baked"] },
  { id: 47, name: "PurpleTerracotta", descriptors: ["vibrant", "purple", "baked"] },
  { id: 48, name: "BlueTerracotta", descriptors: ["deep", "blue", "baked"] },
  { id: 49, name: "MagentaTerracotta", descriptors: ["bright", "magenta", "baked"] },
  { id: 50, name: "OakLog", descriptors: ["sturdy", "brown", "bark-covered"] },
  { id: 51, name: "BirchLog", descriptors: ["pale", "white", "smooth"] },
  { id: 52, name: "JungleLog", descriptors: ["reddish", "tropical", "dense"] },
  { id: 53, name: "SakuraLog", descriptors: ["pinkish", "smooth", "delicate"] },
  { id: 54, name: "AcaciaLog", descriptors: ["orange", "twisted", "savanna"] },
  { id: 55, name: "SpruceLog", descriptors: ["dark", "resinous", "evergreen"] },
  { id: 56, name: "DarkOakLog", descriptors: ["deep", "brown", "robust"] },
  { id: 57, name: "MangroveLog", descriptors: ["reddish", "wet", "mangrove"] },
  { id: 58, name: "OakLeaf", descriptors: ["green", "lush", "broad"] },
  { id: 59, name: "BirchLeaf", descriptors: ["light", "green", "delicate"] },
  { id: 60, name: "JungleLeaf", descriptors: ["dense", "green", "tropical"] },
  { id: 61, name: "SakuraLeaf", descriptors: ["pink", "soft", "blossoming"] },
  { id: 62, name: "SpruceLeaf", descriptors: ["dark", "green", "needle-like"] },
  { id: 63, name: "AcaciaLeaf", descriptors: ["sparse", "green", "savanna"] },
  { id: 64, name: "DarkOakLeaf", descriptors: ["dense", "dark", "broad"] },
  { id: 65, name: "AzaleaLeaf", descriptors: ["lush", "green", "flowery"] },
  { id: 66, name: "FloweringAzaleaLeaf", descriptors: ["blooming", "green", "vibrant"] },
  { id: 67, name: "MangroveLeaf", descriptors: ["dense", "green", "mangrove"] },
  { id: 68, name: "MangroveRoots", descriptors: ["tangled", "woody", "wet"] },
  { id: 69, name: "MuddyMangroveRoots", descriptors: ["muddy", "tangled", "wet"] },
  { id: 70, name: "AzaleaFlower", descriptors: ["pink", "delicate", "blooming"] },
  { id: 71, name: "BellFlower", descriptors: ["purple", "bell-shaped", "delicate"] },
  { id: 72, name: "DandelionFlower", descriptors: ["yellow", "bright", "fluffy"] },
  { id: 73, name: "DaylilyFlower", descriptors: ["orange", "vibrant", "petaled"] },
  { id: 74, name: "LilacFlower", descriptors: ["purple", "fragrant", "clustered"] },
  { id: 75, name: "RoseFlower", descriptors: ["red", "thorny", "blooming"] },
  { id: 76, name: "FireFlower", descriptors: ["fiery", "red", "vibrant"] },
  { id: 77, name: "MorninggloryFlower", descriptors: ["blue", "trumpet-shaped", "delicate"] },
  { id: 78, name: "PeonyFlower", descriptors: ["pink", "lush", "full"] },
  { id: 79, name: "Ultraviolet", descriptors: ["purple", "glowing", "vibrant"] },
  { id: 80, name: "SunFlower", descriptors: ["yellow", "tall", "sunny"] },
  { id: 81, name: "FlyTrap", descriptors: ["green", "snapping", "carnivorous"] },
  { id: 82, name: "FescueGrass", descriptors: ["fine", "green", "clumpy"] },
  { id: 83, name: "SwitchGrass", descriptors: ["tall", "green", "wiry"] },
  { id: 84, name: "VinesBush", descriptors: ["tangled", "green", "climbing"] },
  { id: 85, name: "IvyVine", descriptors: ["creeping", "green", "leafy"] },
  { id: 86, name: "HempBush", descriptors: ["green", "fibrous", "tall"] },
  { id: 87, name: "GoldenMushroom", descriptors: ["golden", "glowing", "fungal"] },
  { id: 88, name: "RedMushroom", descriptors: ["red", "spotted", "fungal"] },
  { id: 89, name: "CoffeeBush", descriptors: ["green", "berry-laden", "aromatic"] },
  { id: 90, name: "StrawberryBush", descriptors: ["red", "fruity", "leafy"] },
  { id: 91, name: "RaspberryBush", descriptors: ["red", "thorny", "fruity"] },
  { id: 92, name: "Wheat", descriptors: ["golden", "tall", "grainy"] },
  { id: 93, name: "CottonBush", descriptors: ["white", "fluffy", "bushy"] },
  { id: 94, name: "Pumpkin", descriptors: ["orange", "round", "heavy"] },
  { id: 95, name: "Melon", descriptors: ["green", "striped", "juicy"] },
  { id: 96, name: "RedMushroomBlock", descriptors: ["red", "spongy", "fungal"] },
  { id: 97, name: "BrownMushroomBlock", descriptors: ["brown", "spongy", "fungal"] },
  { id: 98, name: "MushroomStem", descriptors: ["white", "fibrous", "sturdy"] },
  { id: 99, name: "BambooBush", descriptors: ["green", "tall", "stalky"] },
  { id: 100, name: "Cactus", descriptors: ["spiky", "green", "desert"] },
  { id: 101, name: "Coral", descriptors: ["colorful", "marine", "branching"] },
  { id: 102, name: "SeaAnemone", descriptors: ["soft", "swaying", "tentacled"] },
  { id: 103, name: "Algae", descriptors: ["slimy", "green", "aquatic"] },
  { id: 104, name: "HornCoralBlock", descriptors: ["branched", "yellow", "reef"] },
  { id: 105, name: "FireCoralBlock", descriptors: ["orange", "burning", "reef"] },
  { id: 106, name: "TubeCoralBlock", descriptors: ["tubular", "purple", "reef"] },
  { id: 107, name: "BubbleCoralBlock", descriptors: ["bubbly", "pink", "reef"] },
  { id: 108, name: "BrainCoralBlock", descriptors: ["wrinkled", "gray", "reef"] },
  { id: 109, name: "Snow", descriptors: ["white", "cold", "powdery"] },
  { id: 110, name: "Ice", descriptors: ["clear", "frozen", "slippery"] },
  { id: 111, name: "Lava", descriptors: ["molten", "glowing", "dangerous"] },
  { id: 112, name: "SpiderWeb", descriptors: ["sticky", "silky", "intricate"] },
  { id: 113, name: "Bone", descriptors: ["white", "hard", "skeletal"] },
  { id: 114, name: "CoalOre", descriptors: ["black", "sooty", "combustible"] },
  { id: 115, name: "CopperOre", descriptors: ["orange", "metallic", "oxidizing"] },
  { id: 116, name: "IronOre", descriptors: ["rusty", "heavy", "magnetic"] },
  { id: 117, name: "GoldOre", descriptors: ["gleaming", "precious", "heavy"] },
  { id: 118, name: "DiamondOre", descriptors: ["sparkling", "rare", "brilliant"] },
  { id: 119, name: "NeptuniumOre", descriptors: ["radioactive", "blue", "rare"] },
  { id: 120, name: "TextSign", descriptors: ["wooden", "readable", "informative"] },
  { id: 121, name: "OakPlanks", descriptors: ["smooth", "brown", "crafted"] },
  { id: 122, name: "BirchPlanks", descriptors: ["pale", "smooth", "crafted"] },
  { id: 123, name: "JunglePlanks", descriptors: ["reddish", "smooth", "crafted"] },
  { id: 124, name: "SakuraPlanks", descriptors: ["pinkish", "smooth", "crafted"] },
  { id: 125, name: "SprucePlanks", descriptors: ["dark", "smooth", "crafted"] },
  { id: 126, name: "AcaciaPlanks", descriptors: ["orange", "smooth", "crafted"] },
  { id: 127, name: "DarkOakPlanks", descriptors: ["deep", "smooth", "crafted"] },
  { id: 128, name: "MangrovePlanks", descriptors: ["reddish", "smooth", "crafted"] },
  { id: 129, name: "CopperBlock", descriptors: ["orange", "metallic", "solid"] },
  { id: 130, name: "IronBlock", descriptors: ["gray", "metallic", "heavy"] },
  { id: 131, name: "GoldBlock", descriptors: ["golden", "precious", "heavy"] },
  { id: 132, name: "DiamondBlock", descriptors: ["brilliant", "precious", "hard"] },
  { id: 133, name: "NeptuniumBlock", descriptors: ["blue", "radioactive", "dense"] },
  { id: 134, name: "WheatSeed", descriptors: ["small", "brown", "plantable"] },
  { id: 135, name: "PumpkinSeed", descriptors: ["flat", "white", "plantable"] },
  { id: 136, name: "MelonSeed", descriptors: ["small", "black", "plantable"] },
  { id: 137, name: "OakSapling", descriptors: ["young", "green", "growing"] },
  { id: 138, name: "BirchSapling", descriptors: ["pale", "delicate", "growing"] },
  { id: 139, name: "JungleSapling", descriptors: ["tropical", "vibrant", "growing"] },
  { id: 140, name: "SakuraSapling", descriptors: ["pink", "delicate", "growing"] },
  { id: 141, name: "AcaciaSapling", descriptors: ["orange", "hardy", "growing"] },
  { id: 142, name: "SpruceSapling", descriptors: ["dark", "evergreen", "growing"] },
  { id: 143, name: "DarkOakSapling", descriptors: ["robust", "dark", "growing"] },
  { id: 144, name: "MangroveSapling", descriptors: ["aquatic", "rooted", "growing"] },
  { id: 145, name: "ForceField", descriptors: ["shimmering", "protective", "energy"] },
  { id: 146, name: "Chest", descriptors: ["wooden", "storage", "lockable"] },
  { id: 147, name: "SpawnTile", descriptors: ["glowing", "magical", "respawn"] },
  { id: 148, name: "Bed", descriptors: ["soft", "comfortable", "restful"] },
  { id: 149, name: "Workbench", descriptors: ["wooden", "crafting", "useful"] },
  { id: 150, name: "Powerstone", descriptors: ["glowing", "energetic", "powerful"] },
  { id: 151, name: "Furnace", descriptors: ["hot", "smelting", "stone"] },
  { id: 152, name: "Torch", descriptors: ["flickering", "bright", "wooden"] },
  { id: 153, name: "GreenTerracotta", descriptors: ["green", "glazed", "baked"] },
  { id: 154, name: "PinkTerracotta", descriptors: ["pink", "glazed", "baked"] },
  { id: 155, name: "LimeTerracotta", descriptors: ["lime", "glazed", "baked"] },
  { id: 156, name: "GrayTerracotta", descriptors: ["gray", "glazed", "baked"] },
  { id: 256, name: "Stonecutter", descriptors: ["sharp", "cutting", "stone"] },
  { id: 257, name: "StoneBricks", descriptors: ["carved", "gray", "structured"] },
  { id: 258, name: "TuffBricks", descriptors: ["rough", "ashen", "structured"] },
  { id: 259, name: "DeepslateBricks", descriptors: ["dark", "deep", "structured"] },
  { id: 260, name: "PolishedAndesite", descriptors: ["smooth", "gray", "polished"] },
  { id: 261, name: "PolishedGranite", descriptors: ["smooth", "speckled", "polished"] },
  { id: 262, name: "PolishedDiorite", descriptors: ["smooth", "white", "polished"] },
  { id: 263, name: "PolishedTuff", descriptors: ["smooth", "ashen", "polished"] },
  { id: 264, name: "PolishedBasalt", descriptors: ["smooth", "dark", "polished"] },
  { id: 265, name: "PolishedBlackstone", descriptors: ["smooth", "black", "polished"] },
  { id: 266, name: "ChiseledStoneBricks", descriptors: ["carved", "decorative", "detailed"] },
  { id: 267, name: "ChiseledTuffBricks", descriptors: ["carved", "ashen", "detailed"] },
  { id: 268, name: "ChiseledDeepslate", descriptors: ["carved", "dark", "detailed"] },
  { id: 269, name: "ChiseledPolishedBlackstone", descriptors: ["carved", "black", "detailed"] },
  { id: 270, name: "ChiseledSandstone", descriptors: ["carved", "pale", "detailed"] },
  { id: 271, name: "ChiseledRedSandstone", descriptors: ["carved", "red", "detailed"] },
  { id: 272, name: "CrackedStoneBricks", descriptors: ["cracked", "weathered", "aged"] },
  { id: 274, name: "CrackedDeepslateBricks", descriptors: ["cracked", "dark", "aged"] },
  { id: 275, name: "SmoothSandstone", descriptors: ["smooth", "pale", "refined"] },
  { id: 276, name: "SmoothRedSandstone", descriptors: ["smooth", "red", "refined"] },
  { id: 277, name: "SmoothStone", descriptors: ["smooth", "gray", "refined"] },
  { id: 278, name: "PolishedDeepslate", descriptors: ["smooth", "dark", "polished"] },
  { id: 279, name: "PolishedBlackstoneBricks", descriptors: ["smooth", "black", "structured"] },
  { id: 280, name: "CrackedPolishedBlackstoneBricks", descriptors: ["cracked", "black", "aged"] },
  { id: 281, name: "MossyStoneBricks", descriptors: ["mossy", "green", "overgrown"] },
  { id: 282, name: "CutSandstone", descriptors: ["cut", "pale", "geometric"] },
  { id: 283, name: "CutRedSandstone", descriptors: ["cut", "red", "geometric"] },
  { id: 284, name: "RedDye", descriptors: ["vibrant", "red", "coloring"] },
  { id: 285, name: "YellowDye", descriptors: ["bright", "yellow", "coloring"] },
  { id: 286, name: "BlueDye", descriptors: ["deep", "blue", "coloring"] },
  { id: 287, name: "GreenDye", descriptors: ["natural", "green", "coloring"] },
  { id: 288, name: "WhiteDye", descriptors: ["pure", "white", "coloring"] },
  { id: 289, name: "BlackDye", descriptors: ["dark", "black", "coloring"] },
  { id: 290, name: "BrownDye", descriptors: ["earthy", "brown", "coloring"] },
  { id: 291, name: "OrangeDye", descriptors: ["warm", "orange", "coloring"] },
  { id: 292, name: "PinkDye", descriptors: ["soft", "pink", "coloring"] },
  { id: 293, name: "LimeDye", descriptors: ["bright", "lime", "coloring"] },
  { id: 294, name: "CyanDye", descriptors: ["cool", "cyan", "coloring"] },
  { id: 295, name: "GrayDye", descriptors: ["neutral", "gray", "coloring"] },
  { id: 296, name: "PurpleDye", descriptors: ["royal", "purple", "coloring"] },
  { id: 297, name: "MagentaDye", descriptors: ["vivid", "magenta", "coloring"] },
  { id: 298, name: "LightBlueDye", descriptors: ["pale", "blue", "coloring"] },
  { id: 299, name: "LightGrayDye", descriptors: ["light", "gray", "coloring"] },
  { id: 318, name: "Glass", descriptors: ["transparent", "clear", "fragile"] },
];

// Create the objectNamesById mapping
export const objectNamesById: Record<number, ObjectName> = objects.reduce(
  (acc, obj) => {
    acc[obj.id] = obj.name;
    return acc;
  },
  {} as Record<number, ObjectName>,
);

// Create a mapping of id to descriptors for easy lookup
export const objectDescriptorsById: Record<number, string[] | undefined> = objects.reduce(
  (acc, obj) => {
    acc[obj.id] = obj.descriptors;
    return acc;
  },
  {} as Record<number, string[] | undefined>,
);

// Utility function to get a random descriptor for a given block ID
export function getRandomDescriptor(blockId: number): string | undefined {
  const descriptors = objectDescriptorsById[blockId];
  if (!descriptors || descriptors.length === 0) return undefined;
  return descriptors[Math.floor(Math.random() * descriptors.length)];
}

// Enable descriptors only for specific block IDs
export function getDescriptorForAllowedBlocks(blockId: number, allowedIds: number[]): string | undefined {
  if (!allowedIds.includes(blockId)) return undefined;
  return getRandomDescriptor(blockId);
}

// Example usage: only show descriptors for flowers and mushrooms
export const FLOWER_AND_MUSHROOM_IDS = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 87, 88];

export function getFlowerDescriptor(blockId: number): string | undefined {
  return getDescriptorForAllowedBlocks(blockId, FLOWER_AND_MUSHROOM_IDS);
}
