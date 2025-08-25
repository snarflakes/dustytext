import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { createPublicClient, http, type PublicClient, toHex } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById } from "../../objects";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

// -----------------------------------------------------------------------------
// Block encoding (copied from other command files)
// -----------------------------------------------------------------------------
type Vec3 = [number, number, number];

const BYTES_32_BITS = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS = BYTES_32_BITS - ENTITY_TYPE_BITS; // 248
const ENTITY_TYPE_BLOCK = 0x03; // matches EntityTypes.Block

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n)); // two's complement pack for int32
}
function packVec3([x, y, z]: Vec3): bigint {
  const X = toU32(x), Y = toU32(y), Z = toU32(z);
  return (X << 64n) | (Y << 32n) | Z; // 96 bits
}
function encodeBlock([x, y, z]: Vec3): `0x${string}` {
  const entityId = packVec3([x, y, z]);
  const full = (BigInt(ENTITY_TYPE_BLOCK) << ENTITY_ID_BITS) | entityId;
  return toHex(full, { size: 32 });
}

async function readEntityObjectTypesMulticall(
  client: PublicClient,
  world: `0x${string}`,
  positions: Vec3[]
): Promise<Map<`0x${string}`, number | undefined>> {
  if (!positions.length) return new Map();
  
  const calls = positions.map(pos => ({
    address: world,
    abi: [{ 
      type: "function", 
      name: "getRecord", 
      inputs: [{ type: "bytes32" }, { type: "bytes32" }], 
      outputs: [{ type: "bytes" }],
      stateMutability: "view"
    }] as const,
    functionName: "getRecord",
    args: [
      "0x746200000000000000000000000000004f626a6563745479706500000000000000" as `0x${string}`,
      encodeBlock(pos)
    ]
  }));

  try {
    const results = await client.multicall({ contracts: calls });
    const map = new Map<`0x${string}`, number | undefined>();
    
    for (let i = 0; i < positions.length; i++) {
      const key = encodeBlock(positions[i]);
      const result = results[i];
      
      if (result.status === "success" && result.result) {
        const bytes = result.result as `0x${string}`;
        if (bytes && bytes !== "0x" && bytes.length >= 4) {
          const value = parseInt(bytes.slice(2, 4), 16);
          map.set(key, value);
        }
      }
    }
    
    return map;
  } catch (error) {
    console.error("Multicall failed:", error);
    return new Map();
  }
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

const waterAbi = parseAbi([
  'function wetFarmland(bytes32 caller, uint96 coord, uint16 bucketSlot) returns (bytes32)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function packCoord96(x: number, y: number, z: number): bigint {
  const X = BigInt.asUintN(32, BigInt(x));
  const Y = BigInt.asUintN(32, BigInt(y)); 
  const Z = BigInt.asUintN(32, BigInt(z));
  return (X << 64n) | (Y << 32n) | Z;
}

interface SelectableBlock {
  x: number;
  y: number;
  z: number;
  name: string;
  distance?: number;
  layer?: number;
}

let selectedBlocks: SelectableBlock[] = [];
let isSelectionMode = false;

export function clearSelection() {
  selectedBlocks = [];
  // Clear global flags
  (globalThis as typeof globalThis & { 
    waterSelectionMode?: boolean;
    waterSelectedBlocks?: SelectableBlock[];
  }).waterSelectionMode = false;
  (globalThis as typeof globalThis & { 
    waterSelectionMode?: boolean;
    waterSelectedBlocks?: SelectableBlock[];
  }).waterSelectedBlocks = [];
}

function cell(content: string): string {
  return content.padEnd(20, ' ').substring(0, 20);
}

function createClickableBlock(blockData: SelectableBlock): string {
  if (blockData.name === "Air" || blockData.name === "Empty") return cell(blockData.name);
  const blockDataStr = JSON.stringify(blockData);
  const link = `<span class="clickable-block"
      data-block='${blockDataStr}'
      style="text-decoration: underline; cursor: pointer; color: #3b82f6;"
    >${blockData.name}</span>`;
  return cell(link);
}

// Remove the unused handleBlockClick function entirely

// Remove the separate listener registration - use the shared one from explore

function displayName(t: number | undefined): string {
  if (typeof t !== "number") return "Air";
  return objectNamesById[t] ?? `Unknown(${t})`;
}

export class WaterCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      // Check for equipped water bucket
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
      
      if (!equippedTool || !equippedTool.type.toLowerCase().includes('water') || !equippedTool.type.toLowerCase().includes('bucket')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You must equip a water bucket to water farmland. Use 'equip water bucket' first." 
        }));
        return;
      }

      // Get player position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      if (!posRes.ok) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Could not get position" 
        }));
        return;
      }

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ No position found" 
        }));
        return;
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const x = Number(pos.x ?? 0);
      const y = Number(pos.y ?? 0);
      const z = Number(pos.z ?? 0);

      // Create 3x3 grid around player
      const publicClient = createPublicClient({
        chain: redstone,
        transport: http(),
      });

      const directions = [
        [{ label: "NW", dx: -1, dz: -1 }, { label: "N", dx: 0, dz: -1 }, { label: "NE", dx: 1, dz: -1 }],
        [{ label: "W", dx: -1, dz: 0 },   { label: "YOU", dx: 0, dz: 0 }, { label: "E", dx: 1, dz: 0 }],
        [{ label: "SW", dx: -1, dz: 1 },  { label: "S", dx: 0, dz: 1 },   { label: "SE", dx: 1, dz: 1 }],
      ];

      const layers = [-1, 0, 1]; // Check ground level and above/below
      const positionsGrid: Vec3[] = [];
      
      for (const row of directions) {
        for (const dir of row) {
          for (const dy of layers) {
            positionsGrid.push([x + dir.dx, y + dy, z + dir.dz]);
          }
        }
      }

      const typeMapGrid = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, positionsGrid);
      const typeAtGrid = (tx: number, ty: number, tz: number) => typeMapGrid.get(encodeBlock([tx, ty, tz]));

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💧 Watering interface - Click on farmland blocks to add them to watering queue:` 
      }));

      // Set global water selection mode that the shared block click handler can detect
      (globalThis as typeof globalThis & { 
        waterSelectionMode: boolean;
        waterSelectedBlocks: SelectableBlock[];
      }).waterSelectionMode = true;
      (globalThis as typeof globalThis & { 
        waterSelectionMode: boolean;
        waterSelectedBlocks: SelectableBlock[];
      }).waterSelectedBlocks = selectedBlocks;

      // Remove the unused isSelectionMode since we're using global flags

      const report: string[] = [];
      for (const row of directions) {
        const headerLine = row.map(dir => {
          const tx = x + dir.dx, tz = z + dir.dz;
          const arrow = dir.label === "YOU" ? "<b style='color: white;'>●</b>" : "";
          return cell(`${arrow}${dir.label} at (${tx}, ${y}, ${tz})`);
        }).join(" ");

        const layerLines: string[] = [];
        for (const dy of layers) {
          const blockCells = row.map(dir => {
            const tx = x + dir.dx, tz = z + dir.dz, ty = y + dy;
            const blockType = typeAtGrid(tx, ty, tz);
            const name = displayName(blockType);
            const blockData: SelectableBlock = { x: tx, y: ty, z: tz, name, layer: dy };
            const clickableBlock = createClickableBlock(blockData);
            const prefix = (dir.label === "YOU" && (dy === 0 || dy === 1)) ? "YOU:" : "";
            return cell(`${dy >= 0 ? "+" : ""}${dy}: ${prefix}${clickableBlock}`);
          });
          layerLines.push(blockCells.join(" "));
        }
        report.push(`${headerLine}\n${layerLines.join("\n")}`);
      }

      const msg = `<pre class="explore-output">💧 Watering interface - Click on farmland blocks:\n\n${report.join("\n\n")}</pre>`;
      window.dispatchEvent(new CustomEvent("worker-log", { detail: msg }));

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💡 Click on farmland blocks to select them for watering, then type 'done' to water all selected blocks.` 
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Water command failed: ${error}` 
      }));
    }
  }
}

// Export for done command to use
export { selectedBlocks };

// Function to water a single block
export async function waterSingleBlock(context: CommandContext, block: SelectableBlock): Promise<boolean> {
  try {
    const entityId = encodePlayerEntityId(context.address);
    const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
    
    if (!equippedTool || !equippedTool.type.toLowerCase().includes('water') || !equippedTool.type.toLowerCase().includes('bucket')) {
      throw new Error("No water bucket equipped");
    }

    const coord = packCoord96(block.x, block.y, block.z);

    const data = encodeFunctionData({
      abi: waterAbi,
      functionName: 'wetFarmland',
      args: [entityId, coord, equippedTool.slot],
    });

    const txHash = await context.sessionClient.sendTransaction({
      to: WORLD_ADDRESS,
      data,
      gas: 300000n,
    });

    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `💧 Watered farmland at (${block.x}, ${block.y}, ${block.z}). Tx: ${txHash}` 
    }));

    return true;
  } catch (error) {
    const errorMessage = String(error);
    
    if (errorMessage.includes('Not farmland')) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Block at (${block.x}, ${block.y}, ${block.z}) is not farmland.` 
      }));
    } else if (errorMessage.includes('Must use a Water Bucket')) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ You must equip a water bucket to water farmland.` 
      }));
    } else {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Failed to water block at (${block.x}, ${block.y}, ${block.z}): ${error}` 
      }));
    }
    
    return false;
  }
}





