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
import { SurveyCommand } from './survey';
import { BuildCommand } from './build.js';
import { CraftCommand } from './craft.js';
import { DoneCommand } from './done';
import { EquipCommand } from './equip';
import { UnequipCommand } from './unequip';
import { TillCommand } from './till.js';
import { FillCommand } from './fill';
import { WaterCommand } from './water';
import { RegisterAICommand } from './registerAI.js';
import { AICommand } from './ai';
import { ClickCommand } from './click'; // optional
import { CustomAICommand } from './customAI';
import { EatCommand } from './eat.js';
import { PlantCommand } from './plant.js';
import { HitCommand } from './hit.js';
import { SenseCommand } from './sense';
import { EnergizeCommand } from './energize';
import { ProjectFieldCommand } from './projectfield';
import { DetachProgramCommand } from './detach';
import { SleepCommand } from './sleep';
import { ScanCommand } from './scan';
import { LootCommand } from './loot';
import { ChestCommand } from './chest';
import { DelegateCommand } from './council';
import { ClaimFieldCommand } from './fieldmanager';
import { WakeupCommand } from './wakeup';
import { ClaimMachineCommand } from './machinemanager';
import { SkillCommand } from './skill';
import { InfoCommand } from './info';
import { MapCommand } from './map.js';

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
commands.set('survey', new SurveyCommand());
commands.set('build', new BuildCommand());
commands.set('craft', new CraftCommand());
commands.set('done', new DoneCommand());
commands.set('equip', new EquipCommand());
commands.set('unequip', new UnequipCommand());
commands.set('till', new TillCommand());
commands.set('fill', new FillCommand());
commands.set('water', new WaterCommand());
commands.set('registerai', new RegisterAICommand());
commands.set('eat', new EatCommand());
commands.set('plant', new PlantCommand());
commands.set('hit', new HitCommand());
commands.set('sense', new SenseCommand());
commands.set('energize', new EnergizeCommand());
commands.set('projectfield', new ProjectFieldCommand());
commands.set('detach', new DetachProgramCommand());
commands.set('sleep', new SleepCommand());
commands.set('scan', new ScanCommand());
commands.set('loot', new LootCommand());
commands.set('chest', new ChestCommand());
commands.set('claimfield', new ClaimFieldCommand());
commands.set('wakeup', new WakeupCommand());
commands.set('claimmachine', new ClaimMachineCommand());
commands.set('skill', new SkillCommand());
commands.set('skills', new SkillCommand()); // Allow both forms
commands.set('info', new InfoCommand());
commands.set('map', new MapCommand());

// special AI commands
commands.set('ai', new AICommand());        // "ai" / "ai auto"
commands.set('click', new ClickCommand());  // optional
commands.set('customai', new CustomAICommand());

// Debug logging
console.log('Registry: Available commands:', Array.from(commands.keys()));
console.log('Registry: Survey command registered:', commands.has('survey'));

export function getCommand(name: string): CommandHandler | undefined {
  console.log(`Registry: Looking for command "${name}", available:`, Array.from(commands.keys()));
  return commands.get(name);
}

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}

// Add after other command registrations
commands.set('delegate', new DelegateCommand());
