import { CommandHandler, CommandContext } from './types';
import { createSkillContext } from '../../skills/skillSystem';
import { tryDispatchSkill } from './dispatchSkill';

// Import skills to ensure they're registered
import '../../skills/march';

export class SkillCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    // Create skill context with current player's progress
    const skillCtx = createSkillContext(
      [], // TODO: Pass recent commands from context
      async (cmd: string) => {
        // Execute command through the worker system
        window.dispatchEvent(new CustomEvent("ai-command", {
          detail: { command: cmd, source: "skill" }
        }));
      },
      (text: string) => {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: text }));
      },
      context.address // Pass the same address used by move command
    );

    // Handle "skill" with no args as overview
    if (args.length === 0) {
      const handled = await tryDispatchSkill("skill", skillCtx);
      return;
    }

    // Reconstruct the full skill command
    const fullCommand = `skill ${args.join(' ')}`;
    
    try {
      const handled = await tryDispatchSkill(fullCommand, skillCtx);
      if (!handled) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Failed to dispatch skill command: ${fullCommand}` 
        }));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Error executing skill: ${error}` 
      }));
    }
  }
}



