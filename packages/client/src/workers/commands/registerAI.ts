// registerai.ts
import { CommandHandler, CommandContext } from './types';
import { setAIRuntimeConfig, getAIClient } from "../ai/runtime";

function sanitizeApiKey(raw: string): string {
  // strip surrounding quotes/spaces and zero-width junk
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")      // zero-width spaces
    .replace(/^[\s'"]+|[\s'"]+$/g, "")          // leading/trailing spaces/quotes
    .trim();
}

// --- session-only remember (per-tab) ---
const SESSION_KEY = "dustytext_user_api_key";
function rememberKeyInThisTab(k: string) { sessionStorage.setItem(SESSION_KEY, k); }
function restoreKeyFromThisTab(): string | null { return sessionStorage.getItem(SESSION_KEY); }
function forgetKeyInThisTab() { sessionStorage.removeItem(SESSION_KEY); }

function maskKey(key: string): string {
  return (key || "").replace(/^(.{6}).+(.{4})$/, "$1…$2");
}

export interface AIConfig {
  provider: 'OpenAI' | 'Azure OpenAI' | 'OpenRouter' | 'Custom';
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  rememberSettings: boolean; // repurposed to mean "remember in this tab" (sessionStorage)
  allowedCommands?: string[];

  // Azure OpenAI specific
  endpoint?: string;
  deploymentName?: string;
  apiVersion?: string;
  
  // Custom/OpenRouter specific
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  
  // Optional settings
  rateLimit?: number;
  retryPolicy?: number;
  debugLogging?: boolean;
}

// In-memory storage (lost on disconnect)
let aiConfig: AIConfig | null = null;

// Setup state management
interface SetupState {
  step: number;
  config: Partial<AIConfig>;
  isActive: boolean;
}

let setupState: SetupState = {
  step: 0,
  config: {},
  isActive: false
};

export const DEFAULT_SYSTEM_PROMPT = `You are an AI living in a text-based game called Dusty Text.
Your job is to analyze the game state and output exactly ONE next action (one line). Find logs, be efficient, and SAFE.

Key game system:

1. Share brief thoughts by starting the line with a single apostrophe (') instead of a command.
2. Prioritize traversal, but always use safe skills (see Traversal & Safety).

Traversal & Safety (IMPORTANT):

- NEVER output raw "move …". Use "skill march <dir>" for ALL walking.
- "skill march" supports CARDINALS ONLY: north | east | south | west (NO diagonals).
- **Precondition for march:** "skill march <dir>" needs a fresh scan for that direction. If you lack one or you consumed its safe steps, issue "explore <dir>" first.
- **Explore → March cadence:** "explore <dir>" to get a 5-tile horizon, then "skill march <dir>" to consume up to the safe steps. Re-explore after ~4–5 steps, or sooner if blocked/hazard is suspected.
- March automatically stops before water/lava or illegal drops (>2 down). Do NOT try to force movement into hazards.

Engine messages & recovery (READ THE LOG):

- If you see:
  • "❌ Cannot move through solid blocks. Try moving around or mining the obstruction first."
  • "[SYSTEM] march paused: re-scan or reroute needed"
  treat this as **BLOCKED or STALE SCAN**.
  Your response should be:
  1) If you just tried "skill march <dir>", issue **"explore <same-dir>"** to refresh; then try **"skill march <same-dir>"** again if safe.
  2) If it immediately pauses again (e.g., dense trees/stone ahead), **reroute**: pick a perpendicular cardinal that still improves your goal (see Goals), e.g., after "north" try "east" or "west":
     - "explore east" → "skill march east"
     - Later, turn back toward the goal axis ("north") when clear.

- Do NOT repeat the same failing "skill march <dir>" without an intervening "explore <dir>".
- Ignore "💡 Type 'done' to run queued mine tasks." unless you (the AI) just intentionally queued mines; do not output 'done' for explore tables.

Exploration:

- "explore" gives a 360° short scan of adjacent tiles.
- "explore <dir>" (north/east/south/west) looks 5 tiles out.
- Prefer to move several tiles before re-exploring the same direction, unless blocked.

Coordinate System:

- Positions are (X,Y,Z). Y is elevation: positive is up, negative is down. +X = East / -X = West. +Z = South / -Z = North.
- Do not decrease Y by more than 2 in a single change.
- You cannot enter a space without TWO stacked walkable cells (air or passable vegetation) and a solid support below.

Goal Coordinates (when provided):

- You may see a machine-readable goal like:
  [GOAL_COORD] {"x": -300, "y": 58, "z": 500}
- Success = entering the 5×5 square centered on (x,z): abs(X - x) <= 2 AND abs(Z - z) <= 2. Y is advisory; do NOT jump off cliffs to match Y.
- **Cardinal steering:** choose the axis (X or Z) with the larger absolute delta; if similar, alternate axes across turns (e.g., east this turn, north next turn).
- **Cadence toward goal:** If no fresh scan for the chosen axis, "explore <dir>" then "skill march <dir>". If "march" blocks or pauses after auto-explore, try a perpendicular cardinal that still reduces the remaining distance, then return to the main axis when clear.

Output Contract:

- Return exactly ONE line.
- It must be either:
  • an allowed command (lowercase keywords), OR
  • a speaking line starting with a single apostrophe (').
- No extra text or explanations.
Be concise and strategic. If uncertain, "explore <dir>" before marching.`;

export const DEFAULT_ALLOWED_COMMANDS = [

  // no-arg
  "look","help","inventory","health","survey",

  // explore (CARDINALS ONLY for the AI)
  "explore",
  "explore north","explore south","explore east","explore west",

  // skills (explicitly enumerate SAFE traversal options for the LLM)

  "skill march north","skill march east","skill march south","skill march west",

  // speaking: any line that starts with a single apostrophe is allowed

  "'"
];

export function buildDefaultSystemPrompt(allowed: string[]): string {
  const shown = allowed.map(c => {
    if (c === "'") return "'<message>' (example: 'I am here.)";
    if (c.endsWith(" ")) return `${c}<value>`;
    return c;
  });

  return `${DEFAULT_SYSTEM_PROMPT}

STRICT OUTPUT RULES:
- Return exactly ONE command from the allowed set below.
- Lowercase for command words; speaking may include punctuation/capitalization after the leading apostrophe.
- No surrounding quotes or extra text.

Allowed commands:
${shown.join(", ")}
`;
}

export class RegisterAICommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const subCommand = args[0]?.toLowerCase();
    
    if (subCommand === 'status') {
      this.showStatus();
      return;
    }
    
    if (subCommand === 'clear') {
      aiConfig = null;
      setupState = { step: 0, config: {}, isActive: false };
      forgetKeyInThisTab();
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🤖 AI configuration cleared" 
      }));
      return;
    }

    if (subCommand === 'cancel') {
      setupState = { step: 0, config: {}, isActive: false };
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🤖 AI setup cancelled" 
      }));
      return;
    }
    
    // Handle setup responses
    if (setupState.isActive) {
      this.handleSetupInput(args.join(' '));
      return;
    }
    
    // Start interactive setup
    this.startInteractiveSetup();
  }
  
  private showStatus(): void {
    if (!aiConfig) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🤖 No AI configuration set. Use 'registerai' to configure." 
      }));
      return;
    }
    
    const status = [
      "🤖 Current AI Configuration:",
      `  Provider: ${aiConfig.provider}`,
      `  Model: ${aiConfig.model}`,
      `  Temperature: ${aiConfig.temperature}`,
      `  Max Tokens: ${aiConfig.maxTokens}`,
      `  Rate Limit: ${aiConfig.rateLimit || 1000}ms`,
      `  Debug Logging: ${aiConfig.debugLogging ? 'Yes' : 'No'}`,
      `  Remember in this tab: ${aiConfig.rememberSettings ? 'Yes' : 'No'}`,
    ];
    
    if (aiConfig.provider === 'Azure OpenAI') {
      status.push(`  Endpoint: ${aiConfig.endpoint || 'Not set'}`);
      status.push(`  Deployment: ${aiConfig.deploymentName || 'Not set'}`);
      status.push(`  API Version: ${aiConfig.apiVersion || 'Not set'}`);
    }
    
    if (aiConfig.provider === 'Custom' || aiConfig.provider === 'OpenRouter') {
      status.push(`  Base URL: ${aiConfig.baseUrl || 'Not set'}`);
    }
    
    status.forEach(line => {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: line }));
    });
  }
  
  private startInteractiveSetup(): void {
    setupState = { step: 1, config: {}, isActive: true };
    
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "🤖 AI Configuration Setup" 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "Type 'registerai cancel' at any time to exit setup." 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "" 
    }));
    
    this.showStep1();
  }

  private handleSetupInput(input: string): void {
    const trimmed = input.trim();
    
    switch (setupState.step) {
      case 1: // Provider selection
        this.handleProviderSelection(trimmed);
        break;
      case 2: // API Key
        this.handleApiKey(trimmed);
        break;
      case 3: // Model
        this.handleModel(trimmed);
        break;
      case 4: // Temperature
        this.handleTemperature(trimmed);
        break;
      case 5: // Max Tokens
        this.handleMaxTokens(trimmed);
        break;
      case 6: // Azure/Custom specific settings
        this.handleProviderSpecific(trimmed);
        break;
      case 7: // Rate limit
        this.handleRateLimit(trimmed);
        break;
      case 8: // Retry policy
        this.handleRetryPolicy(trimmed);
        break;
      case 9: // Debug logging
        this.handleDebugLogging(trimmed);
        break;
      case 10: // Remember settings (session-only)
        this.handleRememberSettings(trimmed);
        break;
      case 11: // System prompt
        this.handleSystemPrompt(trimmed);
        break;
    }
  }

  private showStep1(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 1/11: Select AI Provider" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "1. OpenAI (standard GPT models)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "2. Azure OpenAI (enterprise deployment)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "3. OpenRouter (access to multiple models)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "4. Custom (local LM Studio, etc.)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter choice (1-4):" }));
  }

  private handleProviderSelection(input: string): void {
    const choice = parseInt(input);
    const providers = ['OpenAI', 'Azure OpenAI', 'OpenRouter', 'Custom'] as const;
    
    if (choice >= 1 && choice <= 4) {
      setupState.config.provider = providers[choice - 1];
      setupState.step = 2;
      this.showStep2();
    } else {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Invalid choice. Enter 1, 2, 3, or 4: registerai [number]" 
      }));
    }
  }

  private showStep2(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `Step 2/11: API Key for ${setupState.config.provider}` 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter your API key:" }));
    
    if (setupState.config.provider === 'OpenAI') {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "💡 Get your key at: https://platform.openai.com/api-keys" 
      }));
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🔐 Your key stays in this tab and never hits our servers." 
      }));
    }
  }

  private handleApiKey(input: string): void {
    const key = sanitizeApiKey(input);

    if (key.length < 20) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ API key seems too short. Please enter a valid API key: registerai [your-api-key]" 
      }));
      return;
    }

    // Optional: gentle format hint (don’t hard fail)
    const looksOk =
      /^sk-[A-Za-z0-9_-]+$/.test(key) || /^sk-proj-[A-Za-z0-9_-]+$/.test(key);
    if (!looksOk) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "⚠️ Key format looks unusual. If this fails, paste again without quotes/spaces." 
      }));
    }

    setupState.config.apiKey = key;
    setupState.step = 3;
    this.showStep3();
  }

  private showStep3(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 3/11: Model Selection" }));
    
    const suggestions = {
      'OpenAI': 'gpt-4.1-mini, o4-mini, gpt-4o, gpt-3.5-turbo',
      'Azure OpenAI': 'gpt-4, gpt-35-turbo (deployment name)',
      'OpenRouter': 'openai/gpt-4o-mini, anthropic/claude-3-sonnet',
      'Custom': 'depends on your local setup'
    };
    
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `Suggested models: ${suggestions[setupState.config.provider!]}` 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter model name:" }));
  }

  private handleModel(input: string): void {
    if (!input) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Model name cannot be empty: registerai [model-name]" 
      }));
      return;
    }
    
    setupState.config.model = input;
    setupState.step = 4;
    this.showStep4();
  }

  private showStep4(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 4/11: Temperature (creativity level)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "0.0 = deterministic, 1.0 = very creative (default: 0.3). Note: o*-models (o1/o3/o4) ignore temperature." 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter temperature (0-1):" }));
  }

  private handleTemperature(input: string): void {
    const temp = parseFloat(input);
    if (isNaN(temp) || temp < 0 || temp > 1) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Temperature must be between 0 and 1: registerai [number]" 
      }));
      return;
    }
    
    setupState.config.temperature = temp;
    setupState.step = 5;
    this.showStep5();
  }

  private showStep5(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 5/11: Max Tokens per Response" }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "32-64 recommended for single commands (default: 50). For long thinking models (o4 family), larger limits may be needed." 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter max tokens:" }));
  }

  private handleMaxTokens(input: string): void {
    const tokens = parseInt(input);
    if (isNaN(tokens) || tokens < 32 || tokens > 1500) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Max tokens must be between 32 and 1500: registerai [number]" 
      }));
      return;
    }
    
    setupState.config.maxTokens = tokens;
    
    // Skip to step 7 for OpenAI, handle provider-specific for others
    if (setupState.config.provider === 'OpenAI') {
      setupState.step = 7;
      this.showStep7();
    } else {
      setupState.step = 6;
      this.showStep6();
    }
  }

  private showStep6(): void {
    const provider = setupState.config.provider!;
    
    if (provider === 'Azure OpenAI') {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 6/11: Azure OpenAI Configuration" }));
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter endpoint URL: [https://your-resource.openai.azure.com/]" }));
    } else if (provider === 'Custom' || provider === 'OpenRouter') {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 6/11: Base URL Configuration" }));
      const example = provider === 'Custom' ? 'http://localhost:1234/v1' : 'https://openrouter.ai/api/v1';
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `Enter base URL (e.g., ${example}): [url]` }));
    }
  }

  private handleProviderSpecific(input: string): void {
    const provider = setupState.config.provider!;
    
    if (provider === 'Azure OpenAI') {
      if (!setupState.config.endpoint) {
        setupState.config.endpoint = input;
        window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter deployment name: [deployment-name]" }));
        return;
      } else if (!setupState.config.deploymentName) {
        setupState.config.deploymentName = input;
        window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter API version (e.g., 2024-02-15-preview): [version]" }));
        return;
      } else {
        setupState.config.apiVersion = input;
      }
    } else {
      setupState.config.baseUrl = input;
    }
    
    setupState.step = 7;
    this.showStep7();
  }

  private showStep7(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 7/11: Rate Limiting" }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "Minimum delay between AI calls in milliseconds (default: 1000). For o4 models, 10000 is recommended." 
    }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter rate limit: [milliseconds]" }));
  }

  private handleRateLimit(input: string): void {
    const limit = parseInt(input);
    if (isNaN(limit) || limit < 1000 || limit > 15000) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Rate limit must be between 1000 and 15000ms: registerai [number]" 
      }));
      return;
    }
    
    setupState.config.rateLimit = limit;
    setupState.step = 8;
    this.showStep8();
  }

  private showStep8(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 8/11: Retry Policy" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Number of retries on failure (default: 2)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter retry count: [number]" }));
  }

  private handleRetryPolicy(input: string): void {
    const retries = parseInt(input);
    if (isNaN(retries) || retries < 0 || retries > 5) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Retry count must be between 0 and 5: [number]" 
      }));
      return;
    }
    
    setupState.config.retryPolicy = retries;
    setupState.step = 9;
    this.showStep9();
  }

  private showStep9(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 9/11: Debug Logging" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Log AI prompts and responses to console for debugging?" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter y/n: [y/n]" }));
  }

  private handleDebugLogging(input: string): void {
    const choice = input.toLowerCase();
    if (choice !== 'y' && choice !== 'n' && choice !== 'yes' && choice !== 'no') {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "❌ Enter 'y' for yes or 'n' for no: [y/n]" }));
      return;
    }
    
    setupState.config.debugLogging = choice === 'y' || choice === 'yes';
    setupState.step = 10;
    this.showStep10();
  }

  private showStep10(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 10/11: Remember in this tab (session-only)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Keep your API key for reloads in THIS tab only? (stored in sessionStorage)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter y/n: [y/n]" }));
  }

  private handleRememberSettings(input: string): void {
    const choice = input.toLowerCase();
    if (choice !== 'y' && choice !== 'n' && choice !== 'yes' && choice !== 'no') {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "❌ Enter 'y' for yes or 'n' for no: [y/n]" }));
      return;
    }
    
    // Reuse rememberSettings to mean "remember in this tab"
    setupState.config.rememberSettings = choice === 'y' || choice === 'yes';
    setupState.step = 11;
    this.showStep11();
  }

  private showStep11(): void {
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Step 11/11: System Prompt" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Use default survival strategy prompt? (recommended)" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Enter y for default, or n to enter custom: [y/n]" }));
  }

  private handleSystemPrompt(input: string): void {
    const choice = input.toLowerCase();
    
    if (choice === 'y' || choice === 'yes') {
      setupState.config.allowedCommands = DEFAULT_ALLOWED_COMMANDS;
      setupState.config.systemPrompt = buildDefaultSystemPrompt(DEFAULT_ALLOWED_COMMANDS);
      this.completeSetup();
    } else if (choice === 'n' || choice === 'no') {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "Enter your custom system prompt: [your prompt]" 
      }));
      setupState.step = 12; // Custom prompt step
    } else if (setupState.step === 12) {
      // Handle custom prompt input
      setupState.config.systemPrompt = input;
      this.completeSetup();
    } else {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Enter 'y' for default or 'n' for custom: [y/n]" 
      }));
    }
  }

  private completeSetup(): void {
    // Validate required fields
    const config = setupState.config as AIConfig;
    
    if (!config.provider || !config.apiKey || !config.model || 
        config.temperature === undefined || !config.maxTokens || !config.systemPrompt) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Setup incomplete. Missing required fields." 
      }));
      return;
    }

    // Set defaults for optional fields
    config.rateLimit = config.rateLimit || 1000;
    config.retryPolicy = config.retryPolicy || 2;
    config.debugLogging = config.debugLogging || false;
    config.rememberSettings = config.rememberSettings || false;

    // Log configuration (mask apiKey)
    const masked = maskKey(config.apiKey);
    console.log('=== AI Configuration Debug ===');
    console.log('provider:', config.provider, '(type:', typeof config.provider, ')');
    console.log('apiKey:', masked, '(type:', typeof config.apiKey, ')');
    console.log('model:', config.model, '(type:', typeof config.model, ')');
    console.log('temperature:', config.temperature, '(type:', typeof config.temperature, ')');
    console.log('maxTokens:', config.maxTokens, '(type:', typeof config.maxTokens, ')');
    console.log('rateLimit:', config.rateLimit, '(type:', typeof config.rateLimit, ')');
    console.log('retryPolicy:', config.retryPolicy, '(type:', typeof config.retryPolicy, ')');
    console.log('debugLogging:', config.debugLogging, '(type:', typeof config.debugLogging, ')');
    console.log('rememberInThisTab:', config.rememberSettings, '(type:', typeof config.rememberSettings, ')');
    
    if (config.provider === 'Azure OpenAI') {
      console.log('endpoint:', config.endpoint, '(type:', typeof config.endpoint, ')');
      console.log('deploymentName:', config.deploymentName, '(type:', typeof config.deploymentName, ')');
      console.log('apiVersion:', config.apiVersion, '(type:', typeof config.apiVersion, ')');
    }
    
    if (config.provider === 'Custom' || config.provider === 'OpenRouter') {
      console.log('baseUrl:', config.baseUrl, '(type:', typeof config.baseUrl, ')');
    }

    const { apiKey: _secret, ...safe } = config;
    console.log('Full config (apiKey masked):', { ...safe, apiKey: masked });
    console.log('=== End AI Configuration Debug ===');

    // Save configuration (without persisting key)
    setAIConfig(config);
    
    // Session-only remember
    if (config.rememberSettings && config.apiKey) {
      rememberKeyInThisTab(config.apiKey);
    } else {
      forgetKeyInThisTab();
    }
    
    // 🔌 Prime runtime + test connection (fire-and-forget so completeSetup stays sync)
    setAIRuntimeConfig(config);
    void (async () => {
      try {
        const r = await getAIClient()!.testConnection();
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: r.ok
            ? `🔌 LLM connection OK: ${r.message ?? "ready"}`
            : `⚠️ LLM connection failed: ${r.message ?? "check key/model/endpoint"}`
        }));
      } catch (e: unknown) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `⚠️ LLM check error: ${e instanceof Error ? e.message : String(e)}`
        }));
      }
    })();

    // Reset setup state
    setupState = { step: 0, config: {}, isActive: false };
    
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "✅ AI configuration completed successfully!" }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: `🤖 ${config.provider} configured with model ${config.model}` }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "Use 'registerai status' to view settings." }));
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: config.rememberSettings
        ? "💾 Key remembered for THIS tab (sessionStorage). Non-key settings saved."
        : "🗝️ BYOK not remembered. You’ll re-enter it next time."
    }));
  }
}

// Export functions for future AI mode integration
export function getAIConfig(): AIConfig | null {
  return aiConfig;
}

export function setAIConfig(config: AIConfig): void {
  config.apiKey = sanitizeApiKey(config.apiKey);
  aiConfig = config;

  // Persist non-secret settings only
  if (config.rememberSettings) {
    const { apiKey: _secret, ...rest } = config;
    try {
      localStorage.setItem('dustytext-ai-config', JSON.stringify(rest));
    } catch (error) {
      console.warn('Failed to save AI config to localStorage:', error);
    }
  }
}

export function loadAIConfigFromStorage(): void {
  try {
    const stored = localStorage.getItem('dustytext-ai-config');
    if (stored) {
      const cfg = JSON.parse(stored) as Omit<AIConfig, "apiKey">;
      // restore non-secret settings; apiKey left empty (user or session must provide)
      aiConfig = { ...cfg, apiKey: "" } as AIConfig;

      // Try restoring key for this tab if present
      const k = restoreKeyFromThisTab();
      if (k && aiConfig) aiConfig.apiKey = sanitizeApiKey(k);
    }  
  } catch (error) {
    console.warn('Failed to load AI config from localStorage:', error);
  }
}

export function isSetupActive(): boolean {
  return setupState.isActive;
}

// Initialize from localStorage on module load
loadAIConfigFromStorage();
