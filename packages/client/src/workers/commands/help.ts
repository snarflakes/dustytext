import { CommandHandler } from './types';

export class HelpCommand implements CommandHandler {
  async execute(): Promise<void> {
    const helpText = [
      '📖 Available commands:',
      '  Game:', 
      '       Spawn (if it doesnt work, submit command again),', 
      '       Look/l (check your location),', 
      '       Health/hp,', 
      '       Explore (examine your environment),',
      '  Movement: north/n, south/s, east/e, west/w,',
      '  System: help/h, clear, balance/bal, players/who,',
      '  Debug: debug/d'
    ];
    
    for (const line of helpText) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: line 
      }));
    }
  }
}


