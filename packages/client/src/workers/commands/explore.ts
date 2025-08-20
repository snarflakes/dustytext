import { createPublicClient, http, type PublicClient } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getFlowerDescriptor } from "../../objects";
import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ORIENTATION_TABLE = "EntityOrientation";

// Column width for explore formatting
const COL_CH = 27; // width of each column in monospace "characters" (increased from 18)

/** wrap any text in a fixed-width cell */
function cell(text: string) {
  return `<span class="explore-cell" style="display:inline-block;width:${COL_CH}ch;vertical-align:top;">${text}</span>`;
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

function getOffsetForDirection(direction: string): [number, number] {
  switch (direction) {
    case "north": case "n": return [0, -1];
    case "east": case "e": return [1, 0];
    case "south": case "s": return [0, 1];
    case "west": case "w": return [-1, 0];
    case "northeast": case "ne": return [1, -1];
    case "northwest": case "nw": return [-1, -1];
    case "southeast": case "se": return [1, 1];
    case "southwest": case "sw": return [-1, 1];
    default: return [0, 0];
  }
}

// Add interface for block selection
interface SelectableBlock {
  x: number;
  y: number;
  z: number;
  name: string;
  distance?: number;
  layer: number;
}

let selectedBlocks: SelectableBlock[] = [];
let isSelectionMode = false;

function createClickableBlock(block: SelectableBlock): string {
  if (block.name === "Air" || block.name === "Empty") {
    return cell(block.name);
  }

  const blockId = `block-${block.x}-${block.y}-${block.z}`;
  const link = `<span class="clickable-block"
      data-block='${JSON.stringify(block)}'
      data-id="${blockId}"
      style="text-decoration: underline; cursor: pointer; color: #3b82f6;"
    >${block.name}</span>`;

  return cell(link);
}

function handleBlockClick(event: Event) {
  const customEvent = event as CustomEvent;
  const blockData = JSON.parse(customEvent.detail.blockData);
  
  if (selectedBlocks.find(b => b.x === blockData.x && b.y === blockData.y && b.z === blockData.z)) {
    // Remove if already selected
    selectedBlocks = selectedBlocks.filter(b => !(b.x === blockData.x && b.y === blockData.y && b.z === blockData.z));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `❌ Removed ${blockData.name} at (${blockData.x}, ${blockData.y}, ${blockData.z}) from mining queue. ${selectedBlocks.length} blocks queued.` 
    }));
  } else {
    // Add to selection
    selectedBlocks.push(blockData);
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `✅ Added ${blockData.name} at (${blockData.x}, ${blockData.y}, ${blockData.z}) to mining queue. ${selectedBlocks.length} blocks queued.` 
    }));
  }
  
  if (selectedBlocks.length > 0 && !isSelectionMode) {
    isSelectionMode = true;
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `💡 Type 'done' when you have selected all desired blocks to mine.` 
    }));
  }
}

// Listen for block clicks - use a flag to prevent multiple registrations
if (typeof window !== 'undefined' && !(window as Window & { blockClickListenerRegistered?: boolean }).blockClickListenerRegistered) {
  window.addEventListener('block-click', handleBlockClick);
  (window as Window & { blockClickListenerRegistered?: boolean }).blockClickListenerRegistered = true;
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
        const validDirections = ["north", "n", "east", "e", "south", "s", "west", "w", "northeast", "ne", "northwest", "nw", "southeast", "se", "southwest", "sw"];
        if (!validDirections.includes(direction.toLowerCase())) {
          throw new Error(`Invalid direction: ${direction}. Use north/n, east/e, south/s, west/w, northeast/ne, northwest/nw, southeast/se, or southwest/sw.`);
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
                  name = `${capitalizedDescriptor} ${name}` as string;
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

        // Format as columns with clickable blocks
        const header = `Exploring ${direction.toUpperCase()} from (${x}, ${y}, ${z}):\n\n`;

        // use fixed-width cells instead of padEnd/spaces
        const coordLine = columns.map(col => cell(`Block ${col.distance}`)).join(" ");
        const posLine   = columns.map(col => cell(col.coord)).join(" ");

        const layerLines: string[] = [];
        for (let i = 0; i < layers.length; i++) {
          const dy = layers[i];
          const blockCells = columns.map((col) => {
            const blockData: SelectableBlock = {
              x: x + (dx * col.distance),
              y: y + dy,
              z: z + (dz * col.distance),
              name: col.blocks[i],
              distance: col.distance,
              layer: dy
            };
            return createClickableBlock(blockData); // already returns a fixed-width cell
          });

          // add space between columns for alignment
          layerLines.push(`${dy >= 0 ? "+" : ""}${dy}: ${blockCells.join(" ")}`);
        }

        const msg = `<pre class="explore-output">${header}${coordLine}\n${posLine}\n${layerLines.join("\n")}</pre>`;

        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: msg 
        }));
      } else {
        // Original explore behavior - now as 3x3 grid of directional columns laid out horizontally
        const layers = [2, 1, 0, -1, -2];
        const directions = [
          [
            { label: "NW", dx: -1, dz: -1 },
            { label: "N", dx: 0, dz: -1 },
            { label: "NE", dx: 1, dz: -1 }
          ],
          [
            { label: "W", dx: -1, dz: 0 },
            { label: "YOU", dx: 0, dz: 0 },
            { label: "E", dx: 1, dz: 0 }
          ],
          [
            { label: "SW", dx: -1, dz: 1 },
            { label: "S", dx: 0, dz: 1 },
            { label: "SE", dx: 1, dz: 1 }
          ]
        ];

        const report: string[] = [];

        for (const row of directions) {
          // Create header line with direction labels
          const headerLine = row.map(dir => {
            const tx = x + dir.dx;
            const tz = z + dir.dz;
            const arrow = {
              "NW": "<b>↖</b>", "N": "<b>↑</b>", "NE": "<b>↗</b>",
              "W": "<b>←</b>", "YOU": "<b>●</b>", "E": "<b>→</b>", 
              "SW": "<b>↙</b>", "S": "<b>↓</b>", "SE": "<b>↘</b>"
            }[dir.label] || "<b>●</b>";
            return cell(`${arrow}${dir.label} at (${tx}, ${y}, ${tz})`);
          }).join(" ");

          // Create lines for each layer
          const layerLines: string[] = [];
          for (const dy of layers) {
            const blockCells = await Promise.all(row.map(async dir => {
              const tx = x + dir.dx;
              const tz = z + dir.dz;
              const currentY = y + dy;
              
              try {
                const pos = [tx, currentY, tz] as [number, number, number];
                const type = await getTerrainBlockType(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, pos);
                let name: string = typeof type === "number" ? objectNamesById[type] ?? `Unknown(${type})` : "Air";
                
                if (typeof type === "number") {
                  const descriptor = getFlowerDescriptor(type);
                  if (descriptor) {
                    const capitalizedDescriptor = descriptor.charAt(0).toUpperCase() + descriptor.slice(1);
                    name = `${capitalizedDescriptor} ${name}`;
                  }
                }
                
                const blockData: SelectableBlock = {
                  x: tx,
                  y: currentY,
                  z: tz,
                  name: name,
                  layer: dy
                };
                
                const clickableBlock = createClickableBlock(blockData);
                const prefix = (dir.label === "YOU" && (dy === 0 || dy === 1)) ? "YOU:" : "";
                return cell(`${dy >= 0 ? "+" : ""}${dy}: ${prefix}${clickableBlock}`);
              } catch {
                return cell(`${dy >= 0 ? "+" : ""}${dy}: [error]`);
              }
            }));
            
            layerLines.push(blockCells.join(" "));
          }
          
          report.push(`${headerLine}\n${layerLines.join("\n")}`);
        }

        const msg = `<pre class="explore-output">You are at (${x}, ${y}, ${z}), facing ${orientation.label} (${orientation.value}).\n\n${report.join("\n\n")}</pre>`;
        
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

// Export functions for done command
export { selectedBlocks };
export function clearSelection() {
  selectedBlocks.splice(0, selectedBlocks.length); // Clear array completely
  isSelectionMode = false;
  console.log('Selection cleared, selectedBlocks length:', selectedBlocks.length);
}




































