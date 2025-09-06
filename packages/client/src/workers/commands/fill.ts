import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";

const fillAbi = parseAbi([
  "function fillBucket(bytes32 caller, uint96 waterCoord, uint16 bucketSlot) returns (bytes32)",
]);

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

export class FillCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path (keeps queue/build flow consistent) ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        // Use "ai" to enforce one-actor-at-a-time. Change to "human" if you want typed tuples to mix with clicks.
        addToQueue("fill", tuples, "ai");
        const n = queueSizeByAction("fill");
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `✅ Queued ${tuples.length} fill target(s). (${n} queued). Type 'done' to execute.`,
          })
        );
        return;
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target water coordinate ---
      let targetX = 0,
        targetY = 0,
        targetZ = 0;
      let haveJsonTarget = false;

      // A) JSON coord (from done.ts)
      if (args[0] && looksLikeJsonCoord(args[0])) {
        try {
          const parsed = JSON.parse(args[0]) as { x: number; y: number; z: number };
          if (
            parsed &&
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            typeof parsed.z === "number"
          ) {
            targetX = parsed.x;
            targetY = parsed.y;
            targetZ = parsed.z;
            haveJsonTarget = true;
          }
        } catch {
          // fall back to player position
        }
      }

      // B) No JSON → use current player position (standing in water)
      if (!haveJsonTarget) {
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
        targetX = Number(pos.x ?? 0);
        targetY = Number(pos.y ?? 0);
        targetZ = Number(pos.z ?? 0);
      }

      // --- 3) Bucket check (required for execution) ---
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool }).equippedTool;
      if (!equippedTool || !equippedTool.type?.toLowerCase().includes("bucket")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ You must equip a bucket to fill with water. Use 'equip bucket' first.",
          })
        );
        return;
      }

      // --- 4) Execute fillBucket ---
      const waterCoord = packCoord96(targetX, targetY, targetZ);
      const data = encodeFunctionData({
        abi: fillAbi,
        functionName: "fillBucket",
        args: [entityId, waterCoord, equippedTool.slot],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `💧 Filled ${equippedTool.type} at (${targetX}, ${targetY}, ${targetZ}). Tx: ${txHash}`,
        })
      );
    } catch (error) {
      const errorMessage = String(error);

      if (errorMessage.includes("Not water") ||
          errorMessage.includes("4e6f742077617465720000000000000000000000000000000000000000000000")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: "❌ You must be standing in or targeting water to fill a bucket." })
        );
      } else if (errorMessage.includes("0x34a44dbe") || 
                 errorMessage.includes("gas limit too low")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { 
            detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
          }));
      } else if (errorMessage.includes("Must use an empty Bucket") || 
                 errorMessage.includes("Must use an empty bucket") ||
                 errorMessage.includes("4d7573742075736520616e20656d707479204275636b65740000000000000000")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: "❌ You must equip an empty bucket to fill with water." })
        );
      } else {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ Fill failed: ${errorMessage}` }));
      }
    }
  }
}




