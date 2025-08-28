import type { AIConfig } from "../commands/registerAI";
import { clientOpenAI } from "./adapters/openai";
// import { clientAzure } from "./adapters/azure";
// import { clientOpenRouter } from "./adapters/openrouter";

export interface AIClient {
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  getNextCommand(state: unknown): Promise<string>;
}

function assertNever(x: never): never {
  throw new Error(`Unsupported provider: ${String(x)}`);
}

export function createAIClient(cfg: AIConfig): AIClient {
  switch (cfg.provider) {
    case "OpenAI": return clientOpenAI(cfg);
    // case "Azure OpenAI": return clientAzure(cfg);
    // case "OpenRouter": return clientOpenRouter(cfg);
    case "Custom": throw new Error("Custom provider not implemented");
    default: return assertNever(cfg.provider as never);
  }
}
