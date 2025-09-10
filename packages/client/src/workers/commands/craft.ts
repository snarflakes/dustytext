import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";
import {
  findRecipesByDisplayName,
  formatObjectName,
  Recipe,
} from "../../recipes";
import { OBJECT_TYPES } from "../../objectTypes";
import type { ObjectName } from "../../objects";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

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

// OBJECT_TYPES is a Record<number, string>; build reverse map: ObjectName -> typeId
const TYPE_ID_BY_NAME: Record<string, number> = (() => {
  const source = OBJECT_TYPES as unknown as Record<number, string>;
  const entries = Object.entries(source).map(
    ([idStr, name]: [string, string]) => [name, Number(idStr)] as const,
  );
  return Object.fromEntries(entries);
})();

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

const objectTypesById = OBJECT_TYPES as Record<number, string>;

// ---------- indexer I/O & row types ----------
type InventoryRow = [string, string, string, string]; // slot, entityId, objectTypeId, amount
type RecipeRow = [
  string, // recipeId (bytes32)
  string, // stationTypeId (as string number; 0 if hand)
  string, // craftingTime
  string[], // inputTypes (type ids as strings)
  string[], // inputAmounts
  string[], // outputTypes (type ids as strings)
  string[], // outputAmounts
];
type EntityPosRow = [string, string, string]; // x,y,z as strings
type StationEntityRow = [string, string, string, string]; // entityId,x,y,z

async function postQuery(query: string): Promise<unknown[]> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result?: unknown[][] } | undefined;
  return (data?.result?.[0] as unknown[]) ?? [];
}

async function getPlayerInventory(owner: `0x${string}`) {
  const query = `SELECT "slot","entityId","objectType","amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner"='${owner}'`;
  const rows = await postQuery(query);
  const typed = rows.slice(1) as InventoryRow[];
  return typed.map((row) => {
    const typeId = parseInt(row[2], 10);
    const objName = objectTypesById[typeId] as ObjectName | undefined;
    return {
      slot: parseInt(row[0], 10),
      entityId: row[1],
      objectType: (objName ?? `Unknown(${row[2]})`) as ObjectName | `Unknown(${string})`,
      amount: parseInt(row[3], 10),
    };
  });
}

async function getAvailableRecipesRows(): Promise<RecipeRow[]> {
  const query = `SELECT "recipeId","stationTypeId","craftingTime","inputTypes","inputAmounts","outputTypes","outputAmounts" FROM "${RECIPES_TABLE}"`;
  const rows = await postQuery(query);
  return rows.slice(1) as RecipeRow[];
}

async function getPlayerPosition(entityId: `0x${string}`) {
  const q = `SELECT "x","y","z" FROM "${ENTITY_POS_TABLE}" WHERE "entityId"='${entityId}'`;
  const rows = await postQuery(q);
  if (rows.length < 2) return null;
  const r = rows[1] as EntityPosRow;
  return {
    x: parseInt(r[0], 10),
    y: parseInt(r[1], 10),
    z: parseInt(r[2], 10),
  };
}

async function findNearbyStationEntityId(
  playerEntityId: `0x${string}`,
  stationName: ObjectName,
) {
  const pos = await getPlayerPosition(playerEntityId);
  if (!pos) return null;

  const stationTypeId = TYPE_ID_BY_NAME[stationName];
  if (stationTypeId == null) return null;

  // Query a small box around the player; filter to Manhattan distance <= 1
  const minX = pos.x - 1;
  const maxX = pos.x + 1;
  const minZ = pos.z - 1;
  const maxZ = pos.z + 1;
  const y = pos.y;

  const q = `
    SELECT p."entityId", p."x", p."y", p."z"
    FROM "${ENTITY_POS_TABLE}" p
    JOIN "${ENTITY_TYPE_TABLE}" t ON t."entityId" = p."entityId"
    WHERE t."objectType"='${stationTypeId}'
      AND p."y"='${y}'
      AND p."x">='${minX}' AND p."x"<='${maxX}'
      AND p."z">='${minZ}' AND p."z"<='${maxZ}'
  `;
  const rows = await postQuery(q);
  const typed = rows.slice(1) as StationEntityRow[];
  for (const row of typed) {
    const entityId = row[0] as `0x${string}`;
    const x = parseInt(row[1], 10);
    const yy = parseInt(row[2], 10);
    const z = parseInt(row[3], 10);
    const md = Math.abs(x - pos.x) + Math.abs(z - pos.z) + Math.abs(yy - pos.y);
    if (md <= 1) return entityId;
  }
  return null;
}

// ---------- recipe row matching ----------
function rowsMatchRecipe(row: RecipeRow, target: Recipe) {
  const [
    ,
    stationTypeId,
    ,
    inputTypes,
    inputAmounts,
    outputTypes,
    outputAmounts,
  ] = row;

  const rowStationId = parseInt(stationTypeId, 10);
  const rowHasStation = rowStationId !== 0;

  // Presence of station must match, and if present, names must match
  if (!!target.station !== rowHasStation) return false;
  if (rowHasStation) {
    const rowStationName = objectTypesById[rowStationId] as ObjectName | undefined;
    if (!rowStationName || rowStationName !== target.station) return false;
  }

  const rowInputTypeIds = inputTypes.map((s: string) => parseInt(s, 10));
  const rowOutputTypeIds = outputTypes.map((s: string) => parseInt(s, 10));
  const rowInputAmts = inputAmounts.map((s: string) => parseInt(s, 10));
  const rowOutputAmts = outputAmounts.map((s: string) => parseInt(s, 10));

  // Outputs: order-insensitive compare (by typeId, amount)
  if (rowOutputTypeIds.length !== target.outputs.length) return false;
  const targetOutPairs = target.outputs.map(
    ([n, a]) => [TYPE_ID_BY_NAME[n], a] as const,
  );
  const sortPairs = (arr: ReadonlyArray<readonly [number, number]>) =>
    [...arr].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rowOutPairs = sortPairs(
    rowOutputTypeIds.map(
      (id: number, i: number) => [id, rowOutputAmts[i]] as const,
    ),
  );
  const tgtOutPairs = sortPairs(targetOutPairs);
  for (let i = 0; i < rowOutPairs.length; i++) {
    if (rowOutPairs[i][0] !== tgtOutPairs[i][0] || rowOutPairs[i][1] !== tgtOutPairs[i][1])
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
    // if Any* => allow any rowId; amounts already validated
  }

  return true;
}

function findMatchingRecipeInfo(
  available: RecipeRow[],
  targetRecipe: Recipe,
): { recipeId: string; stationTypeId: string } | null {
  for (const row of available) {
    if (rowsMatchRecipe(row, targetRecipe)) {
      const [recipeId, stationTypeId] = row;
      return { recipeId, stationTypeId };
    }
  }
  return null;
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

      // 1) resolve desired recipe from local registry (recipes.ts)
      const matches = findRecipesByDisplayName(itemName);
      if (matches.length === 0) {
        log(`❌ No recipe found for "${itemName}"`);
        return;
      }
      const recipe = matches[0];

      const caller = encodePlayerEntityId(context.address);

      // 2) load inventory
      const inventory = await getPlayerInventory(caller);
      if (!Array.isArray(inventory) || inventory.length === 0) {
        log("❌ Inventory is empty or unavailable");
        return;
      }

      // 3) select slots for inputs (expands Any* metas)
      const inputSlots: Array<{ slot: number; amount: number }> = [];

      const expand = (t: ObjectName): ReadonlyArray<ObjectName> =>
        t === "AnyPlank" ? ANY_PLANKS : t === "AnyLog" ? ANY_LOGS : t === "AnyLeaf" ? ANY_LEAVES : [t];

      for (const [needType, needAmt] of recipe.inputs) {
        let remaining = needAmt;
        const allow = new Set(expand(needType));

        for (const item of inventory) {
          if (remaining <= 0) break;
          // Only compare against known object names
          if (typeof item.objectType !== "string" || !allow.has(item.objectType as ObjectName))
            continue;

          const use = Math.min(item.amount, remaining);
          if (use > 0) {
            inputSlots.push({ slot: item.slot, amount: use });
            remaining -= use;
          }
        }

        if (remaining > 0) {
          log(`❌ Missing ${remaining} ${needType} for crafting`);
          return;
        }
      }

      // 4) look up on-chain recipe & decide craft vs craftWithStation from stationTypeId
      const availableRows = await getAvailableRecipesRows();
      const match = findMatchingRecipeInfo(availableRows, recipe);

      if (!match) {
        log(`❌ Recipe not found in game state for "${itemName}"`);
        return;
      }

      const { recipeId, stationTypeId } = match;
      const needsStation = parseInt(stationTypeId, 10) !== 0;

      let data: `0x${string}`;

      if (needsStation) {
        const stationNameStr = objectTypesById[parseInt(stationTypeId, 10)];
        // Narrow string -> ObjectName (it came from OBJECT_TYPES)
        const stationName = stationNameStr as ObjectName;

        // 5) ensure a placed station entity is adjacent
        const stationEntityId = await findNearbyStationEntityId(
          caller,
          stationName,
        );
        if (!stationEntityId) {
          log(`❌ No ${formatObjectName(stationName)} nearby`);
          return;
        }

        data = encodeFunctionData({
          abi: craftAbi,
          functionName: "craftWithStation",
          args: [
            caller,
            stationEntityId as `0x${string}`,
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

      // 6) send tx
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
        new CustomEvent("worker-log", { detail: `❌ Craft failed: ${msg}` }),
      );
    }
  }
}
