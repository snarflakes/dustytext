import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";

type EquippedTool = { slot: number; type: string; name: string } | null;

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

// Reusable single-block executor (used by done.ts as a fallback)
export async function waterSingleBlock(context: CommandContext, block: { x: number; y: number; z: number }): Promise<boolean> {
  const entityId = encodePlayerEntityId(context.address);

  const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool }).equippedTool;
  const hasWaterBucket = !!equippedTool && /water/i.test(equippedTool.type) && /bucket/i.test(equippedTool.type);
  if (!hasWaterBucket) {
    window.dispatchEvent(new CustomEvent("worker-log", {
      detail: "❌ You must equip a water bucket to water farmland. Use 'equip water bucket' first."
    }));
    return false;
  }

  const coord = packCoord96(block.x, block.y, block.z);
  const data = encodeFunctionData({
    abi: IWorldAbi,
    functionName: "wetFarmland",
    args: [entityId, coord, equippedTool!.slot],
  });

  const txHash = await context.sessionClient.sendTransaction({
    to: WORLD_ADDRESS,
    data,
    gas: 300000n,
  });

  window.dispatchEvent(new CustomEvent("worker-log", {
    detail: `💧 Watered farmland at (${block.x}, ${block.y}, ${block.z}) using ${equippedTool!.type}. Tx: ${txHash}`
  }));

  return true;
}

export class WaterCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path (for typed coords) ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        addToQueue("water", tuples, "ai"); // change to "human" if you want typed tuples to mix with clicks
        const n = queueSizeByAction("water");
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `✅ Queued ${tuples.length} water target(s). (${n} queued). Type 'done' to execute.`
        }));
        return;
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target coordinate ---
      // A) JSON coord (from done.ts)
      let targetX = 0, targetY = 0, targetZ = 0;
      let useJson = false;

      if (args[0] && looksLikeJsonCoord(args[0])) {
        try {
          const parsed = JSON.parse(args[0]) as { x: number; y: number; z: number };
          if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.z === "number") {
            targetX = parsed.x;
            targetY = parsed.y;
            targetZ = parsed.z;
            useJson = true;
          }
        } catch { /* fall through */ }
      }

      // B) No JSON → water the block BELOW your feet (y - 1)
      if (!useJson) {
        const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
        const posRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
        });

        if (!posRes.ok) {
          window.dispatchEvent(new CustomEvent("worker-log", { detail: "❌ Could not get position" }));
          return;
        }

        const posJson = await posRes.json();
        const posRows = posJson?.result?.[0];
        if (!Array.isArray(posRows) || posRows.length < 2) {
          window.dispatchEvent(new CustomEvent("worker-log", { detail: "❌ No position found" }));
          return;
        }

        const [posCols, posVals] = posRows;
        const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));

        const px = Number(pos.x ?? 0);
        const py = Number(pos.y ?? 0);
        const pz = Number(pos.z ?? 0);

        targetX = px;
        targetY = py - 1; // farmland below your feet
        targetZ = pz;
      }

      // --- 3) Bucket check (required to execute) ---
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool }).equippedTool;
      const hasWaterBucket = !!equippedTool && /water/i.test(equippedTool.type) && /bucket/i.test(equippedTool.type);
      if (!hasWaterBucket) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ You must equip a water bucket to water farmland. Use 'equip water bucket' first."
        }));
        return;
      }

      // --- 4) Execute watering ---
      await waterSingleBlock(context, { x: targetX, y: targetY, z: targetZ });

      // optional: auto-look
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const { getCommand } = await import("./registry");
        const lookCommand = getCommand("look");
        if (lookCommand) await lookCommand.execute(context);
      } catch { /* no-op */ }

    } catch (error) {
      const errorMessage = String(error);

      if (errorMessage.includes("Not farmland") ||
          errorMessage.includes("4e6f74206661726d6c616e64")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Target block is not farmland. Use 'till' first to create farmland."
        }));
      } else if (errorMessage.includes("Must use a Water Bucket")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ You must equip a water bucket to water farmland."
        }));
      } else {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ Water failed: ${errorMessage}` }));
      }
    }
  }
}
