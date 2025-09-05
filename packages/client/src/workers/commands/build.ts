import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { packCoord96 } from "./chunkCommit";
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";

const buildAbi = parseAbi([
  "function build(bytes32 caller, uint96 coord, uint16 slot, bytes extraData) returns (bytes32)",
]);

type EquippedTool = { slot: number; type: string; name: string } | null;

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

export class BuildCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path (works for AI/human typed coords) ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        // Mark as "ai" if you want strict one-actor-at-a-time.
        // If you want typed tuples to mix with clicks, change to "human".
        addToQueue("build", tuples, "ai");
        const n = queueSizeByAction("build");
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `✅ Queued ${tuples.length} build target(s). (${n} queued). Type 'done' to execute.`,
          })
        );
        return; // 'done' will execute them
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target coordinate ---
      // Path A: JSON coord (from done.ts)
      let targetX = 0,
        targetY = 0,
        targetZ = 0;
      let haveJsonTarget = false;

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
          // fall through to position-based path
        }
      }

      // Path B: no JSON → build at player tile (your original behavior)
      if (!haveJsonTarget) {
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
        targetY = py;   // ← build at feet for seed planting
        targetZ = pz;
      }

      // --- 3) Tool/item check (required for execution) ---
      const equippedTool = (globalThis as typeof globalThis & {
        equippedTool: EquippedTool;
      }).equippedTool;

      if (!equippedTool) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ You must equip a block or item to build. Use 'equip <item>' first.",
          })
        );
        return;
      }

      // --- 4) Execute build ---
      const packedCoord = packCoord96(targetX, targetY, targetZ);

      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `🔍 Attempting to build ${equippedTool.type} at (${targetX}, ${targetY}, ${targetZ})...`,
        })
      );

      const data = encodeFunctionData({
        abi: buildAbi,
        functionName: "build",
        args: [entityId, packedCoord, equippedTool.slot, "0x"],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `🏗️ Built ${equippedTool.type} at (${targetX}, ${targetY}, ${targetZ}). Tx: ${txHash}`,
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

      // Match your original error handling
      if (
        errorMessage.includes("0xfdde54e2d7cc093a") ||
        errorMessage.includes("reverted during simulation with reason: 0xfdde54e2d7cc093a")
      ) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ Cannot build here - space is already occupied or blocked.",
          })
        );
        return;
      }

      if (errorMessage.includes("Cannot build non-block object")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ You can only build with block items, not tools or other objects.",
          })
        );
      } else if (errorMessage.includes("Can only build on air or water")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ Cannot build here - space is already occupied.",
          })
        );
      } else if (errorMessage.includes("Cannot build where there are dropped objects")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ Cannot build where items are on the ground.",
          })
        );
      } else if (errorMessage.includes("Cannot build on a movable entity")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "❌ Cannot build where an entity is standing.",
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `❌ Build failed: ${errorMessage}`,
          })
        );
      }
    }
  }
}
