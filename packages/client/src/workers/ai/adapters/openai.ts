// workers/ai/adapters/openai.ts
import type { AIClient } from "../client";
import type { AIConfig } from "../../commands/registerAI";
import { getCustomPromptAddition } from "../../commands/customAI";

// ---------- helpers ----------
const mask = (k: string) => (k || "").replace(/^(.{6}).+(.{4})$/, "$1…$2");
type Role = "system" | "user" | "assistant";
type Message = { role: Role; content: string };

type ResponsesBody = {
  model: string;
  input: Message[];
  max_output_tokens?: number;
  temperature?: number;
  reasoning?: { effort?: "low" | "medium" | "high" };
};

function supportsTemperature(model: string): boolean {
  const m = model.toLowerCase();
  // Reasoning-family models (o1/o3/o4…) don’t accept temperature
  return !(m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4"));
}

function makeResponsesBody(
  model: string,
  input: Message[],
  maxTokens: number,
  temperature?: number
): ResponsesBody {
  const body: ResponsesBody = {
    model,
    input,
    max_output_tokens: Math.max(16, maxTokens),
  };
  if (supportsTemperature(model) && typeof temperature === "number") {
    body.temperature = temperature;
  }
  return body;
}

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

function extractNotes(lines: string[]) {
  const player: string[] = [];
  const ai: string[] = [];
  for (const l of lines) {
    if (l.startsWith("[PLAYER_SAY]")) player.push(l.replace(/^\[PLAYER_SAY\]\s*/, ""));
    else if (l.startsWith("[AI_SAY]")) ai.push(l.replace(/^\[AI_SAY\]\s*/, ""));
  }
  return { player, ai };
}

// ---- Persona presets (kept short to control tokens) ----
type PersonaKey = "tour" | "comedy" | "nav" | "logs";

const PERSONA_PRESETS: Record<PersonaKey, { label: string; system: string; allowed?: string[] }> = {
  tour: {
    label: "Dusty Tour Guide",
    system:
      [
        "## Persona: Dusty Tour Guide",
        "- Default to brief speech (apostrophe line) ONLY when the last visible human line ends with a question mark (?).",
        "- Give one practical hint at a time about what the player sees and how to use commands like `explore <dir>` and `inventory`.",
        "- Do not spam speech; otherwise behave as base rules.",
      ].join("\n"),
    allowed: ["look", "explore ", "inventory", "explore north","explore south","explore east","explore west", "skill march north","skill march east","skill march south","skill march west","'"],
  },
  comedy: {
    label: "Dusty Comedian",
    system:
      [
        "## Persona: Dusty Comedian",
        "- Prefer a brief witty one-liner (apostrophe line) ONLY when the last visible human line ends with a question mark (?).",
        "- Keep jokes short and clean; never block gameplay.",
        "- When not asked a question, follow base traversal/safety rules normally.",
      ].join("\n"),
    allowed: ["look", "explore ", "skill march ", "inventory", "'"],
  },
  nav: {
    label: "Dusty Navigation Assist",
    system:
      [
        "## Persona: Dusty Navigation Assist",
        "- Prioritize `explore <dir>` and `skill march <dir>` toward the current goal; avoid speaking unless asked (last human line ends with ?).",
        "- Do not use crafting/mining unless right next to a clear resource need; stay focused on movement.",
      ].join("\n"),
    allowed: ["explore ", "skill march ", "look"],
  },
  logs: {
    label: "Log Hunter",
    system:
      [
        "## Persona: Log Hunter",
        "Goal: find tree logs quickly and safely using only explore + march.",
        "Log names (case-insensitive): OakLog, SpruceLog, JungleLog, AcaciaLog, BirchLog, SakuraLog.",
        "Passable-as-air: Air, SwitchGrass, Fescue, Vines, HempBush, CottonBush, BambooBush, Flower, WheatSeed.",
        "Scoring from `explore <dir>` (Blocks 1–3): +5 log at +0/+1; +3 log at +2; -5 water/lava in Blocks 1–2; +1 per passable (+0/+1). Ties: prefer a direction not explored last turn.",
        "Loop: if no fresh scan: `explore <dir>`; if safe per score: `skill march <dir>`; never repeat the same `explore <dir>` twice without a move; when adjacent to a log, step next to it then `mine` (bare).",
      ].join("\n"),
    allowed: ["explore ", "skill march ", "mine"],
  },
};

function selectPersona(explicit?: PersonaKey): PersonaKey {
  // 1) If caller provided, use it
  if (explicit && PERSONA_PRESETS[explicit]) {
    return explicit;
  }

  // 2) Prompt every time
  const msg =
    "Choose your Dusty AI NPC:\n" +
    "  1) Dusty Tour Guide\n" +
    "  2) Dusty Comedian\n" +
    "  3) Dusty Navigation Assist\n" +
    "  4) Log Hunter\n" +
    "\nEnter 1-4:";
  let key: PersonaKey = "nav";
  try {
    const ans = (window.prompt?.(msg) || "").trim();
    const n = Number(ans);
    key =
      n === 1 ? "tour" :
      n === 2 ? "comedy" :
      n === 3 ? "nav" :
      n === 4 ? "logs" : "nav";
  } catch {
    // If prompt unavailable (non-browser), fall back to nav
    key = "nav";
  }
  window.dispatchEvent(new CustomEvent("worker-log", { detail: `🤖 NPC set: ${PERSONA_PRESETS[key].label}` }));
  return key;
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

// (No env branching needed for BYOK direct-to-provider)


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
  
  // BYOK: call provider directly in all envs (unless user supplied baseUrl)
  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";

  async function call(body: unknown): Promise<string> {
    if (!cfg.apiKey) throw new Error("Missing API key. Run `registerai` to set it.");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // BYOK: user’s key is required for direct browser → OpenAI call
      "Authorization": `Bearer ${cfg.apiKey}`,
    };

    if (cfg.debugLogging) {
      console.log("[AI/OpenAI] Request", {
        url: `${baseUrl}/responses`,
        model: cfg.model,
        temperature: cfg.temperature,
        max_output_tokens: cfg.maxTokens,
        key: mask(cfg.apiKey),         // 👈 masked key
        body                            // consider trimming if too verbose
      });
    }

    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) throw new Error("OpenAI 401 Unauthorized: bad or missing API key");
      if (res.status === 429) throw new Error("OpenAI 429 Rate limited: slow down or try a smaller model");
      throw new Error(`OpenAI HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data: unknown = await res.json();
    const text = extractText(data);

    if (cfg.debugLogging) {
      console.log("[AI/OpenAI] Raw response", data);
      console.log("[AI/OpenAI] Extracted text", text);
    }

    return text;
  }

  // Select persona once when the AI client is created
  const personaKey = selectPersona((cfg as any).persona as PersonaKey | undefined);
  const personaBlock = PERSONA_PRESETS[personaKey]?.system ?? "";

  return {
    async testConnection() {
      try {
        const body = makeResponsesBody(
          cfg.model,
          [{ role: "user", content: "ping" }],
          32,            // just enough for “pong”
          0              // ignored for o*-models, included for others
        );
        await call(body);
        return { ok: true, message: "connected" };
      } catch (e: unknown) {
        return { ok: false, message: toErrorMessage(e) };
      }
    },
    
    
    async getNextCommand(state: unknown) {
      try {
        // Parse snapshot safely
        const snap = asSnapshot(state);

        // Hide AI/system chatter from the model
        const cleanLog = (snap.recentLog ?? []).filter(
          (line) => !/^(You start to ai auto|🤖|🛑|🔌|⚠️|✅|💾|Tx: 0x|You start to skill march|Type 'done' to run queued|Click blocks to queue)/.test(line)
        );

        // Recent commands (lowercased)
        const recentCmds = (snap.recentCommands ?? []).map((s) => String(s).toLowerCase());
        const lastCmd = recentCmds[recentCmds.length - 1] ?? "";

        const { player: playerNotes } = extractNotes(cleanLog);

        // Keep the blob concise
        const stateBlob = JSON.stringify(
          {
            address: snap.address,
            recentCommands: recentCmds.slice(-8),
            recentLog: cleanLog.slice(-20),
          },
          null,
          2
        );
        const notesSection = "{PLAYER_NOTES}";

        // Gentle preference hints (no hard bans on repeats)
        const preferences = "{PREFERENCES}";

        // Output contract (allows speaking via leading apostrophe)
        const outputContract =
          `OUTPUT CONTRACT\n` +
          `- Return exactly ONE line.\n` +
          `- It may be EITHER:\n` +
          `  • an allowed command (lowercase keywords), OR\n` +
          `  • a speaking line that begins with a single apostrophe (').\n` +
          `- No extra text or explanations.\n`;

        // Build system prompt with persona and custom additions (checked fresh each time)
        const customAddition = getCustomPromptAddition();
        const systemPromptWithPersona = `${cfg.systemPrompt}\n\n${personaBlock}`;
        const finalSystemPrompt = customAddition
          ? `${systemPromptWithPersona}\n\nADDITIONAL INSTRUCTIONS:\n${customAddition}`
          : systemPromptWithPersona;

        // Type the prompt so TS knows role is the literal union
        const prompt: ReadonlyArray<{ role: "system" | "user"; content: string }> = [
          { role: "system", content: finalSystemPrompt },
          {
            role: "user",
            content:
              `GameState (most recent first):\n${stateBlob}\n\n` +
              notesSection +
              `${preferences}\n` +
              `${outputContract}\n` +
              // Softer fallback: you *want* occasional speech
              `If uncertain, speak briefly about your intent.\n`
              // Give it a nudge to explore variety
              //`If the last visible result was a 'look', consider "explore ${nextDir}".`,
          },
        ];

        if (cfg.debugLogging) console.log("[AI/OpenAI] Prompt", prompt);

        // Build body with proper constraints:
        const body: {
          model: string;
          input: typeof prompt;
          max_output_tokens: number;
          temperature?: number;
        } = {
          model: cfg.model,
          input: prompt,
          max_output_tokens: Math.max(16, cfg.maxTokens ?? 32),
        };

        // Some o* models reject temperature entirely (e.g., o4-mini). Guard it.
        const lower = (cfg.model || "").toLowerCase();
        const isOFamily = lower.startsWith("o"); // o1, o3, o4-mini, etc.
        if (!isOFamily && typeof cfg.temperature === "number") {
          body.temperature = cfg.temperature;
        }

        const raw = await call(body);

        // Compile allowed commands for this persona
        const personaAllowed = PERSONA_PRESETS[personaKey]?.allowed ?? cfg.allowedCommands;
        const compiledAllowed = compileAllowed(personaAllowed);

        let normalized = normalizeForExec(raw);

        // If it's a speaking line but the inside is a valid command, treat it as a command
        if (normalized.startsWith("'")) {
          const inner = normalized.slice(1).trim();
          if (isAllowedCommand(inner, compiledAllowed)) {
            normalized = inner;
          }
        }

        const allowed = isAllowedCommand(normalized, compiledAllowed);

        if (cfg.debugLogging) {
          console.log("[AI/OpenAI] Normalized", normalized, { allowed });
        }

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
    }
  };
};
