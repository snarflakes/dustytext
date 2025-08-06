import { createPublicClient, http, type PublicClient } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById } from "../../objects";
import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ORIENTATION_TABLE = "EntityOrientation";

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

      // Get position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("No position found for player. Try 'spawn' first.");
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };

      // Get orientation
      const oriQuery = `SELECT "orientation" FROM "${ORIENTATION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const oriRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: oriQuery }]),
      });

      const oriJson = await oriRes.json();
      const oriRows = oriJson?.result?.[0];
      let orientation = { label: "north", value: 0 };
      
      if (Array.isArray(oriRows) && oriRows.length >= 2) {
        const [oriCols, oriVals] = oriRows;
        const index = oriCols.indexOf("orientation");
        if (index !== -1 && oriVals[index] !== null) {
          const raw = Number(oriVals[index]);
          orientation = { label: ["north", "east", "south", "west"][raw] ?? "unknown", value: raw };
        }
      }

      // Get terrain
      const blockType = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, [x, y - 1, z]);
      const blockName = typeof blockType === "number" && objectNamesById[blockType];
      const terrainLabel = blockName ? `You are standing on ${blockName}.` : "Unexplored terrain. Try 'explore'.";

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `You are at (${x}, ${y}, ${z}), facing ${orientation.label}. ${terrainLabel}` 
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Look failed: ${error}` 
      }));
    }
  }
}



