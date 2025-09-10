import { createPublicClient, http, type PublicClient, toHex } from "viem";
import { redstone } from "viem/chains";
import { getTerrainBlockType } from "../../terrain";
import { objectNamesById, getFlowerDescriptor } from "../../objects";
import { CommandHandler, CommandContext } from "./types";
import { addToQueue, queueSizeByAction } from "../../commandQueue"; // adjust path
import { removeFromQueue, isQueued } from "../../commandQueue";
import { isFullyGrown } from './grown';

// -----------------------------------------------------------------------------
// Self-contained encodeBlock (no @dust/world/internal)
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
// Constants / client
// -----------------------------------------------------------------------------
const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ORIENTATION_TABLE = "EntityOrientation";

// If you know the tableId, you can hardcode it here and skip indexer discovery:
const ENTITY_OBJECT_TYPE_TABLE_ID_OVERRIDE = "0x74620000000000000000000000000000456e746974794f626a65637454797065" as `0x${string}`;
//const ENTITY_OBJECT_TYPE_TABLE_ID_OVERRIDE: `0x${string}` | undefined = undefined;

const COL_CH = 27;
function cell(text: string) {
  return `<span class="explore-cell" style="display:inline-block;width:${COL_CH}ch;vertical-align:top;">${text}</span>`;
}

const publicClient = createPublicClient({
  chain: redstone,
  transport: http(),
//  batch: { jsonRpc: { wait: 10 } }, // optional micro-batching
});

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function getOffsetForDirection(direction: string): [number, number, number] {
  switch (direction) {
    case "north": case "n": return [0, -1, 0];
    case "east":  case "e": return [1, 0, 0];
    case "south": case "s": return [0, 1, 0];
    case "west":  case "w": return [-1, 0, 0];
    case "northeast": case "ne": return [1, -1, 0];
    case "northwest": case "nw": return [-1, -1, 0];
    case "southeast": case "se": return [1, 1, 0];
    case "southwest": case "sw": return [-1, 1, 0];
    case "up": case "u": return [0, 0, 1];
    case "down": case "d": return [0, 0, -1];
    default: return [0, 0, 0];
  }
}

// -----------------------------------------------------------------------------
// Selection UI (unchanged)
// -----------------------------------------------------------------------------
interface SelectableBlock {
  x: number; y: number; z: number;
  name: string;
  distance?: number;
  layer: number;
}
//let selectedBlocks: SelectableBlock[] = [];
//let isSelectionMode = false;

function createClickableBlock(block: SelectableBlock): string {
  // "Empty" stays plain
  if (block.name === "Empty") return cell(block.name);

  const blockId = `block-${block.x}-${block.y}-${block.z}`;
  const isAir = block.name.toLowerCase() === "air";
  const isGrownWheat = block.name.includes("WheatSeed(G)");

  // Build class string
  const airClass = isAir ? " air-block" : "";
  const grownClass = isGrownWheat ? " grown" : "";
  const cls = `clickable-block${airClass}${grownClass}`;

  const link = `<span class="${cls}"
      data-block='${JSON.stringify(block)}'
      data-id="${blockId}"
    >${block.name}</span>`;

  return cell(link);
}

type BlockClickDetail = { blockData?: string; blockId?: string };

function resolveBlockFromId(id: string): SelectableBlock | null {
  const el = document.querySelector<HTMLElement>(`.clickable-block[data-id="${id}"]`);
  if (!el) return null;
  const json = el.getAttribute("data-block");
  if (!json) return null;
  try { return JSON.parse(json) as SelectableBlock; } catch { return null; }
}

function handleBlockClick(event: Event) {
  const customEvent = event as CustomEvent<BlockClickDetail>;

  // 1) Resolve the clicked block (from data or id)
  let block: SelectableBlock | null = null;
  if (customEvent.detail?.blockData) {
    try { block = JSON.parse(customEvent.detail.blockData) as SelectableBlock; } catch { 
      // Ignore JSON parse errors, block will remain null
    }
  } else if (customEvent.detail?.blockId) {
    block = resolveBlockFromId(customEvent.detail.blockId);
  }
  if (!block) {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "⚠️ Couldn’t resolve clicked block." }));
    return;
  }

  // 2) Queue via unified queue (human source). Dedupe is handled inside addToQueue.
  const core = { x: block.x, y: block.y, z: block.z, name: block.name, layer: block.layer };
  if (isQueued(currentAction, core)) {
    removeFromQueue(currentAction, core);
    const n = queueSizeByAction(currentAction);
    window.dispatchEvent(new CustomEvent("worker-log", {
      detail: `❌ Removed (${currentAction}) ${block.name} at (${block.x}, ${block.y}, ${block.z}). (${n} remain in ${currentAction})`
    }));
  } else {
    addToQueue(currentAction, [core], "human");
    const n = queueSizeByAction(currentAction);
    window.dispatchEvent(new CustomEvent("worker-log", {
      detail: `✅ Queued (${currentAction}) ${block.name} at (${block.x}, ${block.y}, ${block.z}). (${n} ${currentAction} queued; type 'done' to execute)`
    }));
  }
}

// HMR-safe click binding (prevents stale handlers keeping an old action)
declare global {
  interface Window { __blockClickHandlerExplV3__?: (e: Event) => void }
}

if (typeof window !== "undefined") {
  if (window.__blockClickHandlerExplV3__) {
    window.removeEventListener("block-click", window.__blockClickHandlerExplV3__);
  }
  window.__blockClickHandlerExplV3__ = handleBlockClick;
  window.addEventListener("block-click", handleBlockClick);
}

//old block click listener binder
//if (typeof window !== "undefined" && !(window as Window & { blockClickListenerRegistered?: boolean }).blockClickListenerRegistered) {
//  window.addEventListener("block-click", handleBlockClick);
//  (window as Window & { blockClickListenerRegistered?: boolean }).blockClickListenerRegistered = true;
//}

// -----------------------------------------------------------------------------
// On-chain override reads (EntityObjectType) via multicall, then terrain fallback
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
    out.set(k, value); // will be undefined for "no override" OR explicit zero
  });
  return out;
}

/** Merge: overrides first, then terrain fallback only for misses (bounded concurrency). */
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
        } catch (error) {
          // Ignore terrain lookup errors and leave as undefined
        }
      }
    });
    await Promise.all(workers);
  }

  return map;
}

async function displayName(t: number | undefined, pos?: Vec3): Promise<string> {
  if (typeof t !== "number") return "Air";
  const base = objectNamesById[t] ?? `Unknown(${t})`;
  const d = getFlowerDescriptor(t);
  let name = d ? `${d.charAt(0).toUpperCase()}${d.slice(1)} ${base}` : base;
  
  // Check if WheatSeed is fully grown
  if (base === "WheatSeed" && pos) {
    try {
      const isGrown = await isFullyGrown(pos);
      if (isGrown) {
        name = "WheatSeed(G)";
      }
    } catch (error) {
      // Ignore growth check errors
    }
  }
  
  return name;
}

// ---- Put this near the top of explore.ts (above the class) ----
const ACTIONS = new Set(["mine","water","build","fill","till","plant"]);
export type ActionName = "mine" | "water" | "build" | "fill" | "till" | "plant";

let currentAction: ActionName = "mine";
export function setCurrentAction(a: string) {
  const v = a?.toLowerCase();
  if (ACTIONS.has(v)) currentAction = v as ActionName;
}
export function getCurrentAction() { return currentAction; }

// Direction helpers used by the class:
const DIR_ALIASES: Record<string,string> = {
  n:"north", north:"north", e:"east", east:"east", s:"south", south:"south", w:"west", west:"west",
  ne:"northeast", northeast:"northeast", nw:"northwest", northwest:"northwest",
  se:"southeast", southeast:"southeast", sw:"southwest", southwest:"southwest",
  u:"up", up:"up", d:"down", down:"down",
};
const isDir = (t?: string) => !!t && DIR_ALIASES[t.toLowerCase()] !== undefined;
const normDir = (t: string) => DIR_ALIASES[t.toLowerCase()];

// -----------------------------------------------------------------------------
// Explore command (batch BOTH modes)
// -----------------------------------------------------------------------------
// ---- Drop-in replacement for your ExploreCommand class ----
export class ExploreCommand implements CommandHandler {
  // Accept varargs so we can parse [direction?] [action?]
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {

      // Order-agnostic parse: [direction?] [action?] in any order
      let dirTok: string | undefined;
      let actionTok: ActionName | undefined;

      for (const tok of args) {
        const lower = tok.toLowerCase();
        if (!dirTok && isDir(lower)) dirTok = normDir(lower);             // first direction wins
        if (ACTIONS.has(lower)) actionTok = lower as ActionName;          // last action wins
      }

      if (actionTok) setCurrentAction(actionTok);
      const direction = dirTok; // may be undefined → 3×3 grid mode



      const entityId = encodePlayerEntityId(context.address);

      // Position (indexer)
      const posQuery = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });
      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) throw new Error("No position found for player. Try 'spawn' first.");
      const [posCols, posVals] = posRows;
      const posObj = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(posObj.x ?? 0), y: Number(posObj.y ?? 0), z: Number(posObj.z ?? 0) };

      // Orientation (indexer)
      const oriQuery = `SELECT "orientation" FROM "${ORIENTATION_TABLE}" WHERE "entityId"='${entityId}'`;
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
        const idx = oriCols.indexOf("orientation");
        if (idx !== -1 && oriVals[idx] !== null) {
          const raw = Number(oriVals[idx]);
          orientation = { label: ["north", "east", "south", "west"][raw] ?? "unknown", value: raw };
        }
      }

      const layers = [2, 1, 0, -1, -2, -3];

      if (direction) {
        const valid = ["north","n","east","e","south","s","west","w","northeast","ne","northwest","nw","southeast","se","southwest","sw","up","u","down","d"];
        if (!valid.includes(direction.toLowerCase())) {
          throw new Error(`Invalid direction: ${direction}. Use north/n, east/e, south/s, west/w, northeast/ne, northwest/nw, southeast/se, southwest/sw, up/u, or down/d.`);
        }

        const dir = direction.toLowerCase();

        // Vertical exploration (up/down)
        if (dir === "up" || dir === "u" || dir === "down" || dir === "d") {
          const isUp = dir === "up" || dir === "u";
          const positions: Vec3[] = [];
          for (let offset = 0; offset <= 10; offset++) {
            const actualOffset = isUp ? offset : -offset;
            positions.push([x, y + actualOffset, z]);
          }

          const typeMap = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, positions);

          const lines: string[] = [];
          lines.push(`Exploring ${direction.toUpperCase()} from (${x}, ${y}, ${z}) — clicks will queue <b>${getCurrentAction()}</b>:\n`);

          for (let offset = 0; offset <= 10; offset++) {
            const actualOffset = isUp ? offset : -offset;
            const blockType = typeMap.get(encodeBlock([x, y + actualOffset, z]));
            const blockName = await displayName(blockType, [x, y + actualOffset, z]);
            const blockData: SelectableBlock = {
              x: x,
              y: y + actualOffset,
              z: z,
              name: blockName,
              distance: offset,
              layer: actualOffset,
            };
            const sign = actualOffset >= 0 ? "+" : "";
            lines.push(`${sign}${actualOffset}: ${createClickableBlock(blockData)}`);
          }

          const msg = `<pre class="explore-output">${lines.join("\n")}\n\n💡 Type 'done' to run queued ${getCurrentAction()} tasks.</pre>`;
          window.dispatchEvent(new CustomEvent("worker-log", { detail: msg }));
          return;
        }

        // Horizontal exploration (5-step ray × 5 layers)
        const [dx, dz, dy] = getOffsetForDirection(direction.toLowerCase());
        const columns: { distance: number; coord: string; blocks: string[] }[] = [];

        const positionsDir: Vec3[] = [];
        for (let distance = 1; distance <= 5; distance++) {
          const tx = x + dx * distance;
          const ty = y + dy * distance;
          const tz = z + dz * distance;
          for (const layerOffset of layers) positionsDir.push([tx, ty + layerOffset, tz]);
        }

        const typeMapDir = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, positionsDir);
        const typeAt = (tx: number, ty: number, tz: number) => typeMapDir.get(encodeBlock([tx, ty, tz]));

        for (let distance = 1; distance <= 5; distance++) {
          const tx = x + dx * distance, ty = y + dy * distance, tz = z + dz * distance;
          const column: string[] = [];
          for (const layerOffset of layers) {
            const blockPos: Vec3 = [tx, ty + layerOffset, tz];
            const blockName = await displayName(typeAt(tx, ty + layerOffset, tz), blockPos);
            const blockData: SelectableBlock = {
              x: tx,
              y: ty + layerOffset,
              z: tz,
              name: blockName,
              distance: distance,
              layer: layerOffset,
            };
            column.push(createClickableBlock(blockData));
          }
          columns.push({ distance, coord: `(${tx}, ${ty}, ${tz})`, blocks: column });
        }

        const header = `Exploring ${direction.toUpperCase()} from (${x}, ${y}, ${z}) — clicks will queue <b>${getCurrentAction()}</b>:\n\n`;
        const coordLine = columns.map(col => cell(`Block ${col.distance}`)).join(" ");
        const posLine   = columns.map(col => cell(col.coord)).join(" ");

        const layerLines: string[] = [];
        for (let i = 0; i < layers.length; i++) {
          const dy = layers[i];
          const blockCells = columns.map(col => col.blocks[i]);
          layerLines.push(`${dy >= 0 ? "+" : ""}${dy}: ${blockCells.join(" ")}`);
        }

        const msg = `<pre class="explore-output">${header}${coordLine}\n${posLine}\n${layerLines.join("\n")}\n\n💡 Type 'done' to run queued ${getCurrentAction()} tasks.</pre>`;
        window.dispatchEvent(new CustomEvent("worker-log", { detail: msg }));

      } else {
        // 3×3 grid — single batch
        const directions = [
          [{ label: "NW", dx: -1, dz: -1 }, { label: "N", dx: 0, dz: -1 }, { label: "NE", dx: 1, dz: -1 }],
          [{ label: "W", dx: -1, dz: 0 },   { label: "YOU", dx: 0, dz: 0 }, { label: "E", dx: 1, dz: 0 }],
          [{ label: "SW", dx: -1, dz: 1 },  { label: "S", dx: 0, dz: 1 },   { label: "SE", dx: 1, dz: 1 }],
        ];

        const positionsGrid: Vec3[] = [];
        for (const row of directions) {
          for (const dir of row) {
            for (const dy of layers) positionsGrid.push([x + dir.dx, y + dy, z + dir.dz]);
          }
        }

        const typeMapGrid = await resolveObjectTypesFresh(publicClient as PublicClient, WORLD_ADDRESS as `0x${string}`, positionsGrid);
        const typeAtGrid = (tx: number, ty: number, tz: number) => typeMapGrid.get(encodeBlock([tx, ty, tz]));

        const report: string[] = [];
        for (const row of directions) {
          const headerLine = row.map(dir => {
            const tx = x + dir.dx, tz = z + dir.dz;
            type DirectionLabel = "NW" | "N" | "NE" | "W" | "YOU" | "E" | "SW" | "S" | "SE";
            const arrowMap: Record<DirectionLabel, string> = {
              NW: "<b style='color: white;'>↖</b>",
              N: "<b style='color: white;'>↑</b>", 
              NE: "<b style='color: white;'>↗</b>",
              W: "<b style='color: white;'>←</b>",
              YOU: "<b style='color: white;'>●</b>",
              E: "<b style='color: white;'>→</b>",
              SW: "<b style='color: white;'>↙</b>",
              S: "<b style='color: white;'>↓</b>",
              SE: "<b style='color: white;'>↘</b>"
            };
            const arrow = arrowMap[dir.label as DirectionLabel] || "<b>●</b>";
            return cell(`${arrow}${dir.label} at (${tx}, ${y}, ${tz})`);
          }).join(" ");

          const layerLines: string[] = [];
          for (const dy of layers) {
            const blockCells = await Promise.all(row.map(async dir => {
              const tx = x + dir.dx, tz = z + dir.dz, ty = y + dy;
              const name = await displayName(typeAtGrid(tx, ty, tz), [tx, ty, tz]);
              const blockData: SelectableBlock = { x: tx, y: ty, z: tz, name, layer: dy };
              const clickableBlock = createClickableBlock(blockData);
              const prefix = (dir.label === "YOU" && (dy === 0 || dy === 1)) ? "YOU:" : "";
              return cell(`${dy >= 0 ? "+" : ""}${dy}: ${prefix}${clickableBlock}`);
            }));
            layerLines.push(blockCells.join(" "));
          }
          report.push(`${headerLine}\n${layerLines.join("\n")}`);
        }

        const msg = `<pre class="explore-output">You are at (${x}, ${y}, ${z}), facing ${orientation.label} (${orientation.value}).\n\n${report.join("\n\n")}\n\n💡 Click blocks to queue <b>${getCurrentAction()}</b>, then type 'done'.</pre>`;
        window.dispatchEvent(new CustomEvent("worker-log", { detail: msg }));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ Explore failed: ${error}` }));
    }
  }
}


// Export functions for done command
//export { selectedBlocks };
//export function clearSelection() {
//  clearUnified();     // clears unified queue + releases owner/pause
//  isSelectionMode = false;
//}





































