import { createPublicClient, http, type PublicClient } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getRandomDescriptor } from "../../objects";
import { getBiome } from "../../biomeHelper";
import { biomeNamesById, getRandomBiomeDescriptor, getRandomBiomeSensory } from "../../biomes";
import { CommandHandler, CommandContext } from './types';

// -----------------------------------------------------------------------------
// Block encoding (copied from explore.ts)
// -----------------------------------------------------------------------------
type Vec3 = [number, number, number];

const BYTES_32_BITS = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS = BYTES_32_BITS - ENTITY_TYPE_BITS; // 248
const VEC3_BITS = 96n;
const ENTITY_TYPE_BLOCK = 0x03; // matches EntityTypes.Block

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n)); // two's complement pack for int32
}
function packVec3([x, y, z]: Vec3): bigint {
  const X = toU32(x), Y = toU32(y), Z = toU32(z);
  return (X << 64n) | (Y << 32n) | Z; // 96 bits
}
function encode(entityType: number, data: bigint): `0x${string}` {
  return `0x${((BigInt(entityType) << ENTITY_ID_BITS) | data).toString(16).padStart(64, '0')}` as `0x${string}`;
}
function encodeCoord(entityType: number, coord: Vec3): `0x${string}` {
  const packed = packVec3(coord);
  return encode(entityType, packed << (ENTITY_ID_BITS - VEC3_BITS));
}
function encodeBlock(pos: Vec3): `0x${string}` {
  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
}

// -----------------------------------------------------------------------------
// On-chain override reads
// -----------------------------------------------------------------------------
const STORE_ABI = [{
  type: "function",
  name: "getField",
  stateMutability: "view",
  inputs: [
    { name: "tableId", type: "bytes32" },
    { name: "keyTuple", type: "bytes32[]" },
    { name: "fieldIndex", type: "uint8" }
  ],
  outputs: [{ name: "data", type: "bytes" }]
}] as const;

const ENTITY_OBJECT_TYPE_TABLE_ID_OVERRIDE = "0x74620000000000000000000000000000456e746974794f626a65637454797065" as `0x${string}`;
const OVERRIDE_FLAG = 0x8000;

function normalizeOverride(raw?: `0x${string}` | null): number | undefined {
  if (!raw || raw === "0x") return undefined;       // no record
  const v = Number(BigInt(raw)) & 0xffff;           // uint16
  const base = v & ~OVERRIDE_FLAG;                  // strip top-bit
  return base === 0 ? undefined : base;             // 0 => treat as no override
}

async function readEntityObjectTypesMulticall(
  client: PublicClient,
  world: `0x${string}`,
  positions: Vec3[]
): Promise<Map<`0x${string}`, number | undefined>> {
  const contracts = positions.map((p) => ({
    address: world,
    abi: STORE_ABI,
    functionName: "getField" as const,
    args: [ENTITY_OBJECT_TYPE_TABLE_ID_OVERRIDE, [encodeBlock(p)], 0],
  }));

  const results = await client.multicall({ contracts, allowFailure: true, blockTag: "latest" });

  const out = new Map<`0x${string}`, number | undefined>();
  positions.forEach((p, i) => {
    const k = encodeBlock(p);
    const r = results[i];
    const value = r.status === "success" ? normalizeOverride(r.result as `0x${string}`) : undefined;
    out.set(k, value);
  });
  return out;
}

async function resolveObjectTypesFresh(
  client: PublicClient,
  world: `0x${string}`,
  positions: Vec3[],
  terrainConcurrency = 12
): Promise<Map<`0x${string}`, number | undefined>> {
  const map = await readEntityObjectTypesMulticall(client, world, positions);

  const misses: { pos: Vec3; k: `0x${string}` }[] = [];
  for (const p of positions) {
    const k = encodeBlock(p);
    if (map.get(k) === undefined) misses.push({ pos: p, k });
  }

  if (misses.length) {
    let i = 0;
    const workers = new Array(Math.min(terrainConcurrency, misses.length)).fill(0).map(async () => {
      while (i < misses.length) {
        const m = misses[i++];
        try {
          const t = await getTerrainBlockType(client, world, m.pos);
          if (typeof t === "number") map.set(m.k, t);
        } catch { /* ignore */ }
      }
    });
    await Promise.all(workers);
  }

  return map;
}

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
  const diagonalDirs = ["northeast", "northwest", "southeast", "southwest"];
  const allDirs = [...dirs, ...diagonalDirs];
  
  const timeoutPromise = new Promise<string>(resolve => 
    setTimeout(() => {
      console.log('SurveyCommand: Horizon sensing timed out after 30 seconds');
      resolve("The distant lands blur in haze.");
    }, budget)
  );
  
  const sensePromise = (async () => {
    console.log('SurveyCommand: Starting extended water detection at position:', pos);
    
    // First check if we're currently in water
    let currentlyInWater = false;
    try {
      const currentPositions: Vec3[] = [[pos[0], pos[1], pos[2]]];
      const currentTypeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, currentPositions);
      const currentBlockType = currentTypeMap.get(encodeBlock([pos[0], pos[1], pos[2]]));
      
      if (typeof currentBlockType === "number" && isWater(currentBlockType)) {
        currentlyInWater = true;
        console.log('SurveyCommand: Currently standing in water');
      }
    } catch (error) {
      console.log('SurveyCommand: Failed to check current position for water:', error);
    }
    
    // Extended water detection - sample every 5 blocks out to 100 blocks
    const waterResults: Array<{dir: string, distance: number, hasWater: boolean}> = [];
    
    for (const dir of allDirs) {
      let dx = 0, dz = 0;
      
      // Handle cardinal and diagonal directions
      if (dir.includes("north")) dz = -1;
      if (dir.includes("south")) dz = 1;
      if (dir.includes("east")) dx = 1;
      if (dir.includes("west")) dx = -1;
      
      // For diagonals, normalize the movement
      if (dir.includes("north") && dir.includes("east")) { dx = 1; dz = -1; }
      else if (dir.includes("north") && dir.includes("west")) { dx = -1; dz = -1; }
      else if (dir.includes("south") && dir.includes("east")) { dx = 1; dz = 1; }
      else if (dir.includes("south") && dir.includes("west")) { dx = -1; dz = 1; }
      
      // Sample positions every 10 blocks from 10 to 100
      const samplePositions: Vec3[] = [];
      const distances = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      
      for (const distance of distances) {
        // Check at water level (y) and one below (y-1) for better detection
        samplePositions.push([pos[0] + (dx * distance), pos[1], pos[2] + (dz * distance)]);
        samplePositions.push([pos[0] + (dx * distance), pos[1] - 1, pos[2] + (dz * distance)]);
      }
      
      try {
        const typeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, samplePositions);
        
        // Check each distance for water
        for (const distance of distances) {
          const blockType1 = typeMap.get(encodeBlock([pos[0] + (dx * distance), pos[1], pos[2] + (dz * distance)]));
          const blockType2 = typeMap.get(encodeBlock([pos[0] + (dx * distance), pos[1] - 1, pos[2] + (dz * distance)]));
          
          const hasWater = (typeof blockType1 === "number" && isWater(blockType1)) || 
                          (typeof blockType2 === "number" && isWater(blockType2));
          
          if (hasWater) {
            waterResults.push({ dir, distance, hasWater: true });
            console.log(`SurveyCommand: Found water ${distance} blocks ${dir}`);
            break; // Found water in this direction, no need to check further
          }
        }
      } catch (error) {
        console.log(`SurveyCommand: Failed extended water check ${dir}:`, error);
      }
    }
    
    // Check immediate surroundings for terrain features (existing code)
    const immediateResults: Array<{dir: Facing, terrain: string[], hasWater: boolean, maxHeight: number, minHeight: number}> = [];
    
    for (const dir of dirs) {
      const dx = dir === "east" ? 1 : dir === "west" ? -1 : 0;
      const dz = dir === "north" ? -1 : dir === "south" ? 1 : 0;
      
      const terrain: string[] = [];
      let hasWater = false;
      let maxHeight = pos[1];
      let minHeight = pos[1];
      
      try {
        const layers = [2, 1, 0, -1, -2];
        const checkPositions: Vec3[] = [];
        
        for (let distance = 1; distance <= 3; distance++) {
          for (const dy of layers) {
            checkPositions.push([pos[0] + (dx * distance), pos[1] + dy, pos[2] + (dz * distance)]);
          }
        }
        
        const typeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, checkPositions);
        
        for (let distance = 1; distance <= 3; distance++) {
          for (const dy of layers) {
            const checkPos: Vec3 = [pos[0] + (dx * distance), pos[1] + dy, pos[2] + (dz * distance)];
            const blockType = typeMap.get(encodeBlock(checkPos));
            
            if (typeof blockType === "number" && objectNamesById[blockType]) {
              const blockName = objectNamesById[blockType].toLowerCase();
              terrain.push(blockName);
              
              if (isWater(blockType)) {
                hasWater = true;
              }
              
              const height = pos[1] + dy;
              if (height > maxHeight) maxHeight = height;
              if (height < minHeight) minHeight = height;
            }
          }
        }
        
        immediateResults.push({ dir, terrain, hasWater, maxHeight, minHeight });
      } catch (error) {
        console.log(`SurveyCommand: Failed to check ${dir} direction:`, error);
        immediateResults.push({ dir, terrain: [], hasWater: false, maxHeight: pos[1], minHeight: pos[1] });
      }
    }
    
    // Build description with water detection
    const r = seedRand(pos[0], pos[2]);
    
    // Find closest water sources in any direction (get top 2)
    const sortedWaterResults = waterResults.sort((a, b) => a.distance - b.distance);
    const closestWaterSources = sortedWaterResults.slice(0, 2);
    
    // If we found distant water, mention it
    if (closestWaterSources.length > 0 && !currentlyInWater) {
      let waterPhrase = "";
      if (closestWaterSources.length === 1) {
        waterPhrase = `A glimmer of water catches your eye, roughly ${closestWaterSources[0].distance} steps to the ${closestWaterSources[0].dir}.`;
      } else {
        waterPhrase = `Glimmers of water catch your eye: roughly ${closestWaterSources[0].distance} steps to the ${closestWaterSources[0].dir} and ${closestWaterSources[1].distance} steps to the ${closestWaterSources[1].dir}.`;
      }
      
      // Also check for immediate terrain features
      const scored = immediateResults.map(r => {
        let score = 0;
        let kind = "clear";
        
        if (r.hasWater) {
          score = 10;
          kind = "river";
        } else {
          const heightDiff = r.maxHeight - pos[1];
          const earthenBlocks = r.terrain.filter(t => 
            t.includes("stone") || t.includes("rock") || t.includes("granite") || 
            t.includes("basalt") || t.includes("dirt") || t.includes("clay") || t.includes("gravel")
          );
          const earthenPercentage = r.terrain.length > 0 ? (earthenBlocks.length / r.terrain.length) : 0;
          
          if (earthenPercentage >= 0.75 && heightDiff >= 2 && r.terrain.length >= 5) {
            score = 5;
            kind = "mountain";
          }
        }
        
        return { ...r, score, kind };
      });
      
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      
      if (best && best.score > 0) {
        const bestDirName = best.dir.charAt(0).toUpperCase() + best.dir.slice(1);
        if (best.kind === "mountain") {
          const mountainPhrase = pick(phrases.mountain.steep, r);
          return `${waterPhrase} ${bestDirName}: ${mountainPhrase}`;
        } else if (best.kind === "river") {
          const riverPhrase = pick(phrases.river.near, r);
          return `${bestDirName}: ${riverPhrase} ${waterPhrase}`;
        }
      }
      
      return waterPhrase;
    }
    
    // Fall back to existing immediate terrain analysis
    const scored = immediateResults.map(r => {
      let score = 0;
      let kind = "clear";
      
      if (r.hasWater) {
        score = 10;
        kind = "river";
      } else {
        const heightDiff = r.maxHeight - pos[1];
        const earthenBlocks = r.terrain.filter(t => 
          t.includes("stone") || t.includes("rock") || t.includes("granite") || 
          t.includes("basalt") || t.includes("dirt") || t.includes("clay") || t.includes("gravel")
        );
        const earthenPercentage = r.terrain.length > 0 ? (earthenBlocks.length / r.terrain.length) : 0;
        
        if (earthenPercentage >= 0.75 && heightDiff >= 2 && r.terrain.length >= 5) {
          score = 5;
          kind = "mountain";
        }
      }
      
      return { ...r, score, kind };
    });
    
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    
    if (best && best.score > 0) {
      const bestDirName = best.dir.charAt(0).toUpperCase() + best.dir.slice(1);
      if (best.kind === "mountain") {
        const mountainPhrase = pick(phrases.mountain.steep, r);
        return `${bestDirName}: ${mountainPhrase}`;
      } else if (best.kind === "river") {
        const riverPhrase = pick(phrases.river.near, r);
        return `${bestDirName}: ${riverPhrase}`;
      }
    }
    
    // No water found within scanning range
    if (!currentlyInWater && waterResults.length === 0) {
      return "No water sources detected within 100 steps. " + pick(phrases.clear, r);
    }
    
    return pick(phrases.clear, r);
  })();
  
  return Promise.race([sensePromise, timeoutPromise]);
}

export class SurveyCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      // Show initial survey message
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "\nYou get up on your toes, squint your eyes and look in all directions....\nRoundtime: 9 sec." 
      }));

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

      // Get terrain and biome using new accurate methods
      let terrainLabel = "Unknown terrain.";
      let biomeLabel = "";
      
      const cacheKey = getCacheKey(x, y, z);
      const cachedDescriptors = descriptorCache.get(cacheKey) || {};
      
      try {
        // Use new accurate block detection for ground and surface
        const positions: Vec3[] = [[x, y - 1, z], [x, y, z]];
        const typeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, positions);
        
        const blockType = typeMap.get(encodeBlock([x, y - 1, z]));
        const surfaceBlockType = typeMap.get(encodeBlock([x, y, z]));
        
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
      const horizonDescription = await senseHorizon([x, y, z]);

      // Check what's above the player
      let overheadDescription = "";
      try {
        const overheadPositions: Vec3[] = [];
        for (let dy = 1; dy <= 10; dy++) {
          overheadPositions.push([x, y + dy, z]);
        }
        
        const overheadTypeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, overheadPositions);
        const overheadBlocks: string[] = [];
        
        for (let dy = 1; dy <= 10; dy++) {
          const blockType = overheadTypeMap.get(encodeBlock([x, y + dy, z]));
          if (typeof blockType === "number" && objectNamesById[blockType] && blockType !== 1) { // 1 is Air
            const blockName = objectNamesById[blockType].toLowerCase();
            overheadBlocks.push(blockName);
          }
        }
        
        if (overheadBlocks.length > 0) {
          // Categorize what's above
          const hasLeaves = overheadBlocks.some(block => block.includes("leaves"));
          const hasWood = overheadBlocks.some(block => block.includes("wood") || block.includes("log"));
          const hasVines = overheadBlocks.some(block => block.includes("vine"));
          const hasFlowers = overheadBlocks.some(block => block.includes("flower") || block.includes("petal"));
          const hasStone = overheadBlocks.some(block => block.includes("stone") || block.includes("rock"));
          
          if (hasVines && hasLeaves) {
            overheadDescription = " Jungle vines hang down through the leafy canopy above.";
          } else if (hasVines) {
            overheadDescription = " Vines dangle from above, swaying gently.";
          } else if (hasLeaves && hasWood) {
            overheadDescription = " Tree branches and leaves form a natural canopy overhead.";
          } else if (hasLeaves) {
            overheadDescription = " Leafy branches stretch above you.";
          } else if (hasWood) {
            overheadDescription = " Wooden structures or tree trunks rise above.";
          } else if (hasFlowers) {
            overheadDescription = " Colorful blooms hang overhead.";
          } else if (hasStone) {
            overheadDescription = " Stone formations loom above you.";
          } else {
            // Generic description for other blocks
            const uniqueBlocks = [...new Set(overheadBlocks)];
            if (uniqueBlocks.length === 1) {
              overheadDescription = ` ${uniqueBlocks[0].charAt(0).toUpperCase() + uniqueBlocks[0].slice(1)} blocks the sky above.`;
            } else {
              overheadDescription = " Various structures rise above you.";
            }
          }
        } else {
          overheadDescription = " Clear skies extend above you. You gaze momentarily, deep into the blue sky.";
        }
      } catch (overheadError) {
        console.log('SurveyCommand: Overhead check failed:', overheadError);
        overheadDescription = " Clear skies extend above you. You gaze momentarily, deep into the blue sky.";
      }

      // Update cache
      descriptorCache.set(cacheKey, cachedDescriptors);

      // Get biome name for header (without descriptor) - same as look command
      let biomeHeaderText = "";
      try {
        const biomeId = await getBiome(WORLD_ADDRESS as `0x${string}`, publicClient as PublicClient, [x, y, z]);
        const biomeName = biomeNamesById[biomeId];
        if (biomeName) {
          biomeHeaderText = `<div style="background-color: blue; color: white; padding: 2px 4px; margin: 0; width: 100%; line-height: 1;">[${biomeName}]</div>`;
        }
      } catch (biomeError) {
        console.log('SurveyCommand: Biome header fetch failed:', biomeError);
      }

      const surveyOutput = `${terrainLabel}${biomeLabel} ${horizonDescription}${overheadDescription} You are at (${x}, ${y}, ${z}), facing ${orientation.label}. `;
      const finalMessage = biomeHeaderText ? `${biomeHeaderText}${surveyOutput}` : surveyOutput;
      
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







































