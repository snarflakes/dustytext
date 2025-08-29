// workers/commands/ai.ts
import { CommandHandler, CommandContext } from "./types";
import { getAIConfig } from "./registerAI";
import { setAIRuntimeConfig, getAIClient, isAIActive, getLogSnapshot } from "../ai/runtime";

export class AICommand implements CommandHandler {
  async execute(ctx: CommandContext, ...args: string[]) {
    const cfg = getAIConfig();
    if (!cfg) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "🤖 Configure AI first: 'registerai'." }));
      return;
    }
    if (!isAIActive()) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "🛑 AI is inactive." }));
      return;
    }

    setAIRuntimeConfig(cfg);

    const snapshot = {
      address: ctx.address,
      recentLog: getLogSnapshot(20), // last 20 terminal lines (plain text)
    };

    window.dispatchEvent(new CustomEvent("worker-log", { detail: "🤖 Thinking..." }));

    const client = getAIClient();
    if (!client) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "❌ AI client not ready." }));
      return;
    }

    const cmd = await client.getNextCommand(snapshot);
    if (!cmd) return;

    window.dispatchEvent(new CustomEvent("worker-log", { detail: `🤖 Suggestion: <b>${cmd}</b>` }));

    if (args[0] === "auto") {
      window.dispatchEvent(new CustomEvent("ai-command", { detail: { command: cmd, source: "AI" as const } }));
    }
  }
}
