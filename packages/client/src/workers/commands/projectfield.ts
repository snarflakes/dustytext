// projectfield.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { resourceToHex } from "@latticexyz/common";
import programsMudConfig from "@dust/programs/mud.config";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";

/* ---------------------- ProgramId ---------------------- */
const FORCEFIELD_PROGRAM_ID = resourceToHex({
  type: "system",
  namespace: programsMudConfig.namespace,
  name: "ForceFieldProgra", // (intentional spelling per your snippet)
}) as `0x${string}`;

/* ---------------------- Types / helpers ---------------------- */
type Hex32 = `0x${string}`;
type Vec3  = [number, number, number];

function encodePlayerEntityId(address: string): Hex32 {
  const prefix = "01";
  const clean  = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as Hex32;
}

function asNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function sqlOne<T = Record<string, unknown>>(query: string): Promise<T | null> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { result?: [[string[], (string | number | null)[]]] };
  const rows = json.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const [cols, vals] = rows;
  return Object.fromEntries(cols.map((k, i) => [k, vals[i]])) as T;
}

async function fetchPlayerBlock(address: string): Promise<Vec3 | null> {
  const pid = encodePlayerEntityId(address);
  const q   = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${pid}'`;
  const row = await sqlOne<{ x: number | string | null; y: number | string | null; z: number | string | null }>(q);
  if (!row) return null;
  const x = Math.floor(asNumber(row.x) ?? 0);
  const y = Math.floor(asNumber(row.y) ?? 0);
  const z = Math.floor(asNumber(row.z) ?? 0);
  return [x, y, z];
}

/* ---------------------- Block entityId encoder ---------------------- */
const BYTES_32_BITS = 256n;
const TYPE_BITS     = 8n;
const ID_BITS       = BYTES_32_BITS - TYPE_BITS; // 248
const VEC3_BITS     = 96n;
const ENTITY_TYPE_BLOCK = 0x03;

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n));
}
function packVec3([x, y, z]: Vec3): bigint {
  return (toU32(x) << 64n) | (toU32(y) << 32n) | toU32(z);
}
function encode(type: number, data: bigint): Hex32 {
  const v   = (BigInt(type) << ID_BITS) | data;
  const hex = v.toString(16).padStart(64, "0");
  return (`0x${hex}`) as Hex32;
}
function encodeCoord(type: number, coord: Vec3): Hex32 {
  return encode(type, packVec3(coord) << (ID_BITS - VEC3_BITS));
}
function encodeBlock(pos: Vec3): Hex32 {
  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
}

/* ---------------------- Command ---------------------- */
export class ProjectFieldCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      // Block directly beneath the player
      const pos = await fetchPlayerBlock(context.address);
      if (!pos) throw new Error("You float amongst the stars. Try 'spawn' first.");
      const target: Vec3 = [pos[0], pos[1] - 1, pos[2]];

      const caller = encodePlayerEntityId(context.address);
      const machineOrBlockEntityId = encodeBlock(target);

      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "attachProgram",
        args: [caller, machineOrBlockEntityId, FORCEFIELD_PROGRAM_ID, "0x"],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300_000n,
      });

      window.dispatchEvent(new CustomEvent<string>("worker-log", {
        detail: `🛰️ Attaching Force Field program to block beneath you at (${target[0]}, ${target[1]}, ${target[2]}).\nTx: ${txHash}`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: `❌ projectfield failed: ${msg}` }));
    }
  }
}
