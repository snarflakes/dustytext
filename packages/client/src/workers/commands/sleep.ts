// sleep.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { OBJECT_TYPES } from "../../objectTypes";
import { queryIndexer } from "./queryIndexer";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

// Keep consistent with queryIndexer.ts (single source of truth is best)
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

// --- Table names used by the indexer ---
const ENTITY_POS_TABLE = "EntityPosition";
const ENTITY_TYPE_TABLE = "EntityObjectType";

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
})(); // Removed unused variable

// ---------- indexer I/O ----------
async function getPlayerPosition(entityId: `0x${string}`) {
  const sql = `SELECT "x","y","z" FROM "${ENTITY_POS_TABLE}" WHERE "entityId"='${entityId}'`;
  const rows = await queryIndexer(sql, "sleep_getPlayerPosition");
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
      const msg = e instanceof Error ? e.message : String(e);
      if (!/HTTP 500|No space left on device/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

// Small helper: fetch the objectType for a single entityId (no joins, no IN)
async function getEntityObjectType(entityId: `0x${string}`): Promise<number | null> {
  const sql = `SELECT "objectType" FROM "${ENTITY_TYPE_TABLE}" WHERE "entityId"='${entityId}' LIMIT 1`;
  const rows = await queryWithRetry(sql, "sleep_getEntityObjectType");
  if (rows.length < 2) return null;
  const typeStr = rows[1][0] as string;
  const typeId = parseInt(typeStr, 10);
  return Number.isFinite(typeId) ? typeId : null;
}

// Get the entityId at an exact (x,y,z)
async function getEntityIdAt(x: number, y: number, z: number): Promise<`0x${string}` | null> {
  const sql = `SELECT "entityId" FROM "${ENTITY_POS_TABLE}" WHERE "x"=${x} AND "y"=${y} AND "z"=${z} LIMIT 1`;
  const rows = await queryWithRetry(sql, "sleep_getEntityIdAt");
  if (rows.length < 2) return null;
  return rows[1][0] as `0x${string}`;
}

/**
 * Find a Bed entity within 1 block of the player in cardinal directions + down.
 * (Matches the craft template's neighborhood scan.)
 */
async function getNearbyBedEntityId(
  playerEntityId: `0x${string}`
): Promise<{ entityId: `0x${string}`; x: number; y: number; z: number } | null> {
  const pos = await getPlayerPosition(playerEntityId);
  if (!pos) return null;

  // Check positions: north, south, east, west, down
  const offsets = [
    { dx: 0, dy: 0, dz: -1 }, // north
    { dx: 0, dy: 0, dz: 1 },  // south
    { dx: 1, dy: 0, dz: 0 },  // east
    { dx: -1, dy: 0, dz: 0 }, // west
    { dx: 0, dy: -1, dz: 0 }, // down
  ];

  const bedTypeId = TYPE_ID_BY_NAME["Bed"];

  for (const { dx, dy, dz } of offsets) {
    const checkX = pos.x + dx;
    const checkY = pos.y + dy;
    const checkZ = pos.z + dz;

    const entityId = await getEntityIdAt(checkX, checkY, checkZ);
    if (!entityId) continue;

    const typeId = await getEntityObjectType(entityId);
    if (typeId === bedTypeId) {
      return { entityId, x: checkX, y: checkY, z: checkZ };
    }
  }

  return null;
}

// ---------- main command ----------
export class SleepCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    const log = (detail: string) =>
      window.dispatchEvent(new CustomEvent("worker-log", { detail }));

    try {
      const caller = encodePlayerEntityId(context.address);

      // Find a nearby bed (adjacent)
      log("You look around for a cozy bed nearby...\nRoundtime: 40 sec.");
      const nearbyBed = await getNearbyBedEntityId(caller);

      if (!nearbyBed) {
        const pos = await getPlayerPosition(caller);
        if (!pos) {
          log("❌ No Bed adjacent to you. Place a Bed within 1 block (N/S/E/W or directly below) and try again.");
          return;
        }
        log(
          "❌ No Bed found adjacent to you. Place it at your level, exactly 1 block away (north/south/east/west or down) and try again."
        );
        return;
      }

      // Encode and send the sleep() call
      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "sleep",
        args: [
          caller,
          nearbyBed.entityId as `0x${string}`,
          "0x" as `0x${string}`, // extraData (none)
        ],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      log(
        `😴 You lie down in the bed at (${nearbyBed.x}, ${nearbyBed.y}, ${nearbyBed.z})... sweet dreams. Tx: ${txHash}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: `❌ Sleep failed: ${msg}` })
      );
    }
  }
}
