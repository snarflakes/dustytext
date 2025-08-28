import type { CommandHandler, CommandContext } from "./types";
import { getAIClient, setAIRuntimeConfig, isAIActive } from "../ai/runtime";
import { getAIConfig } from "./registerAI";

// Nicely stringify errors without using `any`.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

type GameState = {
  address: string;
  sessionAccount: string;
};

async function getCurrentGameState(ctx: CommandContext): Promise<GameState> {
  const sessionAccount =
    typeof ctx.sessionClient.account === "string"
      ? ctx.sessionClient.account
      : ctx.sessionClient.account.address;

  return {
    address: ctx.address,
    sessionAccount,
  };
}

export class AICommand implements CommandHandler {
  async execute(ctx: CommandContext, ...args: string[]): Promise<void> {
    const cfg = getAIConfig();
    if (!cfg) {
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: "🤖 Configure AI first: 'registerai'."
      }));
      return;
    }

    const auto = args[0] === "auto";
    if (auto && !isAIActive()) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "🛑 AI is inactive." }));
      return;
    }

    setAIRuntimeConfig(cfg);
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "🤖 Thinking..." }));

    try {
      const client = getAIClient();
      if (!client) throw new Error("AI client not initialized");

      const state = await getCurrentGameState(ctx);
      const cmd = await client.getNextCommand(state);

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `🤖 Suggestion: <b>${cmd}</b>`
      }));

      if (auto && isAIActive() && cmd) {
        // DO NOT import runCommand here; let App.tsx execute it centrally.
        window.dispatchEvent(new CustomEvent("ai-command", {
          detail: { command: cmd, source: "AI" as const }
        }));
      }
    } catch (err: unknown) {
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ AI error: ${getErrorMessage(err)}`
      }));
    }
  }
}
