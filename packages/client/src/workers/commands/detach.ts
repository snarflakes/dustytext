// detach.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { resourceToHex } from "@latticexyz/common";
import { getForceFieldInfoForPlayer, invalidateForceFieldFragment } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";
const ZERO_ENTITY_ID = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/* ---------------------- Block entityId encoder ---------------------- */
const BYTES_32_BITS = 256n;
const TYPE_BITS     = 8n;
const ID_BITS       = BYTES_32_BITS - TYPE_BITS; // 248
const VEC3_BITS     = 96n;
const ENTITY_TYPE_BLOCK = 0x03;

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n));
}
function packVec3([x, y, z]: [number, number, number]): bigint {
  return (toU32(x) << 64n) | (toU32(y) << 32n) | toU32(z);
}
function encode(type: number, data: bigint): `0x${string}` {
  const v   = (BigInt(type) << ID_BITS) | data;
  const hex = v.toString(16).padStart(64, "0");
  return (`0x${hex}`) as `0x${string}`;
}
function encodeCoord(type: number, coord: [number, number, number]): `0x${string}` {
  return encode(type, packVec3(coord) << (ID_BITS - VEC3_BITS));
}
function encodeBlock(pos: [number, number, number]): `0x${string}` {
  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
}

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
      let targetEntityId: `0x${string}`;
      let targetCoords: [number, number, number] = [0, 0, 0];
      
      // Check if coordinates were provided as arguments
      if (args.length >= 3) {
        const x = parseInt(args[0], 10);
        const y = parseInt(args[1], 10);
        const z = parseInt(args[2], 10);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          window.dispatchEvent(new CustomEvent<string>("worker-log", {
            detail: `❌ Invalid coordinates. Usage: detach x y z`
          }));
          return;
        }
        
        // Use specified coordinates directly
        targetCoords = [x, y, z];
        targetEntityId = encodeBlock(targetCoords);
        
        window.dispatchEvent(new CustomEvent<string>("worker-log", {
          detail: `🎯 Targeting specific coordinates (${x}, ${y}, ${z}) for program detachment.`
        }));
      } else if (isHexEntityId(args[0])) {
        // Explicit entityId provided
        targetEntityId = args[0].toLowerCase() as `0x${string}`;
      } else {
        // Use the sense module to find force field info
        const forceFieldInfo = await getForceFieldInfoForPlayer(context.address);
        if (forceFieldInfo.forceField !== ZERO_ENTITY_ID) {
          targetEntityId = forceFieldInfo.forceField;
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

      // Check if machine has energy (detach only allowed when energy == 0)
      const energy = await getMachineEnergy(targetEntityId);
      if (energy != null && energy > 0) {
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: `❌ Machine has energy (${energy}). Detach is only allowed when energy == 0.`,
          }),
        );
        return;
      }

      // Try the detach operation - let the contract handle program validation
      const caller = encodePlayerEntityId(context.address);

      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "detachProgram",
        args: [caller, targetEntityId, "0x"],
      });

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `🧰 Attempting to detach program from ${targetEntityId}...`,
        }),
      );

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300_000n,
      });

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `🧹 Detach transaction sent for ${targetEntityId}\nTx: ${txHash}`,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      
      // Check for authorization error
      if (msg.includes('43616c6c6572206e6f7420617574686f72697a656420746f2064657461636820746869732070726f6772616d') ||
          msg.includes('Caller not authorized to detach this program')) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", { 
          detail: `❌ You are not authorized to detach this program. Only the original attacher or machine owner can detach programs.` 
        }));
        return;
      }
      
      // Check for gas limit error
      if (msg.includes('0x34a44dbe') || 
          msg.includes('gas limit too low')) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", { 
          detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
        }));
        return;
      }
      
      // Check for energy error (player is dead)
      if (msg.includes('Entity has no energy') || 
          msg.includes('456e7469747920686173206e6f20656e65726779000000000000000000000000')) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", { 
          detail: `💀 You are dead. Spawn to be reborn.` 
        }));
        return;
      }
      
      window.dispatchEvent(
        new CustomEvent<string>("worker-log", { detail: `❌ detach failed: ${msg}` }),
      );
    }
  }
}
