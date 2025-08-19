import { CommandHandler, CommandContext } from './types';

export class UnequipCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    const equippedTool = (globalThis as any).equippedTool;
    
    if (!equippedTool) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ No tool currently equipped" 
      }));
      return;
    }

    const toolName = equippedTool.type;
    (globalThis as any).equippedTool = null;

    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `⚒️ Unequipped ${toolName}` 
    }));
  }
}