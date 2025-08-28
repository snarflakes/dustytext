// workers/ai/adapters/openai.ts
import type { AIClient } from "../client";
import type { AIConfig } from "../../commands/registerAI";
import { coerceToSingleCommand } from "../validator";

export const clientOpenAI = (cfg: AIConfig): AIClient => {
  // 🚫 Guard: do not allow browser calls in production builds
  if (import.meta.env.PROD) {
    throw new Error("Refusing to call OpenAI from the browser in production. Use a server proxy.");
  }

  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";

  async function call(body: unknown) {
    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,   // <-- dev-only!
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const text = data.output_text ?? data.choices?.[0]?.message?.content ?? "";
    return String(text).trim();
  }

  return {
    async testConnection() {
      try {
        await call({ model: cfg.model, input: [{ role: "user", content: "ping" }], temperature: 0, max_output_tokens: 3 });
        return { ok: true, message: "connected" };
      } catch (e: unknown) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    },
    async getNextCommand(state: unknown) {
      const text = await call({
        model: cfg.model,
        temperature: cfg.temperature,
        max_output_tokens: cfg.maxTokens,
        input: [
          { role: "system", content: cfg.systemPrompt },
          { role: "user", content: `GameState:\n${JSON.stringify(state)}\n\nReturn exactly ONE command.` }
        ]
      });
      return coerceToSingleCommand(text);
    }
  };
};
