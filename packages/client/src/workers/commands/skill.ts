import { CommandHandler, CommandContext } from './types';
import { createSkillContext } from '../../skills/skillSystem';
import { tryDispatchSkill } from './dispatchSkill';
import { getCommand } from './registry';

// Import skills to ensure they're registered
import '../../skills/march';

export class SkillCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    // Create skill context with current player's progress
    const skillCtx = createSkillContext(
      [], // TODO: Pass recent commands from context - we'll fix this next
      async (cmd: string) => {
        // Execute command through the same worker system that handles direct commands
        const parts = cmd.split(' ');
        const commandName = parts[0];
        const cmdArgs = parts.slice(1);
        
        const handler = getCommand(commandName);
        if (handler) {
          await handler.execute(context, ...cmdArgs);
        } else {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Unknown command from skill: ${cmd}` 
          }));
        }
      },
      (text: string) => {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: text }));
      },
      context.address
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




