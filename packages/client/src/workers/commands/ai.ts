// workers/commands/ai.ts  (adjust the relative import paths if your layout differs)
import { CommandHandler, CommandContext } from "./types";
import { getAIConfig } from "./registerAI";
import {
  setAIRuntimeConfig,
  getAIClient,
  isAIActive,
  getLogSnapshot,
  getRecentCommands,
} from "../ai/runtime";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Optional: normalize whitespace the model might return
function normalizeSuggestedCommand(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim();
}

export class AICommand implements CommandHandler {
  async execute(ctx: CommandContext, ...args: string[]): Promise<void> {
    try {
      const cfg = getAIConfig();
      if (!cfg) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail: "🤖 Configure AI first: 'registerai'.",
          })
        );
        return;
      }
      if (!isAIActive()) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: "🛑 AI is inactive." })
        );
        return;
      }

      // Keep runtime in sync with latest config
      setAIRuntimeConfig(cfg);

      // Provide the AI some recent context
      const snapshot = {
        address: ctx.address,
        recentLog: getLogSnapshot(45),
        recentCommands: getRecentCommands(8),
      };

      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: "🤖 Thinking..." })
      );

      const client = getAIClient();
      if (!client) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: "❌ AI client not ready." })
        );
        return;
      }

      let cmd = await client.getNextCommand(snapshot);
      if (!cmd) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "⚠️ AI returned no executable command (empty or disallowed).",
          })
        );
        return;
      }
      cmd = normalizeSuggestedCommand(cmd);

      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `🤖 Suggestion: <b>${cmd}</b>`,
        })
      );

      // Auto-mode: hand off to the app to execute via normal pipeline
      if (args[0] === "auto" && isAIActive()) {
        // Guard against conflicting with a human-owned queue
        // NOTE: Path mirrors src/commands/index.ts -> '../commandQueue'
        const q = await import("../../commandQueue");
        const owner =
          typeof q.getQueueOwner === "function" ? q.getQueueOwner() : null;
        const size =
          typeof q.getQueueSize === "function" ? q.getQueueSize() : 0;

        // If a human owns the unified selection queue, AI should wait
        if (owner && owner !== "ai") {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: `⏸️ AI is waiting: human has ${size} item(s) queued. Type 'done' or 'clear' to release.`,
            })
          );
          return;
        }

        // Belt & suspenders: don't let AI run 'done' on a human-owned queue
        if (cmd.toLowerCase() === "done" && owner && owner !== "ai") {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: "⛔ AI won't execute 'done' while the human owns the queue.",
            })
          );
          return;
        }

        // Hand off suggested command to the normal command pipeline
        window.dispatchEvent(
          new CustomEvent("ai-command", {
            detail: { command: cmd, source: "AI" as const },
          })
        );
      }
    } catch (e: unknown) {
      window.dispatchEvent(
        new CustomEvent("worker-log", {
          detail: `❌ AI runtime error: ${getErrorMessage(e)}`,
        })
      );
    }
  }
}
