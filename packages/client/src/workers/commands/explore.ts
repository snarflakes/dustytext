import { createPublicClient, http, type PublicClient } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getFlowerDescriptor } from "../../objects";
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

function getOffsetForDirection(direction: string): [number, number] {
  switch (direction) {
    case "north": return [0, -1];
    case "east": return [1, 0];
    case "south": return [0, 1];
    case "west": return [-1, 0];
    default: return [0, 0];
  }
}

async function scanVerticalColumn(x: number, y: number, z: number): Promise<string[]> {
  const layers: number[] = [2, 1, 0, -1, -2];
  const names: string[] = [];

  for (const dy of layers) {
    const pos = [x, y + dy, z] as [number, number, number];
    try {
      const type = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, pos);
      let name = typeof type === "number" ? objectNamesById[type] ?? `Unknown(${type})` : "Empty";
      
      // Add capitalized descriptor in front for flowers and mushrooms
      if (typeof type === "number") {
        const descriptor = getFlowerDescriptor(type);
        if (descriptor) {
          const capitalizedDescriptor = descriptor.charAt(0).toUpperCase() + descriptor.slice(1);
          name = `${capitalizedDescriptor} ${name}`;
        }
      }
      
      names.push(`${dy >= 0 ? "+" : ""}${dy}: ${name}`);
    } catch {
      names.push(`${dy >= 0 ? "+" : ""}${dy}: [error]`);
    }
  }

  return names;
}

export class ExploreCommand implements CommandHandler {
  async execute(context: CommandContext, direction?: string): Promise<void> {
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

      if (direction) {
        // Directional exploration (5 blocks in specified direction)
        const validDirections = ["north", "east", "south", "west"];
        if (!validDirections.includes(direction.toLowerCase())) {
          throw new Error(`Invalid direction: ${direction}. Use north, east, south, or west.`);
        }

        const [dx, dz] = getOffsetForDirection(direction.toLowerCase());
        const layers = [2, 1, 0, -1, -2];
        const columns = [];

        // Collect data for all 5 blocks
        for (let distance = 1; distance <= 5; distance++) {
          const tx = x + (dx * distance);
          const tz = z + (dz * distance);
          const column = [];

          for (const dy of layers) {
            const pos = [tx, y + dy, tz] as [number, number, number];
            try {
              const type = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, pos);
              let name = typeof type === "number" ? objectNamesById[type] ?? `Unknown(${type})` : "Empty";
              
              if (typeof type === "number") {
                const descriptor = getFlowerDescriptor(type);
                if (descriptor) {
                  const capitalizedDescriptor = descriptor.charAt(0).toUpperCase() + descriptor.slice(1);
                  name = `${capitalizedDescriptor} ${name}`;
                }
              }
              
              column.push(name);
            } catch {
              column.push("[error]");
            }
          }

          columns.push({
            distance,
            coord: `(${tx}, ${y}, ${tz})`,
            blocks: column
          });
        }

        // Format as columns
        const header = `Exploring ${direction.toUpperCase()} from (${x}, ${y}, ${z}):\n\n`;
        const coordLine = columns.map(col => `Block ${col.distance}`.padEnd(15)).join(" ");
        const posLine = columns.map(col => col.coord.padEnd(15)).join(" ");
        
        const layerLines = [];
        for (let i = 0; i < layers.length; i++) {
          const dy = layers[i];
          const line = columns.map(col => col.blocks[i].padEnd(15)).join(" ");
          layerLines.push(`${dy >= 0 ? "+" : ""}${dy}: ${line}`);
        }

        const msg = header + coordLine + "\n" + posLine + "\n" + layerLines.join("\n");
        
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: msg 
        }));
      } else {
        // Original explore behavior (all 4 directions around player)
        const directions = ["north", "east", "south", "west"] as const;
        const report: string[] = [];

        for (const dir of directions) {
          const [dx, dz] = getOffsetForDirection(dir);
          const tx = x + dx;
          const tz = z + dz;
          const column = await scanVerticalColumn(tx, y, tz);
          report.push(`\n${dir.toUpperCase()} at (${tx}, ${y}, ${tz}):\n${column.map(l => "  " + l).join("\n")}`);
        }

        const msg = `You are at (${x}, ${y}, ${z}), facing ${orientation.label} (${orientation.value}).${report.join("\n")}`;
        
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: msg 
        }));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Explore failed: ${error}` 
      }));
    }
  }
}








