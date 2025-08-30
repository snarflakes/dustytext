// workers/ai/runtime.ts
import type { AIConfig } from "../commands/registerAI";
import type { AIClient } from "./client";
import { createAIClient } from "./client";

let current: AIConfig | null = null;
let client: AIClient | null = null;
let active = false;

export function setAIRuntimeConfig(cfg: AIConfig) {
  current = cfg;
  client = createAIClient(cfg);
}

export function getAIClient() { return client; }
export function getAIRuntimeConfig() { return current; }

export function setAIActive(on: boolean) {
  active = on;
  if (!on) {
    // clear rolling buffers when turning OFF
    recentLog.length = 0;
    recentCommands.length = 0;
  }
}

export function isAIActive() { return active; }

// ---- rolling buffers (const bindings; we mutate contents) ----
const recentLog: string[] = [];
const recentCommands: string[] = [];

// Feed plain-text terminal lines (strip HTML in the caller)
export function appendAILog(line: string) {
  recentLog.push(line);
  if (recentLog.length > 200) recentLog.shift();
}

export function getLogSnapshot(n = 20) {
  return recentLog.slice(-n);
}

// Track executed/suggested commands (for anti-repeat, etc.)
export function recordAICommand(cmd: string) {
  if (!cmd) return;
  recentCommands.push(cmd);
  if (recentCommands.length > 20) recentCommands.shift();
}

export function getRecentCommands(n = 5) {
  return recentCommands.slice(-n);
}
export function recordExecutedCommand(cmd: string) {
  recordAICommand(cmd); // alias so your import matches
}
