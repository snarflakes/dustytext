
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
  if (!raw || raw === "0x") return undefined; // no record
  const v = BigInt(raw);
  const u16 = v & 0xffffn;

  // Only trust values that carry the override flag
  if ((u16 & BigInt(OVERRIDE_FLAG)) === 0n) return undefined;

  const base = Number(u16 & ~BigInt(OVERRIDE_FLAG));
  return base === 0 ? undefined : base;
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
  // Deduplicate positions by encoded key so we don't query the same spot repeatedly
  const unique: Vec3[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const key = encodeBlock(p);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  const map = await readEntityObjectTypesMulticall(client, world, unique);

  const misses: { pos: Vec3; k: `0x${string}` }[] = [];
  for (const p of unique) {
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

// Constants for sea-level checks
const SEA_LEVEL = 63;
const SEA_BAND = [SEA_LEVEL - 1, SEA_LEVEL, SEA_LEVEL + 1]; // 62, 63, 64

// Helper for axis deltas (x+: east, z-: north)
function dirDelta(dir: string): [number, number] {
  switch (dir) {
    case "north": return [0, -1];
    case "south": return [0, +1];
    case "east":  return [+1, 0];
    case "west":  return [-1, 0];
    case "northeast": return [+1, -1];
    case "northwest": return [-1, -1];
    case "southeast": return [+1, +1];
    case "southwest": return [-1, +1];
    default: return [0, 0];
  }
}

// -----------------------------------------------------------------------------
// Batched horizon sensing
// -----------------------------------------------------------------------------
async function senseHorizon(pos: Vec3): Promise<string> {
  const dirs: Facing[] = ["north", "east", "south", "west"];
  const diagonalDirs = ["northeast", "northwest", "southeast", "southwest"];
  const allDirs = [...dirs, ...diagonalDirs];

  console.log('SurveyCommand: Starting water detection at position:', pos);

  // Check key distances only: 10, 20, 30, 40, 50
  const distances = [4, 6, 10, 20, 30, 40, 50];

  // Build a single batch of ALL positions (local band + sea band) and dedupe
  const batchPositions: Vec3[] = [];
  type Target = { dir: string; distance: number; locals: Vec3[]; deeps: Vec3[] };
  const targets: Target[] = [];

  for (const dir of allDirs) {
    const [dx, dz] = dirDelta(dir);
    for (const distance of distances) {
      const tx = pos[0] + dx * distance;
      const tz = pos[2] + dz * distance;

      // Local column near player level: y, y-1, y-2
      const locals: Vec3[] = [
        [tx, pos[1],     tz],
        [tx, pos[1] - 1, tz],
        [tx, pos[1] - 2, tz],
      ];

      // Deep: sea-level band 62/63/64
      const deeps: Vec3[] = SEA_BAND.map(Y => [tx, Y, tz] as Vec3);

      // Accumulate
      for (const p of locals) batchPositions.push(p);
      for (const p of deeps)  batchPositions.push(p);

      targets.push({ dir, distance, locals, deeps });
    }
  }

  // Resolve once
  const typeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, batchPositions);

  const localWaterResults: Array<{ dir: string; distance: number; hasWater: boolean }> = [];
  const deepWaterResults: Array<{ dir: string; distance: number; hasWater: boolean }> = [];

  for (const t of targets) {
    const localIds = t.locals.map(p => typeMap.get(encodeBlock(p)));
    const deepIds  = t.deeps.map(p  => typeMap.get(encodeBlock(p)));

    const hasLocalWater = localIds.some(b => typeof b === "number" && isWater(b));
    const hasDeepWater  = deepIds.some(b  => typeof b === "number" && isWater(b));

    if (hasLocalWater) localWaterResults.push({ dir: t.dir, distance: t.distance, hasWater: true });
    if (hasDeepWater)  deepWaterResults.push({ dir: t.dir, distance: t.distance, hasWater: true });
  }

  console.log('SurveyCommand: Water detection results:');
  console.log('Local water results:', localWaterResults);
  console.log('Deep water results:', deepWaterResults);

  // Group by direction
  const localByDir = new Map<string, number[]>();
  const deepByDir  = new Map<string, number[]>();

  localWaterResults.forEach(result => {
    if (!localByDir.has(result.dir)) localByDir.set(result.dir, []);
    localByDir.get(result.dir)!.push(result.distance);
  });

  deepWaterResults.forEach(result => {
    if (!deepByDir.has(result.dir)) deepByDir.set(result.dir, []);
    deepByDir.get(result.dir)!.push(result.distance);
  });

  let waterDescription = "";

  // Report local water with distances
  if (localByDir.size > 0) {
    const localDescriptions: string[] = [];
    for (const [dir, ds] of localByDir) {
      ds.sort((a, b) => a - b);
      localDescriptions.push(`${ds.join(', ')} steps ${dir}`);
    }
    waterDescription += `Local water detected: ${localDescriptions.join(' and ')}.`;
  } else {
    waterDescription += "No local water detected.";
  }

  // Report deep (sea-level band) water with distances
  if (deepByDir.size > 0) {
    if (waterDescription) waterDescription += " ";
    const deepDescriptions: string[] = [];
    for (const [dir, ds] of deepByDir) {
      ds.sort((a, b) => a - b);
      deepDescriptions.push(`${ds.join(', ')} steps ${dir}`);
    }
    waterDescription += `Deep water (sea level) detected: ${deepDescriptions.join(' and ')}.`;
  } else {
    if (waterDescription) waterDescription += " ";
    waterDescription += "No deep water detected.";
  }

  console.log('SurveyCommand: Final water description:', waterDescription);
  return waterDescription;
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

      // Perform horizon sensing (batched)
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







