import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";

const tillAbi = parseAbi([
  "function till(bytes32 caller, uint96 coord, uint16 toolSlot) returns (bytes32)",
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

export class TillCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path (for AI/human typed coords): doesn't require tool equipped ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        addToQueue("till", tuples, "ai"); // or "human" if you prefer; ownership rule applies
        const n = queueSizeByAction("till");
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `✅ Queued ${tuples.length} till target(s). (${n} queued). Type 'done' to execute.`,
          })
        );
        return; // done.ts will execute them
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target coordinate ---
      // Path A: JSON coord (from done.ts -> cmd.execute(ctx, JSON.stringify(block)))
      let useJsonTarget = false;
      let targetX = 0,
        targetY = 0,
        targetZ = 0;

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
            useJsonTarget = true;
          }
        } catch {
          // fall through to position-based path
        }
      }

      // Path B: no JSON → till directly below player feet (y - 1)
      if (!useJsonTarget) {
        const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
        const posRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
        });

        if (!posRes.ok) {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: "❌ Could not get position",
            })
          );
          return;
        }

        const posJson = await posRes.json();
        const posRows = posJson?.result?.[0];
        if (!Array.isArray(posRows) || posRows.length < 2) {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: "❌ No position found",
            })
          );
          return;
        }

        const [posCols, posVals] = posRows;
        const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
        const px = Number(pos.x ?? 0);
        const py = Number(pos.y ?? 0);
        const pz = Number(pos.z ?? 0);

        targetX = px;
        targetY = py - 1; // till the block below the player
        targetZ = pz;
      }

      // --- 3) Tool check (required for execution) ---
      const equippedTool = (globalThis as typeof globalThis & {
        equippedTool: EquippedTool;
      }).equippedTool;

      if (!equippedTool || !equippedTool.type?.toLowerCase().includes("hoe")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ You must equip a hoe to till. Use 'equip wooden hoe' first.",
          })
        );
        return;
      }

      // --- 4) Execute till ---
      const packedCoord = packCoord96(targetX, targetY, targetZ);
      const data = encodeFunctionData({
        abi: tillAbi,
        functionName: "till",
        args: [entityId, packedCoord, equippedTool.slot],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `🌾 Tilled ground at (${targetX}, ${targetY}, ${targetZ}) using ${equippedTool.type}. Tx: ${txHash}`,
        })
      );

      // optional: auto-look
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const { getCommand } = await import("./registry");
        const lookCommand = getCommand("look");
        if (lookCommand) await lookCommand.execute(context);
      } catch {
        /* no-op */
      }
    } catch (error) {
      const errorMessage = String(error);

      if (
        errorMessage.includes("Not tillable") ||
        errorMessage.includes("4e6f742074696c6c61626c650000000000000000000000000000000000000000")
      ) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "❌ This land has already been tilled or cannot be tilled. Try dirt or grass that hasn't been tilled yet.",
          })
        );
      } else if (
        errorMessage.includes("Must equip a hoe") ||
        errorMessage.includes("4d757374206571756970206120686f6500000000000000000000000000000000")
      ) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ You must equip a hoe to till ground. Your hoe may have broken - check your inventory.",
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `❌ Till failed: ${errorMessage}`,
          })
        );
      }
    }
  }
}

