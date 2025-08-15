import { CommandHandler, CommandContext } from './types';

export class SpeakCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const message = args.join(' ');
    
    if (!message.trim()) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❓ What do you want to say? Use: 'your message here" 
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `You say, "${message}"` 
    }));
  }
}