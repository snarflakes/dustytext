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

export function setAIActive(on: boolean) { active = on; }
export function isAIActive() { return active; }

// Rolling buffer of recent terminal lines (plain text)
const recentLog: string[] = [];

export function appendAILog(line: string) {
  recentLog.push(line);
  if (recentLog.length > 200) recentLog.shift();
}

export function getLogSnapshot(n = 20) {
  return recentLog.slice(-n);
}

// Optional: clear the buffer without reassigning
export function resetAILog() {
  recentLog.length = 0;
}
