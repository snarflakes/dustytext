import { CommandHandler, CommandContext } from './types';
import { getAIConfig, setAIConfig, buildDefaultSystemPrompt, DEFAULT_ALLOWED_COMMANDS } from './registerAI';

// Storage for custom prompt addition
let customPromptAddition: string | null = null;

export class CustomAICommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const subCommand = args[0]?.toLowerCase();
    
    if (subCommand === 'status') {
      this.showStatus();
      return;
    }
    
    if (subCommand === 'clear') {
      customPromptAddition = null;
      this.updateAIConfig();
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🎭 Custom AI prompt addition cleared" 
      }));
      return;
    }
    
    // Everything else is treated as the custom addition
    const addition = args.join(' ').trim();
    if (!addition) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🎭 Usage: customai <text> | customai clear | customai status" 
      }));
      return;
    }
    
    customPromptAddition = addition;
    this.updateAIConfig();
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `🎭 Custom AI prompt addition set: "${addition}"` 
    }));
  }
  
  private showStatus(): void {
    if (!customPromptAddition) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "🎭 No custom AI prompt addition set" 
      }));
      return;
    }
    
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `🎭 Current custom addition: "${customPromptAddition}"` 
    }));
  }
  
  private updateAIConfig(): void {
    const config = getAIConfig();
    if (!config) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "⚠️ No AI configuration found. Run 'registerai' first." 
      }));
      return;
    }
    
    // Rebuild system prompt with custom addition
    const basePrompt = buildDefaultSystemPrompt(config.allowedCommands || DEFAULT_ALLOWED_COMMANDS);
    config.systemPrompt = customPromptAddition 
      ? `${basePrompt}\n\nADDITIONAL INSTRUCTIONS:\n${customPromptAddition}`
      : basePrompt;
    
    setAIConfig(config);
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "🔄 AI configuration updated with custom prompt" 
    }));
  }
}

export function getCustomPromptAddition(): string | null {
  return customPromptAddition;
}