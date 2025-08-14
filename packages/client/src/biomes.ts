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

// Define the BiomeObject interface with optional descriptors and sensory experiences
interface BiomeObject {
  id: number;
  name: BiomeName;
  descriptors?: string[]; // Optional array of descriptors
  sensory?: string[]; // Optional array of sensory experiences
}

// Define the biomes array with descriptors and sensory experiences
export const biomes: BiomeObject[] = [
  { 
    id: 0, 
    name: "Badlands", 
    descriptors: ["arid", "rocky", "windswept"],
    sensory: ["Wind howls through the rocky formations.", "Pebbles skitter down distant cliffs.", "The air tastes of dust and stone."]
  },
  { 
    id: 1, 
    name: "BambooJungle", 
    descriptors: ["dense", "green", "humid"],
    sensory: ["Bamboo creaks and rustles overhead.", "Insects buzz in the thick air.", "Water drips steadily from the canopy."]
  },
  { 
    id: 3, 
    name: "Beach", 
    descriptors: ["sandy", "coastal", "breezy"],
    sensory: ["Waves crash rhythmically against the shore.", "Seagulls cry in the distance.", "Salt spray mists your face."]
  },
  { 
    id: 4, 
    name: "BirchForest", 
    descriptors: ["bright", "peaceful", "white-barked"],
    sensory: ["Leaves rustle gently in the breeze.", "Birds chirp melodiously above.", "Sunlight filters through the white bark."]
  },
  { 
    id: 6, 
    name: "ColdOcean", 
    descriptors: ["frigid", "deep", "choppy"],
    sensory: ["Icy waves crash against your feet.", "The wind carries a sharp, salty chill.", "Water bubbles and froths around you."]
  },
  { 
    id: 8, 
    name: "DarkForest", 
    descriptors: ["shadowy", "mysterious", "dense"],
    sensory: ["Branches creak ominously overhead.", "Something rustles in the underbrush.", "The air feels thick and still."]
  },
  { 
    id: 9, 
    name: "DeepColdOcean", 
    descriptors: ["abyssal", "icy", "dark"],
    sensory: ["Deep currents pull at your legs.", "The water is eerily silent.", "Frigid waves lap against you."]
  },
  { 
    id: 10, 
    name: "DeepDark", 
    descriptors: ["ancient", "silent", "foreboding"],
    sensory: ["Your footsteps echo in the darkness.", "A faint vibration pulses through the ground.", "The silence is almost deafening."]
  },
  { 
    id: 11, 
    name: "DeepFrozenOcean", 
    descriptors: ["glacial", "vast", "frozen"],
    sensory: ["Ice creaks and groans beneath you.", "The wind howls across the frozen surface.", "Your breath forms clouds in the frigid air."]
  },
  { 
    id: 12, 
    name: "DeepLukewarmOcean", 
    descriptors: ["warm", "deep", "tropical"],
    sensory: ["Gentle currents swirl around you.", "Tropical fish dart past your feet.", "The water feels pleasantly warm."]
  },
  { 
    id: 13, 
    name: "DeepOcean", 
    descriptors: ["vast", "mysterious", "deep"],
    sensory: ["Waves roll endlessly toward the horizon.", "The water gurgles and splashes.", "A gentle current tugs at you."]
  },
  { 
    id: 14, 
    name: "Desert", 
    descriptors: ["scorching", "sandy", "barren"],
    sensory: ["A soft whistling comes from the distance.", "It is dead silent.", "Sand hits your face from the intense wind."]
  },
  { 
    id: 15, 
    name: "DripstoneCaves", 
    descriptors: ["stalactite-filled", "echoing", "damp"],
    sensory: ["Water drips steadily from above.", "Your footsteps echo through the cavern.", "The air feels cool and humid."]
  },
  { 
    id: 16, 
    name: "ErodedBadlands", 
    descriptors: ["weathered", "carved", "ancient"],
    sensory: ["Wind whistles through carved stone.", "Loose rocks tumble in the distance.", "The air is dry and dusty."]
  },
  { 
    id: 17, 
    name: "FlowerForest", 
    descriptors: ["colorful", "fragrant", "blooming"],
    sensory: ["Bees buzz from flower to flower.", "A sweet fragrance fills the air.", "Petals drift gently on the breeze."]
  },
  { 
    id: 18, 
    name: "Forest", 
    descriptors: ["green", "lush", "peaceful"],
    sensory: ["Birds chirp in the canopy above.", "Leaves rustle in the gentle wind.", "The scent of earth and moss fills the air."]
  },
  { 
    id: 19, 
    name: "FrozenOcean", 
    descriptors: ["icy", "crystalline", "cold"],
    sensory: ["Ice cracks and shifts beneath you.", "The wind carries a bitter chill.", "Frozen waves glisten in the light."]
  },
  { 
    id: 20, 
    name: "FrozenPeaks", 
    descriptors: ["snow-capped", "towering", "frigid"],
    sensory: ["Wind howls across the peaks.", "Snow crunches under your feet.", "The air is thin and biting cold."]
  },
  { 
    id: 21, 
    name: "FrozenRiver", 
    descriptors: ["ice-covered", "still", "crystalline"],
    sensory: ["Ice creaks as it shifts.", "The frozen surface gleams.", "A cold breeze flows along the riverbed."]
  },
  { 
    id: 22, 
    name: "IceSpikes", 
    descriptors: ["crystalline", "sharp", "frozen"],
    sensory: ["Ice formations tinkle in the wind.", "Your breath forms thick clouds.", "The ground crunches with each step."]
  },
  { 
    id: 23, 
    name: "JaggedPeaks", 
    descriptors: ["sharp", "rocky", "treacherous"],
    sensory: ["Wind whistles through jagged rocks.", "Stones clatter down the mountainside.", "The air is thin and cold."]
  },
  { 
    id: 24, 
    name: "Jungle", 
    descriptors: ["dense", "humid", "tropical"],
    sensory: ["Exotic birds call from the canopy.", "Insects hum in the thick air.", "Vines rustle as creatures move through them."]
  },
  { 
    id: 29, 
    name: "LukewarmOcean", 
    descriptors: ["temperate", "gentle", "pleasant"],
    sensory: ["Gentle waves lap at your feet.", "The water feels comfortably warm.", "Seabirds call overhead."]
  },
  { 
    id: 30, 
    name: "LushCaves", 
    descriptors: ["verdant", "dripping", "moss-covered"],
    sensory: ["Water drips from moss-covered walls.", "Your footsteps echo softly.", "The air smells of earth and growing things."]
  },
  { 
    id: 31, 
    name: "MangroveSwamp", 
    descriptors: ["tangled", "murky", "root-filled"],
    sensory: ["Water gurgles around twisted roots.", "Insects buzz in the humid air.", "The ground squelches beneath you."]
  },
  { 
    id: 32, 
    name: "Meadow", 
    descriptors: ["grassy", "rolling", "serene"],
    sensory: ["Grass whispers in the gentle breeze.", "Bees hum among wildflowers.", "The air is fresh and sweet."]
  },
  { 
    id: 35, 
    name: "Ocean", 
    descriptors: ["vast", "blue", "endless"],
    sensory: ["Waves roll steadily toward shore.", "Seawater splashes around you.", "The horizon stretches endlessly."]
  },
  { 
    id: 36, 
    name: "OldGrowthBirchForest", 
    descriptors: ["ancient", "towering", "majestic"],
    sensory: ["Ancient trees creak in the wind.", "Leaves flutter down from great heights.", "The forest feels timeless and peaceful."]
  },
  { 
    id: 37, 
    name: "OldGrowthPineTaiga", 
    descriptors: ["primeval", "coniferous", "tall"],
    sensory: ["Pine needles rustle overhead.", "The scent of resin fills the air.", "Massive trunks groan in the wind."]
  },
  { 
    id: 38, 
    name: "OldGrowthSpruceTaiga", 
    descriptors: ["ancient", "evergreen", "massive"],
    sensory: ["Spruce boughs sway majestically.", "The forest floor crunches underfoot.", "Wind sighs through ancient branches."]
  },
  { 
    id: 39, 
    name: "Plains", 
    descriptors: ["open", "grassy", "windswept"],
    sensory: ["Grass waves like an ocean in the wind.", "The breeze carries distant sounds.", "Wildflowers dot the endless expanse."]
  },
  { 
    id: 40, 
    name: "River", 
    descriptors: ["flowing", "clear", "meandering"],
    sensory: ["Water babbles over smooth stones.", "Fish splash occasionally.", "The current gurgles peacefully."]
  },
  { 
    id: 41, 
    name: "Savanna", 
    descriptors: ["golden", "sparse", "dry"],
    sensory: ["Dry grass rustles in the heat.", "Insects chirp in the warm air.", "The sun beats down relentlessly."]
  },
  { 
    id: 42, 
    name: "SavannaPlateaus", 
    descriptors: ["elevated", "flat-topped", "arid"],
    sensory: ["Wind sweeps across the plateau.", "Sparse vegetation rustles dryly.", "The view stretches for miles."]
  },
  { 
    id: 44, 
    name: "SnowyBeach", 
    descriptors: ["white", "cold", "pristine"],
    sensory: ["Icy waves crash against snowy sand.", "The wind carries stinging snow.", "Frozen spray glitters in the air."]
  },
  { 
    id: 45, 
    name: "SnowyPlains", 
    descriptors: ["snow-covered", "flat", "white"],
    sensory: ["Snow crunches beneath your feet.", "The wind howls across the white expanse.", "Your breath forms clouds in the cold air."]
  },
  { 
    id: 46, 
    name: "SnowySlopes", 
    descriptors: ["slanted", "powdery", "steep"],
    sensory: ["Snow slides down the steep incline.", "Wind whips powder into your face.", "The slope creaks under the snow's weight."]
  },
  { 
    id: 47, 
    name: "SnowyTaiga", 
    descriptors: ["snow-laden", "coniferous", "cold"],
    sensory: ["Snow-heavy branches creak overhead.", "The cold air stings your lungs.", "Powder falls softly from the trees."]
  },
  { 
    id: 49, 
    name: "SparseJungle", 
    descriptors: ["scattered", "open", "tropical"],
    sensory: ["Tropical birds call sporadically.", "Warm air carries exotic scents.", "Leaves rustle in the humid breeze."]
  },
  { 
    id: 50, 
    name: "StonyPeaks", 
    descriptors: ["rocky", "barren", "high"],
    sensory: ["Rocks clatter down the mountainside.", "Wind howls through stone formations.", "The air is thin and sharp."]
  },
  { 
    id: 52, 
    name: "SunflowerPlains", 
    descriptors: ["bright", "yellow", "cheerful"],
    sensory: ["Sunflowers rustle in the warm breeze.", "Bees buzz busily among the blooms.", "The air smells sweet and golden."]
  },
  { 
    id: 53, 
    name: "Swamp", 
    descriptors: ["murky", "humid", "boggy"],
    sensory: ["Water gurgles in hidden pools.", "Frogs croak in the distance.", "The air is thick and muggy."]
  },
  { 
    id: 54, 
    name: "Taiga", 
    descriptors: ["coniferous", "cool", "northern"],
    sensory: ["Pine needles whisper in the breeze.", "The scent of evergreen fills the air.", "Branches sway rhythmically overhead."]
  },
  { 
    id: 57, 
    name: "WarmOcean", 
    descriptors: ["tropical", "warm", "inviting"],
    sensory: ["Warm waves lap gently at your feet.", "Tropical fish dart through the water.", "The ocean sparkles in the sunlight."]
  },
  { 
    id: 59, 
    name: "WindsweptForest", 
    descriptors: ["blustery", "exposed", "hardy"],
    sensory: ["Trees bend and sway in strong winds.", "Leaves whirl through the air.", "The constant breeze never stops."]
  },
  { 
    id: 60, 
    name: "WindsweptGravellyHills", 
    descriptors: ["rocky", "exposed", "harsh"],
    sensory: ["Gravel skitters in the wind.", "Gusts howl across the barren hills.", "Loose stones rattle constantly."]
  },
  { 
    id: 61, 
    name: "WindsweptHills", 
    descriptors: ["rolling", "breezy", "exposed"],
    sensory: ["Grass bends flat in the strong wind.", "The breeze carries distant sounds.", "Your hair whips around your face."]
  },
  { 
    id: 63, 
    name: "WoodedBadlands", 
    descriptors: ["sparse", "rugged", "mixed"],
    sensory: ["Dry branches rattle in the wind.", "Rocks tumble down eroded slopes.", "Hardy trees creak in the harsh breeze."]
  },
  { 
    id: 65, 
    name: "AndesiteCaves", 
    descriptors: ["gray", "volcanic", "smooth"],
    sensory: ["Your footsteps echo off smooth walls.", "Water drips from the volcanic ceiling.", "The air feels cool and still."]
  },
  { 
    id: 67, 
    name: "DeepCaves", 
    descriptors: ["profound", "dark", "echoing"],
    sensory: ["Every sound echoes endlessly.", "The darkness seems to press in.", "Your breathing sounds unnaturally loud."]
  },
  { 
    id: 69, 
    name: "DioriteCaves", 
    descriptors: ["speckled", "white", "crystalline"],
    sensory: ["Light reflects off crystalline walls.", "Water tinkles as it drips.", "The cave sparkles with mineral deposits."]
  },
  { 
    id: 70, 
    name: "FrostfireCaves", 
    descriptors: ["icy", "glowing", "mystical"],
    sensory: ["Ice crystals chime in the cold air.", "A mysterious glow emanates from the walls.", "The temperature shifts between hot and cold."]
  },
  { 
    id: 71, 
    name: "FungalCaves", 
    descriptors: ["mushroom-filled", "damp", "organic"],
    sensory: ["Spores drift silently through the air.", "Mushrooms squelch underfoot.", "The air smells earthy and rich."]
  },
  { 
    id: 72, 
    name: "GraniteCaves", 
    descriptors: ["pink", "hard", "speckled"],
    sensory: ["Your footsteps ring against hard stone.", "Water echoes as it drips.", "The granite walls gleam with flecks of mica."]
  },
  { 
    id: 74, 
    name: "InfestedCaves", 
    descriptors: ["crawling", "dangerous", "teeming"],
    sensory: ["Something skitters in the shadows.", "Chittering sounds echo from the walls.", "The air buzzes with unseen movement."]
  },
  { 
    id: 75, 
    name: "MantleCaves", 
    descriptors: ["deep", "hot", "molten"],
    sensory: ["Heat radiates from the cave walls.", "Molten rock bubbles in the distance.", "The air shimmers with intense heat."]
  },
  { 
    id: 76, 
    name: "ThermalCaves", 
    descriptors: ["steamy", "warm", "mineral-rich"],
    sensory: ["Steam hisses from hidden vents.", "Warm water bubbles up from below.", "The air smells of sulfur and minerals."]
  },
  { 
    id: 77, 
    name: "TuffCaves", 
    descriptors: ["porous", "volcanic", "rough"],
    sensory: ["Your footsteps sound muffled on porous rock.", "Air whistles through holes in the stone.", "The rough walls scrape against you."]
  },
  { 
    id: 78, 
    name: "UndergroundJungle", 
    descriptors: ["subterranean", "lush", "hidden"],
    sensory: ["Exotic plants rustle in the underground breeze.", "Water drips from hanging vines.", "Strange bird calls echo through the cavern."]
  },
  { 
    id: 82, 
    name: "AlpineHighlands", 
    descriptors: ["mountainous", "crisp", "elevated"],
    sensory: ["Mountain winds whistle through the peaks.", "The air is thin and crystal clear.", "Snow crunches beneath your feet."]
  },
  { 
    id: 84, 
    name: "AmethystRainforest", 
    descriptors: ["crystalline", "purple", "magical"],
    sensory: ["Crystal formations chime in the breeze.", "Purple light filters through the canopy.", "The air hums with magical energy."]
  },
  { 
    id: 86, 
    name: "AridHighlands", 
    descriptors: ["dry", "elevated", "sparse"],
    sensory: ["Dry wind whistles across the plateau.", "Sparse vegetation rustles dryly.", "The sun beats down mercilessly."]
  },
  { 
    id: 87, 
    name: "AshenSavanna", 
    descriptors: ["gray", "volcanic", "desolate"],
    sensory: ["Ash swirls in the hot wind.", "The ground cracks under the heat.", "Volcanic dust stings your eyes."]
  },
  { 
    id: 89, 
    name: "BirchTaiga", 
    descriptors: ["mixed", "white-barked", "northern"],
    sensory: ["White bark gleams in the filtered light.", "Mixed leaves rustle overhead.", "The air smells of birch and pine."]
  },
  { 
    id: 91, 
    name: "BloomingValley", 
    descriptors: ["flowering", "colorful", "fertile"],
    sensory: ["A symphony of buzzing fills the air.", "Flower petals drift on gentle breezes.", "Sweet fragrances mingle together."]
  },
  { 
    id: 92, 
    name: "Brushland", 
    descriptors: ["scrubby", "thorny", "dry"],
    sensory: ["Thorny bushes rustle in the dry wind.", "Small creatures scurry through the brush.", "The air is dusty and warm."]
  },
  { 
    id: 96, 
    name: "ColdShrubland", 
    descriptors: ["hardy", "low", "chilly"],
    sensory: ["Hardy shrubs rattle in the cold wind.", "The air bites at your exposed skin.", "Frost crunches underfoot."]
  },
  { 
    id: 100, 
    name: "ForestedHighlands", 
    descriptors: ["wooded", "elevated", "cool"],
    sensory: ["Mountain breezes sigh through the trees.", "Leaves rustle in the cool air.", "The forest feels ancient and peaceful."]
  },
  { 
    id: 103, 
    name: "GlacialChasm", 
    descriptors: ["icy", "deep", "crevassed"],
    sensory: ["Ice groans and shifts in the depths.", "Wind howls through the chasm.", "Your voice echoes off icy walls."]
  },
  { 
    id: 105, 
    name: "GravelBeach", 
    descriptors: ["pebbly", "rough", "coastal"],
    sensory: ["Waves rattle the pebbles rhythmically.", "Stones clatter as they shift.", "Seabirds cry above the rocky shore."]
  },
  { 
    id: 108, 
    name: "Highlands", 
    descriptors: ["elevated", "rolling", "misty"],
    sensory: ["Mist swirls around the rolling hills.", "The wind carries distant sounds.", "Grass whispers in the highland breeze."]
  },
  { 
    id: 109, 
    name: "HotShrubland", 
    descriptors: ["scorching", "sparse", "thorny"],
    sensory: ["Heat shimmers off the dry ground.", "Thorny plants rattle in the hot wind.", "The air burns your lungs."]
  },
  { 
    id: 110, 
    name: "IceMarsh", 
    descriptors: ["frozen", "boggy", "treacherous"],
    sensory: ["Ice creaks ominously beneath you.", "Frozen reeds rattle in the wind.", "The marsh groans as ice shifts."]
  },
  { 
    id: 113, 
    name: "LavenderValley", 
    descriptors: ["purple", "fragrant", "peaceful"],
    sensory: ["Lavender rustles in the gentle breeze.", "The air is heavy with sweet fragrance.", "Bees hum contentedly among the flowers."]
  },
  { 
    id: 115, 
    name: "LushValley", 
    descriptors: ["green", "fertile", "sheltered"],
    sensory: ["A stream babbles through the valley.", "Birds sing from every tree.", "The air is fresh and clean."]
  },
  { 
    id: 121, 
    name: "PaintedMountains", 
    descriptors: ["colorful", "striped", "artistic"],
    sensory: ["Wind whistles through colorful rock layers.", "Stones of different colors clatter together.", "The mountains seem to shimmer with color."]
  },
  { 
    id: 122, 
    name: "RedOasis", 
    descriptors: ["crimson", "rare", "life-giving"],
    sensory: ["Water gurgles from the red spring.", "Palm fronds rustle in the desert breeze.", "The oasis hums with hidden life."]
  },
  { 
    id: 123, 
    name: "RockyJungle", 
    descriptors: ["stone-filled", "tropical", "rugged"],
    sensory: ["Vines scrape against rough stone.", "Tropical birds call from rocky perches.", "Water trickles over moss-covered rocks."]
  },
  { 
    id: 124, 
    name: "RockyMountains", 
    descriptors: ["granite", "towering", "majestic"],
    sensory: ["Rocks tumble down steep slopes.", "Wind howls through granite peaks.", "Your footsteps echo off stone walls."]
  },
  { 
    id: 126, 
    name: "SakuraGrove", 
    descriptors: ["pink", "delicate", "serene"],
    sensory: ["Cherry blossoms drift on the breeze.", "Petals rustle softly overhead.", "The air smells of spring and flowers."]
  },
  { 
    id: 127, 
    name: "SakuraValley", 
    descriptors: ["blossoming", "peaceful", "beautiful"],
    sensory: ["Pink petals carpet the ground.", "A gentle breeze carries floral scents.", "The valley seems to glow with soft light."]
  },
  { 
    id: 133, 
    name: "Shield", 
    descriptors: ["ancient", "stable", "weathered"],
    sensory: ["Ancient rocks creak under pressure.", "The ground feels solid and unchanging.", "Wind whistles over weathered stone."]
  },
  { 
    id: 136, 
    name: "SiberianTaiga", 
    descriptors: ["vast", "cold", "endless"],
    sensory: ["Endless forest stretches in all directions.", "Snow falls silently through the trees.", "The cold air stings your face."]
  },
  { 
    id: 137, 
    name: "SkylandsAutumn", 
    descriptors: ["floating", "golden", "ethereal"],
    sensory: ["Wind whistles around floating islands.", "Golden leaves drift through empty air.", "The ground feels strangely light beneath you."]
  },
  { 
    id: 138, 
    name: "SkylandsSpring", 
    descriptors: ["aerial", "fresh", "blooming"],
    sensory: ["Fresh breezes swirl around you.", "Flower petals float on impossible winds.", "The air feels light and magical."]
  },
  { 
    id: 142, 
    name: "SnowyBadlands", 
    descriptors: ["white", "harsh", "desolate"],
    sensory: ["Snow whips across barren rocks.", "The wind howls through icy formations.", "Your footsteps crunch in the frozen wasteland."]
  },
  { 
    id: 143, 
    name: "SnowyCherryGrove", 
    descriptors: ["pink-white", "delicate", "cold"],
    sensory: ["Snow-covered blossoms tinkle in the wind.", "Cold air carries the scent of flowers.", "Pink petals contrast against white snow."]
  },
  { 
    id: 146, 
    name: "Steppe", 
    descriptors: ["grassland", "vast", "windswept"],
    sensory: ["Endless grass waves in the wind.", "The horizon stretches endlessly.", "Grasshoppers chirp in the warm air."]
  },
  { 
    id: 148, 
    name: "TemperateHighlands", 
    descriptors: ["mild", "elevated", "pleasant"],
    sensory: ["A gentle breeze flows across the hills.", "Birds sing from scattered trees.", "The air is fresh and comfortable."]
  },
  { 
    id: 149, 
    name: "TropicalJungle", 
    descriptors: ["steamy", "dense", "exotic"],
    sensory: ["Exotic birds screech from the canopy.", "Steam rises from the jungle floor.", "Vines rustle with hidden movement."]
  },
  { 
    id: 152, 
    name: "VolcanicPeaks", 
    descriptors: ["fiery", "smoking", "dangerous"],
    sensory: ["Lava bubbles and pops in the distance.", "Sulfurous smoke stings your nostrils.", "The ground rumbles ominously beneath you."]
  },
  { 
    id: 153, 
    name: "WarmRiver", 
    descriptors: ["gentle", "flowing", "temperate"],
    sensory: ["Warm water gurgles over smooth stones.", "Fish splash playfully in the current.", "The river hums with gentle life."]
  },
  { 
    id: 160, 
    name: "Yellowstone", 
    descriptors: ["geothermal", "steaming", "sulfurous"],
    sensory: ["Geysers hiss and bubble nearby.", "Steam rises from hidden hot springs.", "The air smells strongly of sulfur."]
  },
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

// Create a mapping of id to sensory experiences for easy lookup
export const biomeSensoryById: Record<number, string[] | undefined> = biomes.reduce(
  (acc, biome) => {
    acc[biome.id] = biome.sensory;
    return acc;
  },
  {} as Record<number, string[] | undefined>,
);

// Utility function to get a random sensory experience for a given biome ID
export function getRandomBiomeSensory(biomeId: number): string | undefined {
  const sensoryExperiences = biomeSensoryById[biomeId];
  if (!sensoryExperiences || sensoryExperiences.length === 0) return undefined;
  return sensoryExperiences[Math.floor(Math.random() * sensoryExperiences.length)];
}
