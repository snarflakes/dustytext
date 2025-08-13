import { CommandHandler } from './types';
import { MoveCommand } from './move.js';
import { SpawnCommand } from './spawn.js';
import { LookCommand } from './look.js';
import { HealthCommand } from './health.js';
import { ExploreCommand } from './explore.js';
import { HelpCommand } from './help.js';

const commands = new Map<string, CommandHandler>();

// Register all commands
commands.set('move', new MoveCommand());
commands.set('spawn', new SpawnCommand());
commands.set('look', new LookCommand());
commands.set('health', new HealthCommand());
commands.set('explore', new ExploreCommand());
commands.set('help', new HelpCommand());

export function getCommand(name: string): CommandHandler | undefined {
  return commands.get(name);
}

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}


