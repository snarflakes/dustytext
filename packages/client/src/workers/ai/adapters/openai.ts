import type { AIClient } from "../client";
import type { AIConfig } from "../../commands/registerAI";

/** Normalize an LLM reply to a single-line command without quoting/fences. */
function normalizeCommand(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "") // strip wrapping quotes/fences
    .split(/\r?\n/)[0]               // first line only
    .replace(/\s+/g, " ")            // collapse spaces
    .trim();
}

/** Safe error → message conversion (no `any`). */
function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    /* ignore */
  }
  return String(e);
}

export const clientOpenAI = (cfg: AIConfig): AIClient => {
  // 🚫 Guard: do not allow browser calls in production builds
  if (import.meta.env.PROD) {
    throw new Error("Refusing to call OpenAI from the browser in production. Use a server proxy.");
  }

  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
  const allowed = (cfg.allowedCommands ?? []).map((s) => s.trim().toLowerCase());

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`, // dev-only!
    "Content-Type": "application/json",
    ...(cfg.extraHeaders ?? {}),
  };

  async function call(body: unknown): Promise<string> {
    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
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
        await call({
          model: cfg.model,
          input: [{ role: "user", content: "ping" }],
          temperature: 0,
          max_output_tokens: 3,
        });
        return { ok: true, message: "connected" };
      } catch (e: unknown) {
        return { ok: false, message: toErrorMessage(e) };
      }
    },

    async getNextCommand(state: unknown) {
      try {
        const text = await call({
          model: cfg.model,
          temperature: cfg.temperature,
          max_output_tokens: cfg.maxTokens, // keep small (6–8) for short commands
          input: [
            { role: "system", content: cfg.systemPrompt },
            {
              role: "user",
              content: `GameState:\n${JSON.stringify(
                state
              )}\n\nReturn exactly ONE command (lowercase, no punctuation):`,
            },
          ],
          // stop: ["\n"], // optional: cut on newline
        });

        const cmd = normalizeCommand(text);

        // Option A: do NOT coerce; only allow exact matches from the whitelist
        if (allowed.length && !allowed.includes(cmd)) {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: `⚠️ AI produced disallowed command: "${text}". (ignored)`,
            })
          );
          return ""; // signal "no-op" to the runtime
        }

        return cmd;
      } catch (e: unknown) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: `❌ AI error: ${toErrorMessage(e)}` })
        );
        return "";
      }
    },
  };
};
