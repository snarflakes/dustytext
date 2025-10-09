// plant.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { packCoord96 } from "./chunkCommit";
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

function isSeedTool(tool: EquippedTool): boolean {
  if (!tool) return false;
  return /seed/i.test(tool.type) || (!!tool.name && /seed/i.test(tool.name));
}
function isFarmlandName(name?: string): boolean {
  return !!name && /(wet)?\s*farmland|tilled/i.test(name);
}

async function getPlayerPos(entityId: string) {
  const q = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${entityId}'`;
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query: q }]),
  });
  if (!res.ok) throw new Error("Could not get position");
  const js = await res.json();
  const rows = js?.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("No position found");
  const [cols, vals] = rows;
  const pos = Object.fromEntries(cols.map((k: string, i: number) => [k, vals[i]]));
  return { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
}

export class PlantCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path (e.g., "plant (1,2,3) (4,5,6)") ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        addToQueue("plant", tuples, "ai"); // change to "human" if you want typed tuples to mix with clicks
        const n = queueSizeByAction("plant");
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `🌾 Queued ${tuples.length} planting spot(s). (${n} total queued). Type 'done' to sow them all.`,
          }),
        );
        return;
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target coord (JSON or from player pos) ---
      let targetX = 0,
        targetY = 0,
        targetZ = 0;
      let metaName: string | undefined;
      let haveJson = false;

      if (args[0] && looksLikeJsonCoord(args[0])) {
        try {
          const parsed = JSON.parse(args[0]) as { x: number; y: number; z: number; name?: string };
          if (
            parsed &&
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            typeof parsed.z === "number"
          ) {
            targetX = parsed.x;
            targetY = parsed.y;
            targetZ = parsed.z;
            metaName = parsed.name;
            haveJson = true;
          }
        } catch {
          /* ignore */
        }
      }

      if (!haveJson) {
        const pos = await getPlayerPos(entityId);
        // Default planting base: at your feet (y).
        targetX = pos.x;
        targetY = pos.y;
        targetZ = pos.z;
      }

      // --- 3) Must have an equipped *seed* item ---
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool }).equippedTool;

      if (!equippedTool) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "🌱 You’re holding nothing to sow. Equip a seed first (e.g., `equip wheat seed`), then try `plant`.",
          }),
        );
        return;
      }

      const plantingSeed = isSeedTool(equippedTool);
      if (!plantingSeed) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "🧱 That’s a block/tool, not a seed. Use `build` for blocks, or `equip <seed>` to plant.",
          }),
        );
        return;
      }

      // If this looks like planting onto farmland (from a clicked JSON coord),
      // place the seed in the air cell above the farmland.
      if (haveJson && isFarmlandName(metaName)) {
        targetY = targetY + 1;
      }

      // --- 4) Execute plant (with one graceful retry) ---
      const attempt = async (x: number, y: number, z: number) => {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `🌱 Sowing ${equippedTool.name ?? equippedTool.type} at (${x}, ${y}, ${z})…`,
          }),
        );

        const packed = packCoord96(x, y, z);
        const data = encodeFunctionData({
          abi: IWorldAbi,
          functionName: "build",
          args: [entityId, packed, equippedTool.slot, "0x"],
        });

        const txHash = await context.sessionClient.sendTransaction({
          to: WORLD_ADDRESS,
          data,
          gas: 300000n,
        });

        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `🌿 Seed tucked into the soil at (${x}, ${y}, ${z}). Tx: ${txHash}`,
          }),
        );
      };

      try {
        await attempt(targetX, targetY, targetZ);
      } catch (e) {
        const msg = String(e);
        // If we get the classic "Can only build on air or water", try one block higher.
        if (/43616e206f6e6c79206275696c64206f6e20616972206f72207761746572/i.test(msg)) {
          await attempt(targetX, targetY + 1, targetZ);
        } else {
          throw e;
        }
      }

      // optional: auto-look
      // await new Promise(r => setTimeout(r, 1000));
      // try {
      //   const { getCommand } = await import("./registry");
      //   const lookCommand = getCommand("look");
      //   if (lookCommand) await lookCommand.execute(context);
      // } catch { /* no-op */ }

    } catch (error) {
      const errorMessage = String(error);

      if (
        errorMessage.includes("0xfdde54e2d7cc093a") ||
        errorMessage.includes("reverted during simulation with reason: 0xfdde54e2d7cc093a")
      ) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "🚫 This plot is already occupied. Try a nearby patch of soil.",
          }),
        );
        return;
      }

      if (errorMessage.includes("Cannot build non-block object")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "🌾 This item can’t be planted. Equip a proper seed and try again.",
          }),
        );
      } else if (
        errorMessage.includes(
          "43616e6e6f74206275696c64206e6f6e2d626c6f636b206f626a656374000000",
        )
      ) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "🧺 You’ve run out of seeds. Restock your pouch, equip them, and sow once more.",
          }),
        );
      } else if (errorMessage.includes("Can only build on air or water") ||
                 errorMessage.includes("43616e206f6e6c79206275696c64206f6e20616972206f72207761746572")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "🌱 This spot already has a plant or block. Seeds need empty air above farmland to grow.",
          }),
        );
      } else if (errorMessage.includes("Cannot build where there are dropped objects")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "🧹 The ground is cluttered. Pick up the dropped items before planting.",
          }),
        );
      } else if (errorMessage.includes("Cannot build on a movable entity")) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "👣 Someone’s standing in this garden bed. Give them a moment to step aside.",
          }),
        );
      
      } else if (errorMessage.includes("Cannot plant on this block") ||
                 errorMessage.includes("43616e6e6f7420706c616e74206f6e207468697320626c6f636b")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Cannot plant seeds on this block type. Seeds need to be planted on farmland ('till'ed dirt) that has been watered by a water bucket."
        }));
    
      } else {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: `❌ Planting failed: ${errorMessage}`,
          }),
        );
      }
    }
  }
}
