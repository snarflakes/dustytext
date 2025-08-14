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
        throw new Error("No position found for player. Try 'spawn' first.");
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
          biomeLabel = ` You are in the ${biomeText} biome.${sensoryText}`;
        }
      } catch (biomeError) {
        console.log('LookCommand: Biome fetch failed:', biomeError);
      }

      // Update cache
      descriptorCache.set(cacheKey, cachedDescriptors);

      const finalMessage = `${terrainLabel}${biomeLabel} You are at (${x}, ${y}, ${z}), facing ${orientation.label}. `;
      console.log('LookCommand: Final message:', finalMessage);

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: finalMessage
      }));
    } catch (error) {
      console.error('LookCommand: Command failed:', error);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Look failed: ${error}` 
      }));
    }
  }
}

































