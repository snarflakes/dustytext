import { CommandHandler } from './types';
import { MoveCommand } from './move.js';
import { SpawnCommand } from './spawn.js';
import { LookCommand } from './look.js';
import { HealthCommand } from './health.js';
import { ExploreCommand } from './explore.js';
import { HelpCommand } from './help.js';
import { MineCommand } from './mine.js';
import { InventoryCommand } from './inventory.js';
import { SpeakCommand } from './speak.js';

const commands = new Map<string, CommandHandler>();

// Register all commands
commands.set('move', new MoveCommand());
commands.set('spawn', new SpawnCommand());
commands.set('look', new LookCommand());
commands.set('health', new HealthCommand());
commands.set('explore', new ExploreCommand());
commands.set('help', new HelpCommand());
commands.set('mine', new MineCommand());
commands.set('inventory', new InventoryCommand());
commands.set('speak', new SpeakCommand());

// Debug logging
console.log('Registry: Available commands:', Array.from(commands.keys()));
console.log('Registry: Mine command registered:', commands.has('mine'));

export function getCommand(name: string): CommandHandler | undefined {
  console.log(`Registry: Looking for command "${name}", available:`, Array.from(commands.keys()));
  return commands.get(name);
}

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}







