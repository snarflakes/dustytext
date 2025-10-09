import { CommandHandler } from './types';

export class HelpCommand implements CommandHandler {
  async execute(): Promise<void> {
    const helpText = [
      '📖 Available commands:',
      '  Basic Game Commands: Explore is the most useful as it tells you details about your environment. You can Explore West (or any direction) to see further. And Explore mine west or build west to toggle between mining or building. ', 
      '       [Spawn] if it doesnt work, try again,', 
      '       [Look]/l check your location,', 
      '       [Move] move carefully in a direction, directions: north/n, east/e, south/s, west/w, northeast/ne, northwest/nw, southeast/se, southwest/sw),',
      '       [Move] fast alternate syntax, you might fall if you dont plan ahead!: Ex: move e e e e e to sprint multiple moves in one transaction, will fail if no path,',
      '       [Survey] detailed horizon sensing - slow wide search for water,',
      '       [Health]/hp,', 
      '       [Explore]/exp examine your immediate environment, set command mine/water/build/till/fill to allow precise block selection,',
      '       [Explore <direction>] also sets above commands but examines a specific direction for 5 blocks, directions: north/n, east/e, south/s, west/w, northeast/ne, northwest/nw, southeast/se, southwest/sw,',
      '       [Done]/d execute queued actions from above,',
      '       [Speak] say something with symbol single quote before message,',
      '       [Inventory]/inv/i check what you have in storage,',
      '       [Mine] harvest resources at your feet,',
      '  Farming Commands:',
      '       [Till] prepare dirt or grass to become farmland with equipped hoe,',
      '       [Fill] fill equipped bucket with water when standing in water,',
      '       [Fill (x,y,z)] fill equipped bucket with water from specific coordinates (x,y,z),',
      '       [Water] water farmland blocks with equipped water bucket,',
      '       [Plant] plant seeds on farmland at your feet with equipped seeds,',
      '       [Build] place equipped block above your head,',
      '       [Mine] down harvest the block beneath you,',
      '       [Craft] create new items from your inventory, workbench must be placed one block north when required for crafting items,',
      '       [Equip] use a tool from your inventory. Try using axe for wood, and a pick for seed harvesting,',
      '       [Unequip] stop using your current tool, they break with use!,',
      '       [Eat] first equip the food, then eat food to restore health,',
      '       [Hit] other players with or without an equipped tool, also loots a dead player if standing above them,',
      '  Force Fields Commands:',
      '       [Energize] power machines with equipped batteries, energize <amount> (default: 1),',
      '       [Sense] check force field status at your location, or at a specific coordinate, sense x y z,',
      '       [ProjectField] create a force field at your location, or at a specific coordinate, projectfield x y z,',
      '       [Detach] remove force field from a machine, or from your location, detach x y z,',
      '       [ClaimField x y z] expand access to specified force field to EOA account,',
      '  Other World Commands:',
      '       [Sleep] rest in a bed to guard health and energy,',
      '       [Scan] search for nearby players, scan <radius> (default: 10),',
      '       [Loot] collect items at your feet, or at a specific coordinate, loot x y z,',
      '       [Chest] open chest at your feet, or at a specific coordinate, chest x y z,',
      '  AI Commands:',                  
      '       [RegisterAI] configure AI assistant settings for AI mode,',
      '       [CustomAI] add custom instructions to future AI prompts, movement directions, personality,',
      '       [Council] address or council clear,delegate your dustforgeaccount to another address, or clear delegation,',
      
      '  Also move: north/n, south/s, east/e, west/w, northeast/ne, northwest/nw, southeast/se, southwest/sw, up/u,',
      '  System: help/h, clear, balance/bal, players/who,',
      '  Debug: check forcefield ownership for EOA and session account',
      '  Key Notes: When in explore looking for a space to move, if you see only AIR in a direction, you will take significant damage. Try placing a block first!'
    ];
    
    for (const line of helpText) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: line 
      }));
    }
  }
}










