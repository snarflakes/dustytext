import { createPublicClient, http, type PublicClient } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getRandomDescriptor } from "../../objects";
import { getBiome } from "../../biomeHelper";
import { biomeNamesById, getRandomBiomeDescriptor, getRandomBiomeSensory } from "../../biomes";
import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ORIENTATION_TABLE = "EntityOrientation";

// Cache for consistent descriptors per location
const descriptorCache = new Map<string, { terrain?: string; biome?: string; sensory?: string; hasSensory?: boolean }>();

function getCacheKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

const publicClient = createPublicClient({
  chain: redstone,
  transport: http(),
});

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

// Horizon sensing types and implementation
type Facing = "north" | "east" | "south" | "west";
interface Vec3 { x: number; y: number; z: number }

function isWater(blockId: number): boolean {
  const name = objectNamesById[blockId]?.toLowerCase() || "";
  return name.includes("water") || name.includes("ocean") || name.includes("sea");
}

// Horizon sensing phrases
const phrases = {
  clear: [
    "The way ahead feels open and inviting.",
    "Nothing obvious hinders your path.",
  ],
  river: {
    near: ["A brook cuts across your path, an easy hop or two."],
    walk: ["A modest river winds ahead; a short wade might do."],
    trek: ["A broad river holds the far bank at a good walk's distance."],
    far: ["A wide river sprawls ahead, no easy ford in sight."],
    endless: ["The river becomes a silver road to the horizon."],
  },
  sea: {
    near: ["The shore begins just ahead; waves nibble at the sand."],
    walk: ["The coastline unfurls a short walk away."],
    trek: ["Beyond lies open water, stretching well beyond a simple march."],
    far: ["The sea extends as far as you can comfortably travel in a day."],
    endless: ["The sea goes on and on, as if the world forgot to stop."],
  },
  mountain: {
    low: ["The ground lifts gently into the hills."],
    steep: ["A steep bluff shoulders the path."],
    sheer: ["A sheer wall of stone commands the way."],
    towering: ["A towering face looms—mountain in full stature."],
  },
};

function seedRand(x: number, y: number) {
  let s = (x * 73856093) ^ (y * 19349663) ^ 0x9e3779b9;
  return () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return ((s>>>0) % 1_000_000) / 1_000_000; };
}

function pick<T>(arr: T[], r: () => number) { 
  return arr[Math.floor(r() * arr.length)]; 
}

async function senseHorizon(pos: Vec3): Promise<string> {
  const budget = 30000; // ms - 30 second timeout
  const dirs: Facing[] = ["north", "east", "south", "west"];
  
  const timeoutPromise = new Promise<string>(resolve => 
    setTimeout(() => {
      console.log('SurveyCommand: Horizon sensing timed out after 30 seconds');
      resolve("The distant lands blur in haze.");
    }, budget)
  );
  
  const sensePromise = (async () => {
    console.log('SurveyCommand: Starting immediate terrain check at position:', pos);
    
    // First check if we're currently in water
    let currentlyInWater = false;
    try {
      const currentBlockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, [pos.x, pos.y, pos.z]);
      if (typeof currentBlockType === "number" && isWater(currentBlockType)) {
        currentlyInWater = true;
        console.log('SurveyCommand: Currently standing in water');
      }
    } catch (error) {
      console.log('SurveyCommand: Failed to check current position for water:', error);
    }
    
    // Check immediate surroundings (extend range like explore does)
    const immediateResults: Array<{dir: Facing, terrain: string[], hasWater: boolean, maxHeight: number, minHeight: number}> = [];
    
    // NEW: Check single block 10 blocks out for water in each direction
    const distantWaterResults: Array<{dir: Facing, hasWater: boolean}> = [];
    
    for (const dir of dirs) {
      const dx = dir === "east" ? 1 : dir === "west" ? -1 : 0;
      const dz = dir === "north" ? -1 : dir === "south" ? 1 : 0;
      
      const terrain: string[] = [];
      let hasWater = false;
      let maxHeight = pos.y;
      let minHeight = pos.y;
      
      // Check multiple blocks in this direction (like explore does)
      try {
        const layers = [2, 1, 0, -1, -2];
        for (let distance = 1; distance <= 3; distance++) {
          for (const dy of layers) {
            const checkPos = [pos.x + (dx * distance), pos.y + dy, pos.z + (dz * distance)] as [number, number, number];
            const blockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, checkPos);
            
            if (typeof blockType === "number" && objectNamesById[blockType]) {
              const blockName = objectNamesById[blockType].toLowerCase();
              terrain.push(blockName);
              
              if (isWater(blockType)) {
                hasWater = true;
              }
              
              const height = pos.y + dy;
              if (height > maxHeight) maxHeight = height;
              if (height < minHeight) minHeight = height;
            }
          }
        }
        
        console.log(`SurveyCommand: ${dir} extended terrain check (3 blocks):`, terrain, 'hasWater:', hasWater);
        immediateResults.push({ dir, terrain, hasWater, maxHeight, minHeight });
        
      } catch (error) {
        console.log(`SurveyCommand: Failed to check ${dir} direction:`, error);
        immediateResults.push({ dir, terrain: [], hasWater: false, maxHeight: pos.y, minHeight: pos.y });
      }
      
      // NEW: Check single block 10 blocks out for water
      try {
        const checkPos = [pos.x + (dx * 10), pos.y, pos.z + (dz * 10)] as [number, number, number];
        const blockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, checkPos);
        
        const hasDistantWater = typeof blockType === "number" && isWater(blockType);
        distantWaterResults.push({ dir, hasWater: hasDistantWater });
        
        console.log(`SurveyCommand: ${dir} at 10 blocks - water: ${hasDistantWater}`);
      } catch (error) {
        console.log(`SurveyCommand: Failed distant water check ${dir}:`, error);
        distantWaterResults.push({ dir, hasWater: false });
      }
    }
    
    // Analyze the immediate results
    const scored = immediateResults.map(r => {
      let score = 0;
      let kind = "clear";
      let waterCount = 0;
      
      // Count actual water blocks in the terrain (not including current position)
      waterCount = r.terrain.filter(t => t.includes("water") || t.includes("ocean") || t.includes("sea")).length;
      
      console.log(`SurveyCommand: ${r.dir} terrain analysis:`, r.terrain, 'waterCount:', waterCount);
      
      // Check for water in this direction's terrain - RIVERS GET PRIORITY
      if (waterCount > 0) {
        score = 2 + waterCount; // Higher score for more water
        kind = "river";
      }
      
      // Check for elevation changes (mountains) - only if not already a river
      if (kind !== "river") {
        const heightDiff = r.maxHeight - pos.y;
        
        // Only count actual terrain blocks, not vegetation
        const terrainBlocks = r.terrain.filter(t => 
          t !== "air" && 
          !t.includes("leaf") && 
          !t.includes("grass") && 
          !t.includes("log") && 
          !t.includes("wood") &&
          !t.includes("flower") &&
          !t.includes("vine") &&
          !t.includes("bush")
        );
        
        // Count earthen/rocky blocks specifically
        const earthenBlocks = r.terrain.filter(t => 
          t.includes("stone") || 
          t.includes("rock") || 
          t.includes("granite") || 
          t.includes("basalt") ||
          t.includes("dirt") ||
          t.includes("clay") ||
          t.includes("gravel")
        );
        
        // Require 75% earthen blocks AND significant height difference for mountain
        const earthenPercentage = r.terrain.length > 0 ? (earthenBlocks.length / r.terrain.length) : 0;
        
        if (earthenPercentage >= 0.75 && heightDiff >= 2 && terrainBlocks.length >= 5) {
          score = Math.max(score, 10);
          kind = "mountain";
        }
      }
      
      console.log(`SurveyCommand: ${r.dir} scored ${score} as ${kind}, waterCount:`, waterCount);
      
      return { ...r, score, kind, waterCount };
    });
    
    // Find the best river direction (most water) and best mountain direction
    const riverDirections = scored.filter(r => r.kind === "river").sort((a, b) => b.waterCount - a.waterCount);
    const mountainDirections = scored.filter(r => r.kind === "mountain").sort((a, b) => b.score - a.score);
    
    console.log('SurveyCommand: River directions:', riverDirections);
    console.log('SurveyCommand: Mountain directions:', mountainDirections);
    
    // Build description based on what we found
    const r = seedRand(pos.x, pos.z);
    
    // If we're in water AND there are both rivers and mountains, mention both
    if (currentlyInWater && riverDirections.length > 0 && mountainDirections.length > 0) {
      const bestRiver = riverDirections[0];
      const bestMountain = mountainDirections[0];
      
      const riverPhrase = pick(phrases.river.walk, r);
      const mountainPhrase = pick(phrases.mountain.steep, r);
      const riverDirName = bestRiver.dir.charAt(0).toUpperCase() + bestRiver.dir.slice(1);
      const mountainDirName = bestMountain.dir.charAt(0).toUpperCase() + bestMountain.dir.slice(1);
      
      return `${riverDirName}: ${riverPhrase} ${mountainDirName}: ${mountainPhrase}`;
    }
    
    // If we're in water but no river direction found, just mention the river generally
    if (currentlyInWater) {
      const riverPhrase = pick(phrases.river.walk, r);
      if (mountainDirections.length > 0) {
        const bestMountain = mountainDirections[0];
        const mountainPhrase = pick(phrases.mountain.steep, r);
        const mountainDirName = bestMountain.dir.charAt(0).toUpperCase() + bestMountain.dir.slice(1);
        return `${riverPhrase} ${mountainDirName}: ${mountainPhrase}`;
      }
      
      // NEW: Add distant water information for water navigation
      const landDirections = distantWaterResults.filter(r => !r.hasWater).map(r => r.dir);
      
      if (landDirections.length > 0) {
        const dirNames = landDirections.map(d => d.toLowerCase());
        return `${riverPhrase} Dry land appears to be ${dirNames.join(" and ")}.`;
      } else {
        return `${riverPhrase} No end to water seen in all directions.`;
      }
    }
    
    // Find the most interesting direction overall
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    
    if (best.score === 0) {
      return pick(phrases.clear, r);
    }
    
    const dirName = best.dir.charAt(0).toUpperCase() + best.dir.slice(1);
    
    if (best.kind === "river") {
      const phrase = pick(phrases.river.near, r);
      return `${dirName}: ${phrase}`;
    } else if (best.kind === "mountain") {
      const phrase = pick(phrases.mountain.steep, r);
      return `${dirName}: ${phrase}`;
    }
    
    return pick(phrases.clear, r);
  })();
  
  return Promise.race([sensePromise, timeoutPromise]);
}

export class SurveyCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      console.log('SurveyCommand: Starting with entityId:', entityId);

      // Get position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      console.log('SurveyCommand: Fetching position with query:', posQuery);
      
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      console.log('SurveyCommand: Position response status:', posRes.status);
      
      if (!posRes.ok) {
        throw new Error(`Position fetch failed: ${posRes.status} ${posRes.statusText}`);
      }

      const posJson = await posRes.json();
      console.log('SurveyCommand: Position JSON:', posJson);
      
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("No position found for player. Try 'spawn' first.");
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
      console.log('SurveyCommand: Player position:', { x, y, z });

      // Get orientation (with error handling)
      let orientation = { label: "north", value: 0 };
      try {
        const oriQuery = `SELECT "orientation" FROM "${ORIENTATION_TABLE}" WHERE "entityId" = '${entityId}'`;
        const oriRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: oriQuery }]),
        });

        if (oriRes.ok) {
          const oriJson = await oriRes.json();
          const oriRows = oriJson?.result?.[0];
          
          if (Array.isArray(oriRows) && oriRows.length >= 2) {
            const [oriCols, oriVals] = oriRows;
            const index = oriCols.indexOf("orientation");
            if (index !== -1 && oriVals[index] !== null) {
              const raw = Number(oriVals[index]);
              orientation = { label: ["north", "east", "south", "west"][raw] ?? "unknown", value: raw };
            }
          }
        }
      } catch (oriError) {
        console.log('SurveyCommand: Orientation fetch failed:', oriError);
      }

      // Get terrain and biome (with error handling)
      let terrainLabel = "Unknown terrain.";
      let biomeLabel = "";
      
      const cacheKey = getCacheKey(x, y, z);
      const cachedDescriptors = descriptorCache.get(cacheKey) || {};
      
      try {
        const blockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, [x, y - 1, z]);
        const surfaceBlockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, [x, y, z]);
        
        if (typeof blockType === "number" && objectNamesById[blockType]) {
          const blockName = objectNamesById[blockType].toLowerCase();
          
          // Use cached descriptor or generate new one
          if (!cachedDescriptors.terrain) {
            cachedDescriptors.terrain = getRandomDescriptor(blockType);
          }
          
          const terrainText = cachedDescriptors.terrain ? `${cachedDescriptors.terrain} ${blockName}` : blockName;
          let surfaceText = "";
          
          // Check for surface objects like flowers/grass
          if (typeof surfaceBlockType === "number" && objectNamesById[surfaceBlockType] && surfaceBlockType !== 1) { // 1 is Air
            const surfaceName = objectNamesById[surfaceBlockType].toLowerCase();
            const surfaceDescriptor = getRandomDescriptor(surfaceBlockType);
            const surfaceDisplay = surfaceDescriptor ? `${surfaceDescriptor} ${surfaceName}` : surfaceName;
            surfaceText = ` There is ${surfaceDisplay} here.`;
          }
          
          terrainLabel = `You are standing on ${terrainText}.${surfaceText}`;
        } else {
          terrainLabel = "Unexplored terrain. Try 'explore'.";
        }
      } catch (terrainError) {
        console.log('SurveyCommand: Terrain fetch failed:', terrainError);
      }

      try {
        const biomeId = await getBiome(WORLD_ADDRESS as `0x${string}`, publicClient as PublicClient, [x, y, z]);
        const biomeName = biomeNamesById[biomeId];
        if (biomeName) {
          // Use cached descriptor or generate new one
          if (!cachedDescriptors.biome) {
            cachedDescriptors.biome = getRandomBiomeDescriptor(biomeId);
          }
          
          // Use cached sensory or determine if this location has sensory (50% chance)
          if (cachedDescriptors.hasSensory === undefined) {
            cachedDescriptors.hasSensory = Math.random() < 0.5;
            if (cachedDescriptors.hasSensory) {
              cachedDescriptors.sensory = getRandomBiomeSensory(biomeId);
            }
          }
          
          const biomeText = cachedDescriptors.biome ? `${cachedDescriptors.biome} ${biomeName}` : biomeName;
          const sensoryText = cachedDescriptors.hasSensory && cachedDescriptors.sensory ? ` ${cachedDescriptors.sensory}` : "";
          biomeLabel = ` You are in the ${biomeText}.${sensoryText}`;
        }
      } catch (biomeError) {
        console.log('SurveyCommand: Biome fetch failed:', biomeError);
      }

      // Perform horizon sensing
      const horizonDescription = await senseHorizon({ x, y, z });

      // Update cache
      descriptorCache.set(cacheKey, cachedDescriptors);

      const finalMessage = `${terrainLabel}${biomeLabel} ${horizonDescription} You are at (${x}, ${y}, ${z}), facing ${orientation.label}. `;
      console.log('SurveyCommand: Final message:', finalMessage);

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: finalMessage
      }));
    } catch (error) {
      console.error('SurveyCommand: Command failed:', error);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Survey failed: ${error}` 
      }));
    }
  }
}











