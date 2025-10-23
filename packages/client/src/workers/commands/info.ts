import { CommandHandler, CommandContext } from './types';
import { loadProgress } from '../../progress/model';

export class InfoCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const playerId = context.address;
      const progress = loadProgress(playerId);
      
      const skillsList = progress.unlockedSkills.length > 0 
        ? progress.unlockedSkills.join(', ')
        : 'None';
      
      const infoText = [
        `📊 Player Information:`,
        `  Level: ${progress.level}`,
        `  Total Steps Taken: ${progress.tilesMoved}`,
        `  Skills Learned: ${skillsList}`
      ];
      
      for (const line of infoText) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: line 
        }));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Info failed: ${error}` 
      }));
    }
  }
}