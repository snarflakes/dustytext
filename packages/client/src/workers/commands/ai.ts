// workers/commands/ai.ts
import { CommandHandler, CommandContext } from "./types";
import { getAIConfig } from "./registerAI";
import {
  setAIRuntimeConfig,
  getAIClient,
  isAIActive,
  getLogSnapshot,
  getRecentCommands
} from "../ai/runtime";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
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

      // Ensure runtime uses latest config each invocation
      setAIRuntimeConfig(cfg);

      const snapshot = {
        address: ctx.address,
        recentLog: getLogSnapshot(45), // last 20 terminal lines (plain text)
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

      const cmd = await client.getNextCommand(snapshot);

      if (!cmd) {
        window.dispatchEvent(
          new CustomEvent("worker-log", {
            detail:
              "⚠️ AI returned no executable command (empty or disallowed).",
          })
        );
        return;
      }

      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: `🤖 Suggestion: <b>${cmd}</b>` })
      );

      // Auto-mode: hand off to the app to execute via normal pipeline
      if (args[0] === "auto" && isAIActive()) {
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
