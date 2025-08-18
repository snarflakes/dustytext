import { CommandHandler } from './types';

export class HelpCommand implements CommandHandler {
  async execute(): Promise<void> {
    const helpText = [
      '📖 Available commands:',
      '  Game:', 
      '       Spawn (if it doesnt work, try again),', 
      '       Look/l (check your location),', 
      '       Survey (detailed horizon sensing - slow),',
      '       Health/hp,', 
      '       Explore (examine your immediate environment),',
      '       Explore <direction> (examine a specific direction for 5 blocks, directions: north/n, east/e, south/s, west/w, northeast/ne, northwest/nw, southeast/se, southwest/sw),',
      '       Speak (say something with symbol apostrophe before message),',
      '       Inventory/inv/i (check what you have in storage),',
      '       Mine (harvest resources at your feet),',
      '       Mine down (harvest the block beneath you),',
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




