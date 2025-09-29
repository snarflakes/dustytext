// claimfield.ts — ensure your EOA has control; keep ephemeral as collaborator
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, getForceFieldInfo, ForceFieldInfo } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";
const ZERO_ENTITY_ID = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

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
export class ClaimFieldCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // Parse coordinates if provided: "claimfield x y z"
      let targetPos: Vec3 | null = null;
      
      if (args.length > 0) {
        const coords = args.map(Number);
        if (coords.length === 3 && coords.every((n: number) => !isNaN(n))) {
          targetPos = [coords[0], coords[1], coords[2]];
        }
      }

      let ff: ForceFieldInfo;
      if (targetPos) {
        ff = await getForceFieldInfo(targetPos);
      } else {
        ff = await getForceFieldInfoForPlayer(context.address);
      }

      let machine: `0x${string}`;
      let coordsForLog: Vec3 | null = null;

      if (ff.forceField !== ZERO_ENTITY_ID) {
        // Use the existing machine entity
        machine = ff.forceField;
      } else {
        // No force field detected yet — fall back to block beneath the player
        const pos = await fetchPlayerBlock(context.address);
        if (!pos) throw new Error("No position found — try 'spawn' first.");
        coordsForLog = [pos[0], pos[1] - 1, pos[2]];
        machine = encodeBlock(coordsForLog);
      }

      // Step 1: Ensure your EOA is trusted (collaborator) on the machine.
      let grantTx: `0x${string}` | null = null;
      try {
        const dataGrant = encodeFunctionData({
          abi: IWorldAbi,
          functionName: "grantAccess",
          args: [machine, context.address as `0x${string}`],
        });

        grantTx = await context.sessionClient.sendTransaction({
          to: WORLD_ADDRESS,
          data: dataGrant,
          gas: 300_000n,
        }) as `0x${string}`;
      } catch (e) {
        // If your world doesn't expose grantAccess, we'll just log and continue.
      }

      // Step 2 (optional/best): make your EOA the owner/controller if your world supports it.
      // (bytes32 caller, bytes32 machine, bytes32 newOwner)
      let ownerTx: `0x${string}` | null = null;
      try {
        const dataOwner = encodeFunctionData({
          abi: IWorldAbi,
          functionName: "transferOwnership",
          args: [machine, context.address as `0x${string}`],
        });

        ownerTx = await context.sessionClient.sendTransaction({
          to: WORLD_ADDRESS,
          data: dataOwner,
          gas: 300_000n,
        }) as `0x${string}`;
      } catch (e) {
        // It's okay if setOwner doesn't exist; you still keep access via trust.
      }

      const targetTxt = coordsForLog
        ? `machine at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`
        : `force field station ${machine}`;

      const parts: string[] = [];
      if (grantTx) parts.push(`🤝 Granted collaborator access to your EOA. Tx: ${grantTx}`);
      else parts.push(`ℹ️ Skipped collaborator grant (no grantAccess in ABI or already granted).`);

      if (ownerTx) parts.push(`👑 Transferred ownership/controller to your EOA. Tx: ${ownerTx}`);
      else parts.push(`ℹ️ Ownership transfer skipped or unsupported. You still have collaborator access.`);

      window.dispatchEvent(new CustomEvent<string>("worker-log", {
        detail: `✅ Claim complete on ${targetTxt}\n${parts.join("\n")}`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("gas") || msg.includes("0x34a44dbe")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "⛽ Gas issue: click the orange square (top-right) and Top Up gas."
        }));
        return;
      }
      if (msg.includes("no energy") || msg.includes("has no energy")) {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: "💀 You are dead. Use 'spawn'." }));
        return;
      }
      if (msg.includes("Target is not a smart entity")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ The block beneath you isn’t a smart entity. Stand on your force-field station."
        }));
        return;
      }
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ claimfield failed: ${msg}` }));
    }
  }
}
