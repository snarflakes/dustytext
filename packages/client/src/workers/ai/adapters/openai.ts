// workers/ai/adapters/openai.ts
import type { AIClient } from "../client";
import type { AIConfig } from "../../commands/registerAI";

/** Safe error → message conversion (no `any`). */
function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { /* ignore */ }
  return String(e);
}

/**
 * Normalize an LLM reply to a single-line command for EXECUTION.
 * - If it starts with an apostrophe (speaking), return the raw first line (preserve casing/punctuation).
 * - Otherwise: trim, lowercase, collapse spaces, strip wrapping quotes, first line only.
 */
function normalizeForExec(s: string): string {
  const rawLine = (s ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (rawLine.startsWith("'")) {
    // speaking: keep as-is so the player text isn't mangled
    return rawLine;
  }
  // Non-speak: normalize
  return rawLine
    .replace(/^["'`]+|["'`]+$/g, "") // strip wrapping quotes/fences
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize for MATCHING against allowed rules.
 * - For speak: we only check that it begins with "'" and has content (length > 1).
 * - For others: lowercase & trim like exec normalization (but we never alter speak content).
 */
function normalizeForMatch(s: string): { isSpeak: boolean; line: string } {
  const rawLine = (s ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (rawLine.startsWith("'")) {
    return { isSpeak: true, line: rawLine }; // use raw line for speak checks
  }
  const norm = rawLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return { isSpeak: false, line: norm };
}

/** Build fast match structures from allowedCommands. */
function compileAllowed(allowedRaw: string[]) {
  let allowSpeak = false;
  const exact = new Set<string>();
  const prefixes: string[] = [];

  for (const entry of allowedRaw) {
    const e = entry.trim();
    if (!e) continue;
    if (e === "'") {
      allowSpeak = true;
      continue;
    }
    if (e.endsWith(" ")) {
      prefixes.push(e.toLowerCase());
    } else {
      exact.add(e.toLowerCase());
    }
  }
  return { allowSpeak, exact, prefixes };
}

/** Check if a normalized command is allowed by {exact, prefixes, allowSpeak}. */
function isAllowedCommand(cmdRaw: string, compiled: ReturnType<typeof compileAllowed>): boolean {
  const { isSpeak, line } = normalizeForMatch(cmdRaw);

  if (isSpeak) {
    // speaking: must start with "'" and have at least one char after it
    return compiled.allowSpeak && line.length > 1;
  }

  // exact match?
  if (compiled.exact.has(line)) return true;

  // prefix rules (e.g., "craft ", "equip ", "mine ")
  for (const p of compiled.prefixes) {
    if (line.startsWith(p) && line.length > p.length) return true;
  }

  return false;
}

export const clientOpenAI = (cfg: AIConfig): AIClient => {
  // 🚫 Guard: do not allow browser calls in production builds
  if (import.meta.env.PROD) {
    throw new Error("Refusing to call OpenAI from the browser in production. Use a server proxy.");
  }

  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
  const compiledAllowed = compileAllowed(cfg.allowedCommands ?? []);

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
              content:
                `GameState:\n${JSON.stringify(state)}\n\n` +
                `Return exactly ONE command (lowercase for command words; ` +
                `speaking is a leading apostrophe followed by your message).`,
            },
          ],
          // stop: ["\n"], // optional: cut on newline
        });

        const execCmd = normalizeForExec(text);

        // Option A: do NOT coerce; only allow exact/prefix/speak from the whitelist
        if (!isAllowedCommand(execCmd, compiledAllowed)) {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: `⚠️ AI produced disallowed command: "${text}". (ignored)`,
            })
          );
          return ""; // signal "no-op" to the runtime
        }

        return execCmd;
      } catch (e: unknown) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: `❌ AI error: ${toErrorMessage(e)}` })
        );
        return "";
      }
    },
  };
};
