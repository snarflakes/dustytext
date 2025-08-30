// workers/ai/adapters/openai.ts
import type { AIClient } from "../client";
import type { AIConfig } from "../../commands/registerAI";

// ---------- helpers ----------
type AllowedSpec = { exact: Set<string>; prefixes: string[]; allowSpeak: boolean };

function compileAllowed(list: string[] | undefined): AllowedSpec {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  let allowSpeak = false;
  for (const raw of list ?? []) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    if (s === "'") { allowSpeak = true; continue; }
    if (s.endsWith(" ")) { prefixes.push(s); continue; }
    exact.add(s);
  }
  return { exact, prefixes, allowSpeak };
}

function normalizeForExec(raw: string): string {
  const firstLine = String(raw ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (!firstLine) return "";
  if (firstLine.startsWith("'")) return firstLine;
  return firstLine.toLowerCase().replace(/^>+\s*/, "");
}

function isAllowedCommand(cmd: string, a: AllowedSpec): boolean {
  if (!cmd) return false;
  if (a.allowSpeak && cmd.startsWith("'")) return true;
  const lc = cmd.toLowerCase();
  if (a.exact.has(lc)) return true;
  return a.prefixes.some((p) => lc.startsWith(p) && lc.length > p.length);
}

function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

// Types that cover both Responses API and Chat Completions fallbacks.
type OutputBlock = { type?: string; text?: string; value?: string; content?: string };
type OutputMessage = { type?: string; role?: string; content?: OutputBlock[] } & Record<string, unknown>;
type OpenAIResponseShape = {
  output_text?: unknown;
  text?: { value?: unknown };
  output?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
} & Record<string, unknown>;

/** Safely extract plain text from Responses JSON or Chat Completions JSON */
function extractText(data: unknown): string {
  const d = data as OpenAIResponseShape;

  // 1) New Responses API convenience field
  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text.trim();

  // 2) Responses API main structure: output[*].content[*].text
  if (Array.isArray(d.output)) {
    for (const item of d.output as OutputMessage[]) {
      if (Array.isArray(item?.content)) {
        for (const block of item.content) {
          if (typeof block?.text === "string" && block.text.trim()) return block.text.trim();
          if (typeof block?.value === "string" && block.value.trim()) return block.value.trim();
          if (typeof block?.content === "string" && block.content.trim()) return block.content.trim();
        }
      }
      // Some providers put a direct "text" field on the message
      const maybeText = (item as Record<string, unknown>)["text"];
      if (typeof maybeText === "string" && maybeText.trim()) return maybeText.trim();
    }
  }

  // 3) Some SDKs expose text.value
  if (typeof d.text?.value === "string" && d.text.value.trim()) return d.text.value.trim();

  // 4) Chat Completions fallback
  const c0 = d.choices?.[0]?.message?.content;
  if (typeof c0 === "string" && c0.trim()) return c0.trim();

  return "";
}
// --------------------------------

// Narrow import.meta typing without `any`
type MetaWithEnv = ImportMeta & { env?: { PROD?: boolean } };
const isProd = Boolean((import.meta as MetaWithEnv).env?.PROD);


// ---- Snapshot helpers (type-safe view of the state we pass to the LLM) ----
type Snapshot = {
  address?: string;
  recentLog?: string[];
  recentCommands?: string[];
};

function asSnapshot(u: unknown): Snapshot {
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;

    const address =
      typeof o.address === "string" ? o.address : undefined;

    // recentLog: coerce any array-ish into string[]
    let recentLog: string[] = [];
    const rl = (o as { recentLog?: unknown }).recentLog;
    if (Array.isArray(rl)) {
      recentLog = rl.map((s) => String(s));
    }

    // recentCommands: coerce to lowercase string[]
    let recentCommands: string[] = [];
    const rc = (o as { recentCommands?: unknown }).recentCommands;
    if (Array.isArray(rc)) {
      recentCommands = rc.map((s) => String(s).toLowerCase());
    }

    return { address, recentLog, recentCommands };
  }
  return { recentLog: [], recentCommands: [] };
}

export const clientOpenAI = (cfg: AIConfig): AIClient => {
  // In prod, call your serverless proxy. In dev, call OpenAI directly.
  const baseUrl = cfg.baseUrl ?? (isProd ? "/api/ai" : "https://api.openai.com/v1");

  async function call(body: unknown): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    // Only attach Authorization when calling OpenAI directly from the browser (dev)
    if (!isProd && baseUrl.includes("api.openai.com")) {
      headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    }

    if (cfg.debugLogging) {
      console.log("[AI/OpenAI] Request", { url: `${baseUrl}/responses`, body });
    }

    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
    }

    const data: unknown = await res.json();
    const text = extractText(data);

    if (cfg.debugLogging) {
      console.log("[AI/OpenAI] Raw response", data);
      console.log("[AI/OpenAI] Extracted text", text);
    }

    return text;
  }

  const compiledAllowed = compileAllowed(cfg.allowedCommands);

  return {
    async testConnection() {
      try {
        await call({
          model: cfg.model,
          input: [{ role: "user", content: "ping" }],
          temperature: 0,
          max_output_tokens: 32, // must be >= 16
        });
        return { ok: true, message: "connected" };
      } catch (e: unknown) {
        return { ok: false, message: toErrorMessage(e) };
      }
    },

    async getNextCommand(state: unknown) {
      try {
        // Parse snapshot safely
        const snap = asSnapshot(state);

        // Filter out AI/system chatter so the model sees only game-relevant info
        const cleanLog = (snap.recentLog ?? []).filter((line) =>
          !/^(You start to ai auto|🤖|🛑|🔌|⚠️|✅|💾)/.test(line)
        );

        // Look at what we did recently
        const recentCmds = (snap.recentCommands ?? []).map((s) => String(s).toLowerCase());
        const lastCmd = recentCmds[recentCmds.length - 1] ?? "";

        // Pick a direction we haven’t used in the last couple explores
        const dirCycle = ["north","east","south","west","northeast","northwest","southeast","southwest"];
        const lastExplores = recentCmds.filter((c) => c.startsWith("explore ")).slice(-2);
        const recentlyTried = lastExplores.map((c) => c.replace(/^explore\s+/, ""));
        const nextDir = dirCycle.find((d) => !recentlyTried.includes(d)) ?? "north";

        // Keep the blob concise
        const stateBlob = JSON.stringify(
          {
            address: snap.address,
            recentCommands: recentCmds.slice(-8),
            recentLog: cleanLog.slice(-40), // last few useful lines
          },
          null,
          2
        );

        // Gentle preference hints (no hard bans on repeats)
        const preferences =
          `Preferences:\n` +
          `- Previous command: ${lastCmd || "none"}.\n` +   // <- just context, not a rule
          `- After a successful "look", prefer "explore ${nextDir}".\n` +
          `- It’s OK to repeat if truly best; vary explore directions when possible.\n`;
        
        const prompt = [
          { role: "system", content: cfg.systemPrompt },
          {
            role: "user",
            content:
              `GameState (most recent first):\n${stateBlob}\n\n` +
              `${preferences}\n` +
              `Return exactly ONE command from the allowed set. ` +
              `If unsure, choose "explore ${nextDir}".`
          },
        ];

        if (cfg.debugLogging) console.log("[AI/OpenAI] Prompt", prompt);

        const raw = await call({
          model: cfg.model,
          temperature: cfg.temperature,
          max_output_tokens: Math.max(16, cfg.maxTokens ?? 32),
          input: prompt,
        });

        const normalized = normalizeForExec(raw);
        const allowed = isAllowedCommand(normalized, compiledAllowed);

        if (cfg.debugLogging) console.log("[AI/OpenAI] Normalized", normalized, { allowed });

        if (!allowed) {
          window.dispatchEvent(
            new CustomEvent("worker-log", {
              detail: `⚠️ AI produced disallowed command: "${raw}" → normalized "${normalized}". Ignored.`,
            })
          );
          return "";
        }

        return normalized;
      } catch (e: unknown) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: `❌ AI error: ${toErrorMessage(e)}` })
        );
        return "";
      }


    
    
    
    
    },
  };
};
