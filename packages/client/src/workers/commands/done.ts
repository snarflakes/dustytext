// workers/commands/done.ts  (adjust path if needed)
import { CommandHandler, CommandContext } from "./types";
import {
  queuedOps,
  clearSelection,
  waitIfPaused,
  type QueuedOp,
  type Block,
} from "../../commandQueue";

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

// Tune execution order to your pipeline
const ACTION_ORDER: string[] = ["till", "fill", "water", "build", "plant", "mine"];

export class DoneCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    const snapshot: QueuedOp[] = [...queuedOps]; // read once
    if (snapshot.length === 0) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "❓ No blocks queued." }));
      return;
    }

    // group by action
    const byAction: Map<string, Block[]> = new Map();
    for (const op of snapshot) {
      const arr = byAction.get(op.action) ?? [];
      arr.push(op.block as Block);
      byAction.set(op.action, arr);
    }

    // registry
    let getCommand: ((name: string) => CommandHandler | undefined) | null = null;
    try {
      const reg = await import("./registry");
      if (typeof reg.getCommand === "function") getCommand = reg.getCommand;
    } catch (e) {
      // optional registry import can fail in some environments
      // eslint-disable-next-line no-console
      console.debug("[done] registry import skipped:", e);
    }

    // optional fallback for water
    let waterFallback: ((ctx: CommandContext, block: Block) => Promise<boolean | void>) | null = null;
    try {
      const waterMod: unknown = await import("./water");
      const wf = (waterMod as { waterSingleBlock?: (ctx: CommandContext, block: Block) => Promise<boolean | void> }).waterSingleBlock;
      if (typeof wf === "function") {
        waterFallback = wf.bind(waterMod as object);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug("[done] water fallback not available:", e);
    }

    // Handle chunk commitments for mine operations before processing
    if (byAction.has("mine")) {
      const { MineCommand } = await import("./mine");
      const mineBlocks = byAction.get("mine")!;
      const coords = mineBlocks.map(block => ({ x: block.x, y: block.y, z: block.z }));
      
      try {
        await MineCommand.handleChunkCommitments(context, coords);
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `✅ Chunk commitments handled for ${coords.length} mining locations`
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Chunk commitment failed: ${error}`
        }));
        return;
      }
    }

    for (const action of ACTION_ORDER) {
      const items = byAction.get(action);
      if (!items || items.length === 0) {
        continue; // Skip actions with no queued items
      }
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `▶️ ${action}: ${items.length} block(s)...`
      }));

      const cmd = getCommand?.(action);
      let ok = 0;

      for (const block of items) {
        await waitIfPaused(); // pause point (e.g., while move runs)

        try {
          if (cmd && typeof cmd.execute === "function") {
            await cmd.execute(context, JSON.stringify(block));
            ok++;
          } else if (action === "water" && waterFallback) {
            const pass = await waterFallback(context, block);
            if (pass !== false) ok++;
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", {
              detail: `⚠️ No executor for "${action}" at (${block.x},${block.y},${block.z}).`
            }));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ ${action} failed at (${block.x},${block.y},${block.z}): ${msg}`
          }));
        }

        await delay(500);
        await waitIfPaused(); // pause window before next op
      }

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `✅ ${action} complete: ${ok}/${items.length} succeeded.`
      }));
    }

    clearSelection(); // release owner & unpause
  }
}

