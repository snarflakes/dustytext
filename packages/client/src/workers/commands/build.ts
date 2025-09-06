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

export class BuildCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // --- 1) Tuple-queue path ---
      const tuples = parseTuplesFromArgs(args);
      if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
        addToQueue("build", tuples, "ai"); // change to "human" if you want typed tuples to mix with clicks
        const n = queueSizeByAction("build");
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `✅ Queued ${tuples.length} build target(s). (${n} queued). Type 'done' to execute.`
        }));
        return;
      }

      const entityId = encodePlayerEntityId(context.address);

      // --- 2) Determine target coord (JSON or from player pos) ---
      let targetX = 0, targetY = 0, targetZ = 0;
      let metaName: string | undefined;
      let haveJson = false;

      if (args[0] && looksLikeJsonCoord(args[0])) {
        try {
          const parsed = JSON.parse(args[0]) as { x: number; y: number; z: number; name?: string };
          if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.z === "number") {
            targetX = parsed.x; targetY = parsed.y; targetZ = parsed.z;
            metaName = parsed.name;
            haveJson = true;
          }
        } catch { /* fall through */ }
      }

      if (!haveJson) {
        const pos = await getPlayerPos(entityId);
        // Default: build above head (y + 1). If your avatar occupies y and y+1, consider +2 instead.
        targetX = pos.x; targetY = pos.y + 1; targetZ = pos.z;
      }

      // --- 3) Must have an equipped placeable item ---
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool }).equippedTool;
      if (!equippedTool) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ You must equip a block/item to build (e.g., a seed or block). Use 'equip <item>' first."
        }));
        return;
      }

      const plantingSeed = isSeedTool(equippedTool);
      // If this looks like planting (equip is seed) and the clicked JSON block was farmland,
      // plant in the air cell above that farmland.
      if (haveJson && plantingSeed && isFarmlandName(metaName)) {
        targetY = targetY + 1;
      }

      // --- 4) Execute build (with one retry if seed on solid block) ---
      const attempt = async (x: number, y: number, z: number) => {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `🔍 Attempting to build ${equippedTool.type} at (${x}, ${y}, ${z})...`
        }));

        const packed = packCoord96(x, y, z);
        const data = encodeFunctionData({
          abi: buildAbi,
          functionName: "build",
          args: [entityId, packed, equippedTool.slot, "0x"],
        });

        const txHash = await context.sessionClient.sendTransaction({
          to: WORLD_ADDRESS,
          data,
          gas: 300000n,
        });

        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `🏗️ Built ${equippedTool.type} at (${x}, ${y}, ${z}). Tx: ${txHash}`
        }));
      };

      try {
        await attempt(targetX, targetY, targetZ);
      } catch (e) {
        const msg = String(e);
        // If holding seed and we hit "can only build on air or water", try y+1 once
        if (plantingSeed && /43616e206f6e6c79206275696c64206f6e20616972206f72207761746572/i.test(msg)) {
          // retry once at y+1
          await attempt(targetX, targetY + 1, targetZ);
        } else {
          throw e;
        }
      }

      // optional: auto-look
      //await new Promise(r => setTimeout(r, 1000));
      //try {
      //  const { getCommand } = await import("./registry");
      //  const lookCommand = getCommand("look");
      //  if (lookCommand) await lookCommand.execute(context);
      //} catch { /* no-op */ }

    } catch (error) {
      const errorMessage = String(error);

      if (
        errorMessage.includes("0xfdde54e2d7cc093a") ||
        errorMessage.includes("reverted during simulation with reason: 0xfdde54e2d7cc093a")
      ) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Cannot build here - space is already occupied or blocked."
        }));
        return;
      }

      if (errorMessage.includes("Cannot build non-block object")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ You can only build with block items, not tools or other objects."
        }));
      } else if (errorMessage.includes("43616e6e6f74206275696c64206e6f6e2d626c6f636b206f626a656374000000")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ You ran out of items to build with. Check your inventory and equip more seeds/blocks."
        }));
      } else if (errorMessage.includes("Can only build on air or water")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ This spot isn’t air/water. For seeds, target the air block above farmland (click farmland; we auto-place at +1)."
        }));
      } else if (errorMessage.includes("Cannot build where there are dropped objects")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Cannot build where items are on the ground."
        }));
      } else if (errorMessage.includes("Cannot build on a movable entity")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Cannot build where an entity is standing."
        }));
      } else {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Build failed: ${errorMessage}`
        }));
      }
    }
  }
}

