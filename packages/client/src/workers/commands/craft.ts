import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";
import {
  findRecipesByDisplayName,
  formatObjectName,
  Recipe,
} from "../../recipes";
import { OBJECT_TYPES } from "../../objectTypes";
import type { ObjectName } from "../../objects";
import { queryIndexer } from "./queryIndexer";

// Keep consistent with queryIndexer.ts (single source of truth is best)
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

// --- Table names used by the indexer ---
const INVENTORY_SLOT_TABLE = "InventorySlot";
const RECIPES_TABLE = "Recipes";
const ENTITY_POS_TABLE = "EntityPosition";
const ENTITY_TYPE_TABLE = "EntityObjectType";

const craftAbi = parseAbi([
  "function craft(bytes32 caller, bytes32 recipeId, (uint16,uint16)[] inputs)",
  "function craftWithStation(bytes32 caller, bytes32 station, bytes32 recipeId, (uint16,uint16)[] inputs)",
]);

// ---------- helpers ----------
function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

// OBJECT_TYPES is Record<number, string>; build reverse map: ObjectName -> typeId
const TYPE_ID_BY_NAME: Record<string, number> = (() => {
  const src = OBJECT_TYPES as unknown as Record<number, string>;
  const entries = Object.entries(src).map(
    ([idStr, name]: [string, string]) => [name, Number(idStr)] as const
  );
  return Object.fromEntries(entries);
})();

const objectTypesById = OBJECT_TYPES as Record<number, string>;

// Runtime constants for meta "Any*" expansion
const ANY_PLANKS: ReadonlyArray<ObjectName> = [
  "OakPlanks",
  "BirchPlanks",
  "JunglePlanks",
  "SakuraPlanks",
  "AcaciaPlanks",
  "SprucePlanks",
  "DarkOakPlanks",
  "MangrovePlanks",
] as const;

const ANY_LOGS: ReadonlyArray<ObjectName> = [
  "OakLog",
  "BirchLog",
  "JungleLog",
  "SakuraLog",
  "AcaciaLog",
  "SpruceLog",
  "DarkOakLog",
  "MangroveLog",
] as const;

const ANY_LEAVES: ReadonlyArray<ObjectName> = [
  "OakLeaf",
  "BirchLeaf",
  "JungleLeaf",
  "SakuraLeaf",
  "AcaciaLeaf",
  "SpruceLeaf",
  "DarkOakLeaf",
  "MangroveLeaf",
] as const;

// ---------- indexer I/O & row types ----------
type RecipeRow = [
  string, // recipeId (bytes32)
  string, // stationTypeId (stringified number; 0 if hand)
  string, // craftingTime
  string[], // inputTypes (type ids as strings)
  string[], // inputAmounts
  string[], // outputTypes (type ids as strings)
  string[], // outputAmounts
];

type InventoryItem = {
  slot: number;
  entityId: string;
  objectType: string;
  amount: number;
};

async function getPlayerInventory(owner: `0x${string}`): Promise<InventoryItem[]> {
  const sql = `SELECT "slot","entityId","objectType","amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner"='${owner}'`;
  const rows = await queryIndexer(sql, "getPlayerInventory");
  return rows.slice(1).map((row: unknown[]) => ({
    slot: parseInt(row[0] as string, 10),
    entityId: row[1] as string,
    objectType:
      OBJECT_TYPES[parseInt(row[2] as string, 10)] || `Unknown(${row[2]})`,
    amount: parseInt(row[3] as string, 10),
  }));
}

async function getAvailableRecipesRows() {
  const sql = `SELECT "recipeId","stationTypeId","craftingTime","inputTypes","inputAmounts","outputTypes","outputAmounts" FROM "${RECIPES_TABLE}"`;
  const rows = await queryIndexer(sql, "getAvailableRecipesRows");
  return rows.slice(1) as RecipeRow[];
}

async function getPlayerPosition(entityId: `0x${string}`) {
  const sql = `SELECT "x","y","z" FROM "${ENTITY_POS_TABLE}" WHERE "entityId"='${entityId}'`;
  const rows = await queryIndexer(sql, "getPlayerPosition");
  if (rows.length < 2) return null;
  const r = rows[1];
  return {
    x: parseInt(r[0] as string, 10),
    y: parseInt(r[1] as string, 10),
    z: parseInt(r[2] as string, 10),
  };
}

// --- tiny retry for flaky 500s (like shared memory full) ---
async function queryWithRetry(sql: string, tag: string, tries = 2) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await queryIndexer(sql, `${tag}${i ? `_retry${i}` : ""}`);
    } catch (e: unknown) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (!/HTTP 500|No space left on device/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

// Small helper: fetch the objectType for a single entityId (no joins, no IN)
async function getEntityObjectType(entityId: `0x${string}`): Promise<number | null> {
  const sql = `SELECT "objectType" FROM "${ENTITY_TYPE_TABLE}" WHERE "entityId"='${entityId}' LIMIT 1`;
  const rows = await queryWithRetry(sql, "getEntityObjectType");
  if (rows.length < 2) return null;
  const typeStr = rows[1][0] as string;
  const typeId = parseInt(typeStr, 10);
  return Number.isFinite(typeId) ? typeId : null;
}

// Get the entityId at an exact (x,y,z) — avoids JOIN/BETWEEN/IN
async function getEntityIdAt(x: number, y: number, z: number): Promise<`0x${string}` | null> {
  const sql = `SELECT "entityId" FROM "${ENTITY_POS_TABLE}" WHERE "x"=${x} AND "y"=${y} AND "z"=${z} LIMIT 1`;
  const rows = await queryWithRetry(sql, "getEntityIdAt");
  if (rows.length < 2) return null;
  return rows[1][0] as `0x${string}`;
}

/**
 * Find the station entity exactly 1 block north of the player (z - 1).
 * Validates the type matches the required stationName.
 */
async function getNorthStationEntityId(
  playerEntityId: `0x${string}`,
  stationName: ObjectName
): Promise<{ entityId: `0x${string}`; x: number; y: number; z: number } | null> {
  const pos = await getPlayerPosition(playerEntityId);
  if (!pos) return null;

  const nx = pos.x;
  const ny = pos.y;
  const nz = pos.z - 1; // world north = z - 1 (as seen in your explore output)

  const entityId = await getEntityIdAt(nx, ny, nz);
  if (!entityId) return null;

  const typeId = await getEntityObjectType(entityId);
  const needId = TYPE_ID_BY_NAME[stationName];
  if (typeId !== needId) return null;

  return { entityId, x: nx, y: ny, z: nz };
}

// ---------- recipe row matching ----------
function rowsMatchRecipe(row: RecipeRow, target: Recipe) {
  const [, stationTypeId, , inputTypes, inputAmounts, outputTypes, outputAmounts] = row;

  const rowStationId = parseInt(stationTypeId, 10);
  const rowHasStation = rowStationId !== 0;

  // Station presence/type must match local target when comparing
  if (!!target.station !== rowHasStation) return false;
  if (rowHasStation) {
    const rowStationName = objectTypesById[rowStationId] as ObjectName | undefined;
    if (!rowStationName || rowStationName !== target.station) return false;
  }

  const rowInputTypeIds = inputTypes.map((s) => parseInt(s, 10));
  const rowOutputTypeIds = outputTypes.map((s) => parseInt(s, 10));
  const rowInputAmts = inputAmounts.map((s) => parseInt(s, 10));
  const rowOutputAmts = outputAmounts.map((s) => parseInt(s, 10));

  // Outputs: order-insensitive compare (by typeId, amount)
  if (rowOutputTypeIds.length !== target.outputs.length) return false;
  const targetOutPairs = target.outputs.map(
    ([n, a]) => [TYPE_ID_BY_NAME[n], a] as const
  );
  const sortPairs = (arr: ReadonlyArray<readonly [number, number]>) =>
    [...arr].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rowOutPairs = sortPairs(
    rowOutputTypeIds.map((id, i) => [id, rowOutputAmts[i]] as const)
  );
  const tgtOutPairs = sortPairs(targetOutPairs);
  for (let i = 0; i < rowOutPairs.length; i++) {
    if (
      rowOutPairs[i][0] !== tgtOutPairs[i][0] ||
      rowOutPairs[i][1] !== tgtOutPairs[i][1]
    )
      return false;
  }

  // Inputs: same length; amounts must match; type must match unless target is Any*
  if (rowInputTypeIds.length !== target.inputs.length) return false;
  for (let i = 0; i < target.inputs.length; i++) {
    const [needName, needAmt] = target.inputs[i];
    const rowId = rowInputTypeIds[i];
    const rowAmt = rowInputAmts[i];
    if (rowAmt !== needAmt) return false;
    const isAnyMeta = needName.startsWith("Any");
    if (!isAnyMeta) {
      if (TYPE_ID_BY_NAME[needName] !== rowId) return false;
    }
  }

  return true;
}

function findMatchingRecipeInfo(
  available: RecipeRow[],
  targetRecipe: Recipe
): { recipeId: string; stationTypeId: string } | null {
  for (const row of available) {
    if (rowsMatchRecipe(row, targetRecipe)) {
      const [recipeId, stationTypeId] = row;
      return { recipeId, stationTypeId };
    }
  }
  return null;
}

// ---------- wooden tools override ----------
const WOODEN_TOOL_NAMES = new Set<ObjectName>([
  "WoodenAxe",
  "WoodenPick",
  "WoodenHoe",
  "WoodenWhacker",
]);

function recipeProducesWoodenTool(r: Recipe) {
  return r.outputs.some(([out]) => WOODEN_TOOL_NAMES.has(out));
}

// ---------- inventory selection with 1 retry on shortfall ----------
async function selectInputsWithRetry(
  caller: `0x${string}`,
  recipe: Recipe
): Promise<{ inputSlots: Array<{ slot: number; amount: number }> } | { error: string }> {
  const attempt = async (): Promise<{ ok: boolean; inputSlots?: Array<{ slot: number; amount: number }>; shortfall?: string }> => {
    const inventory = await getPlayerInventory(caller);
    if (!Array.isArray(inventory) || inventory.length === 0) {
      return { ok: false, shortfall: "❌ Inventory is empty or unavailable" };
    }

    const inputSlots: Array<{ slot: number; amount: number }> = [];
    const expand = (t: ObjectName): ReadonlyArray<ObjectName> =>
      t === "AnyPlank"
        ? ANY_PLANKS
        : t === "AnyLog"
        ? ANY_LOGS
        : t === "AnyLeaf"
        ? ANY_LEAVES
        : [t];

    for (const [needType, needAmt] of recipe.inputs) {
      let remaining = needAmt;
      const allow = new Set(expand(needType));

      for (const item of inventory) {
        if (remaining <= 0) break;
        if (typeof item.objectType !== "string") continue;
        if (!allow.has(item.objectType as ObjectName)) continue;

        const use = Math.min(item.amount, remaining);
        if (use > 0) {
          inputSlots.push({ slot: item.slot, amount: use });
          remaining -= use;
        }
      }

      if (remaining > 0) {
        return { ok: false, shortfall: `❌ Missing ${remaining} ${needType} for crafting` };
      }
    }

    return { ok: true, inputSlots };
  };

  // First try
  const first = await attempt();
  if (first.ok) return { inputSlots: first.inputSlots! };

  // Retry once (indexer lag)
  const second = await attempt();
  if (second.ok) return { inputSlots: second.inputSlots! };

  return { error: first.shortfall || second.shortfall || "❌ Unknown inventory error" };
}

// ---------- main command ----------
export class CraftCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const log = (detail: string) =>
      window.dispatchEvent(new CustomEvent("worker-log", { detail }));

    try {
      const itemName = args.join(" ").trim();
      if (!itemName) {
        log("❓ Usage: craft <item name> (e.g., 'craft wooden axe')");
        return;
      }

      // 1) pick recipe from YOUR recipes.ts
      const matches = findRecipesByDisplayName(itemName);
      if (matches.length === 0) {
        log(`❌ No recipe found for "${itemName}"`);
        return;
      }
      const recipe = matches[0];

      const caller = encodePlayerEntityId(context.address);

      // 2) input selection (handles Any* and retries once on shortfall)
      const sel = await selectInputsWithRetry(caller, recipe);
      if ("error" in sel) {
        log(sel.error);
        return;
      }
      const { inputSlots } = sel;

      // 3) read on-chain recipe row
      const availableRows = await getAvailableRecipesRows();
      const match = findMatchingRecipeInfo(availableRows, recipe);
      if (!match) {
        log(`❌ Recipe not found in game state for "${itemName}"`);
        return;
      }
      const { recipeId, stationTypeId } = match;
      const chainStationId = parseInt(stationTypeId, 10);
      const chainNeedsStation = chainStationId !== 0;

      // Override: ALL wooden tools require Workbench even if chain row says hand
      const localOverridesStation =
        recipeProducesWoodenTool(recipe) ? ("Workbench" as ObjectName) : null;

      // Final station decision:
      let stationName: ObjectName | null = null;
      if (chainNeedsStation) {
        stationName = objectTypesById[chainStationId] as ObjectName;
      } else if (localOverridesStation) {
        stationName = localOverridesStation;
      }

      console.info(
        `[craft] recipeId=${recipeId}, station=${stationName ? stationName : "Hand"}`
      );

      let data: `0x${string}`;

      if (stationName) {
        // New rule: station must be exactly 1 block NORTH (z - 1)
        const north = await getNorthStationEntityId(caller, stationName);
        if (!north) {
          // Show exact target tile to help the player
          const pos = await getPlayerPosition(caller);
          if (!pos) {
            log(`❌ No ${formatObjectName(stationName)} north of you. Place it one block to world-north and try again.`);
            return;
          }
          log(
            `❌ No ${formatObjectName(stationName)} at (${pos.x}, ${pos.y}, ${pos.z - 1}). Place it exactly 1 block north and try again.`
          );
          return;
        }

        data = encodeFunctionData({
          abi: craftAbi,
          functionName: "craftWithStation",
          args: [
            caller,
            north.entityId as `0x${string}`,
            recipeId as `0x${string}`,
            inputSlots.map((it) => [it.slot, it.amount] as const),
          ],
        });
      } else {
        data = encodeFunctionData({
          abi: craftAbi,
          functionName: "craft",
          args: [
            caller,
            recipeId as `0x${string}`,
            inputSlots.map((it) => [it.slot, it.amount] as const),
          ],
        });
      }

      // 4) send tx
      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      const outputName = formatObjectName(recipe.outputs[0][0]);
      log(`✅ Crafted ${outputName}! Tx: ${txHash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: `❌ Craft failed: ${msg}` })
      );
    }
  }
}
