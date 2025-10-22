import { SkillCtx, SkillResult, Skills } from './types';
import { getCachedScan } from './scanCache';
import { canUseSkill } from './gate';
import { loadProgress } from '../progress/model';

// Create skill context
export function createSkillContext(
  recentCommands: string[],
  execFn: (cmd: string) => Promise<void>,
  sayFn?: (text: string) => void,
  playerId?: string // Add playerId parameter
): SkillCtx {
  // Use the provided playerId or fall back to session client
  const playerAddress = playerId || window.__entryKitSessionClient?.account || 'default';
  const storedProgress = loadProgress(playerAddress);
  
  const ctx: SkillCtx = {
    recentCommands: recentCommands.map(cmd => cmd.toLowerCase()),
    latestScan: getCachedScan,
    exec: execFn,
    say: sayFn,
    progress: {
      level: storedProgress.level,
      unlockedSkills: new Set(storedProgress.unlockedSkills), // Convert array to Set
      flags: storedProgress.flags || {}
    },
    invokeSkill: async (name: string, ...args: string[]) => {
      return await executeSkill(name, ctx, ...args);
    }
  };
  return ctx;
}

// Execute a skill using the existing gate system
export async function executeSkill(
  skillName: string, 
  ctx: SkillCtx, 
  ...args: string[]
): Promise<SkillResult> {
  // Use existing gate system to check if skill can be used
  const gateResult = canUseSkill(skillName, ctx);
  
  if (!gateResult.ok) {
    if (gateResult.reason === "unknown") {
      return "blocked"; // Skill doesn't exist
    }
    return "locked"; // Level/flag requirements not met
  }
  
  const skill = Skills[skillName.toLowerCase()];
  if (!skill) {
    return "blocked"; // Shouldn't happen if gate passed, but safety check
  }
  
  return await skill.fn(ctx, ...args);
}

export async function tryDispatchSkill(raw: string, ctx: SkillCtx): Promise<boolean> {
  if (!raw.toLowerCase().startsWith("skill ")) return false;
  const rest = raw.slice("skill ".length).trim();
  const [name, ...args] = rest.split(/\s+/);
  const entry = Skills[name?.toLowerCase()];
  if (!entry) {
    ctx.say?.(`[SYSTEM] Unknown skill: ${name}`);
    return true; // consumed
  }

  const access = canUseSkill(name, ctx);
  if (!access.ok) {
    ctx.say?.(`[SYSTEM] ${name.toUpperCase()} locked: ${access.reason}`);
    return true; // consumed (no world action)
  }

  const result = await entry.fn(ctx, ...args);
  if (result === "blocked") {
    ctx.say?.(`[SYSTEM] ${name} paused: re-scan or reroute needed`);
  }
  return true;
}




