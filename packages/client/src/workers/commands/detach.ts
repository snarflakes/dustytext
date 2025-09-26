// detach.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, invalidateForceFieldFragment } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";
const ZERO_ENTITY_ID = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/* ---------------------- Utilities ---------------------- */
function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function isHexEntityId(v?: string): v is `0x${string}` {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v);
}

async function indexerQuery<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });
  if (!response.ok) return [];
  const result = await response.json();
  const table = result?.result?.[0];
  if (!Array.isArray(table) || table.length < 2) return [];
  const [columns, ...rows] = table;
  return rows.map((row: unknown[]) =>
    Object.fromEntries(columns.map((k: string, i: number) => [k, row[i]])) as T,
  );
}

async function getPlayerPosition(address: string): Promise<{ x: number; y: number; z: number } | null> {
  const playerEntityId = encodePlayerEntityId(address);
  const rows = await indexerQuery<{ x: string; y: string; z: string }>(
    `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${playerEntityId}'`,
  );
  if (rows.length === 0) return null;
  const { x, y, z } = rows[0];
  return { x: Number(x), y: Number(y), z: Number(z) };
}

function chebyshev(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

async function getEntityPosition(entityId: `0x${string}`): Promise<{ x: number; y: number; z: number } | null> {
  const rows = await indexerQuery<{ x: string; y: string; z: string }>(
    `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${entityId}'`,
  );
  if (rows.length === 0) return null;
  const { x, y, z } = rows[0];
  return { x: Number(x), y: Number(y), z: Number(z) };
}

async function findNearbyForceFieldStation(playerAddress: string): Promise<`0x${string}` | null> {
  const machines = await indexerQuery<{ entityId: `0x${string}` }>(`SELECT "entityId" FROM "Machine"`);
  if (machines.length === 0) return null;

  const playerPos = await getPlayerPosition(playerAddress);
  if (!playerPos) return null;

  for (const m of machines) {
    const pos = await getEntityPosition(m.entityId);
    if (!pos) continue;
    if (chebyshev(playerPos, pos) <= 5) return m.entityId;
  }
  return null;
}

async function getMachineEnergy(entityId: `0x${string}`): Promise<number | null> {
  const rows = await indexerQuery<{ energy: string }>(
    `SELECT "energy" FROM "Energy" WHERE "entityId"='${entityId}'`,
  );
  return rows.length ? Number(rows[0].energy) : null;
}

async function getAttachedProgram(entityId: `0x${string}`): Promise<`0x${string}` | null> {
  const rows = await indexerQuery<Record<string, unknown>>(
    `SELECT * FROM "EntityProgram" WHERE "entityId"='${entityId}'`,
  );
  if (!rows.length) return null;

  const r = rows[0];
  const preferredKeys = ["program", "programSystemId", "value"];
  for (const k of preferredKeys) {
    const v = r[k];
    if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) return v as `0x${string}`;
  }
  for (const v of Object.values(r)) {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) return v as `0x${string}`;
  }
  return null;
}

/* ---------------------- Command ---------------------- */
export class DetachProgramCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // Target resolution priority:
      // 1) explicit entityId arg
      // 2) nearby Force Field Station (machine)
      // 3) entity at the block directly beneath the player
      let targetEntityId: `0x${string}` | null =
        isHexEntityId(args[0]) ? (args[0].toLowerCase() as `0x${string}`) : null;

      if (!targetEntityId) {
        // First check if there's a force field at the player's position
        const forceFieldInfo = await getForceFieldInfoForPlayer(context.address);
        if (forceFieldInfo.forceField !== ZERO_ENTITY_ID) {
          targetEntityId = forceFieldInfo.forceField; // Use the machine entity ID
          window.dispatchEvent(
            new CustomEvent<string>("worker-log", {
              detail: `ℹ️ Using force field machine ${targetEntityId} as detach target.`,
            }),
          );
        } else {
          // Fallback to nearby station search
          const station = await findNearbyForceFieldStation(context.address);
          if (station) {
            targetEntityId = station;
            window.dispatchEvent(
              new CustomEvent<string>("worker-log", {
                detail: `ℹ️ Using nearby Force Field Station ${station} as detach target.`,
              }),
            );
          } else {
            window.dispatchEvent(
              new CustomEvent<string>("worker-log", {
                detail: "❌ No force field machine found at your location or within 5 blocks.",
              }),
            );
            return;
          }
        }
      }

      // If there's a nearby station, enforce/verify it's not energized
      const station = await findNearbyForceFieldStation(context.address);
      if (station) {
        const energy = await getMachineEnergy(station);
        if (energy != null && energy > 0) {
          window.dispatchEvent(
            new CustomEvent<string>("worker-log", {
              detail: `❌ Station appears energized (energy=${energy}). Detach is only allowed when energy == 0.`,
            }),
          );
          return;
        }
      } else {
        // Can't verify energy status; warn but proceed—the on-chain check will still guard.
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail:
              "⚠️ No nearby station found to verify energy; attempting detach anyway (allowed only when the field has no energy).",
          }),
        );
      }

      // Confirm there is actually a program on the target
      const attachedProgram = await getAttachedProgram(targetEntityId);
      if (!attachedProgram) {
        // Try to get more debug info about what's in the EntityProgram table
        const debugRows = await indexerQuery<Record<string, unknown>>(
          `SELECT * FROM "EntityProgram" WHERE "entityId"='${targetEntityId}'`
        );
        
        const debugInfo = debugRows.length > 0 
          ? `\nDebug: Found ${debugRows.length} EntityProgram rows: ${JSON.stringify(debugRows[0])}`
          : `\nDebug: No rows found in EntityProgram table for ${targetEntityId}`;
          
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: `ℹ️ No program is attached to ${targetEntityId}. Nothing to detach.${debugInfo}`,
          }),
        );
        return;
      }

      const caller = encodePlayerEntityId(context.address);

      // IWorld uses plain names (attachProgram/detachProgram) per your template.
      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "detachProgram",
        args: [caller, targetEntityId, "0x"], // extraData empty
      });

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `🧰 Detaching program (${attachedProgram}) from ${targetEntityId}...`,
        }),
      );

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300_000n,
      });

      // Best-effort cache invalidation for your UI
      try {
        const info = await getForceFieldInfoForPlayer(context.address);
        invalidateForceFieldFragment(info.fragmentId);
      } catch {
        /* ignore */
      }

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `🧹 Program detached from ${targetEntityId}\nTx: ${txHash}`,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(
        new CustomEvent<string>("worker-log", { detail: `❌ detach failed: ${msg}` }),
      );
    }
  }
}
