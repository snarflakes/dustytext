import { createPublicClient, http, type PublicClient, toHex } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getRandomDescriptor, getFlowerDescriptor } from "../../objects";
import { getBiome } from "../../biomeHelper";
import { biomeNamesById, getRandomBiomeDescriptor, getRandomBiomeSensory } from "../../biomes";
import { CommandHandler, CommandContext } from './types';
import { createCoordLinkHTML } from "../../utils/tileLinksHtml";

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
  return toHex((BigInt(entityType) << ENTITY_ID_BITS) | data, { size: 32 }) as `0x${string}`;
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

function displayName(t: number | undefined): string {
  if (typeof t !== "number") return "Air";
  const base = objectNamesById[t] ?? `Unknown(${t})`;
  const d = getFlowerDescriptor(t);
  return d ? `${d.charAt(0).toUpperCase()}${d.slice(1)} ${base}` : base;
}

export class LookCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      console.log('LookCommand: Starting with entityId:', entityId);

      // Get position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      console.log('LookCommand: Fetching position with query:', posQuery);
      
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      console.log('LookCommand: Position response status:', posRes.status);
      
      if (!posRes.ok) {
        throw new Error(`Position fetch failed: ${posRes.status} ${posRes.statusText}`);
      }

      const posJson = await posRes.json();
      console.log('LookCommand: Position JSON:', posJson);
      
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("You float amongst the stars. A sprite, a spark brimming with potential. Try 'spawn' first.");
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
      console.log('LookCommand: Player position:', { x, y, z });

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
        console.log('LookCommand: Orientation fetch failed:', oriError);
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
        
        const groundType = typeMap.get(encodeBlock([x, y - 1, z]));
        const surfaceType = typeMap.get(encodeBlock([x, y, z]));
        
        if (typeof groundType === "number" && objectNamesById[groundType]) {
          const blockName = objectNamesById[groundType].toLowerCase();
          
          // Use cached descriptor or generate new one
          if (!cachedDescriptors.terrain) {
            cachedDescriptors.terrain = getRandomDescriptor(groundType);
          }
          
          const terrainText = cachedDescriptors.terrain ? `${cachedDescriptors.terrain} ${blockName}` : blockName;
          let surfaceText = "";
          
          // Check for surface objects like flowers/grass
          if (typeof surfaceType === "number" && objectNamesById[surfaceType] && surfaceType !== 1) { // 1 is Air
            const surfaceName = displayName(surfaceType);
            surfaceText = ` There is ${surfaceName.toLowerCase()} here.`;
          }
          
          terrainLabel = `You are standing on ${terrainText}.${surfaceText}`;
        } else {
          terrainLabel = "Unexplored terrain. Try 'explore'.";
        }
      } catch (terrainError) {
        console.log('LookCommand: Terrain fetch failed:', terrainError);
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
        console.log('LookCommand: Biome fetch failed:', biomeError);
      }

      // Update cache
      descriptorCache.set(cacheKey, cachedDescriptors);

      // Get biome name for header (without descriptor)
      let biomeHeaderText = "";
      try {
        const biomeId = await getBiome(WORLD_ADDRESS as `0x${string}`, publicClient as PublicClient, [x, y, z]);
        const biomeName = biomeNamesById[biomeId];
        if (biomeName) {
          biomeHeaderText = `<div style="background-color: blue; color: white; padding: 2px 4px; margin: 0; width: 100%; line-height: 1;">[${biomeName}]</div>`;
        }
      } catch (biomeError) {
        console.log('LookCommand: Biome header fetch failed:', biomeError);
      }

      const coordLink = createCoordLinkHTML(x, y, z, 4);
      const lookOutput = `${terrainLabel}${biomeLabel} You are at ${coordLink}, facing ${orientation.label}. `;
      const finalMessage = biomeHeaderText ? `${biomeHeaderText}${lookOutput}` : lookOutput;
      
      console.log('LookCommand: Final message:', finalMessage);

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: finalMessage
      }));
    } catch (error) {
      console.error('LookCommand: Command failed:', error);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Look ${error}` 
      }));
    }
  }
}













