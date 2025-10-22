import type { Dir, Skill } from "./types";
import { registerSkill } from "./types";

function movesSinceExplore(recent: string[], dir: Dir) {
  const d = dir.toLowerCase();
  const e = recent.lastIndexOf(`explore ${d}`);
  if (e === -1) return -1;
  let k = 0;
  for (let i=e+1;i<recent.length;i++){ if(recent[i]===`move ${d}`) k++; else break; }
  return k;
}

export const marchSkill: Skill = async (ctx, dirArg?: string) => {
  const dir = (dirArg?.toLowerCase() as Dir) || "west";
  const sum = ctx.latestScan(dir);
  if (!sum) { await ctx.exec(`explore ${dir}`); return "blocked"; }

  const k = Math.max(0, movesSinceExplore(ctx.recentCommands, dir));
  const step = sum.steps[Math.min(4, k)];

  const wouldHitWater  = sum.water_at  !== null && (k + 1) >= sum.water_at!;
  const wouldHitHazard = sum.hazard_at !== null && (k + 1) >= sum.hazard_at!;
  const cacheSpent = (k + 1) > sum.safe_len;

  if (wouldHitWater || wouldHitHazard || cacheSpent || !step.enterable) {
    await ctx.exec(`explore ${dir}`);
    return "blocked";
  }

  // Single-step move auto-adjusts elevation in your engine.
  await ctx.exec(`move ${dir}`);
  return "done";
};

// Register the skill with metadata
registerSkill("march", marchSkill, {
  requiredLevel: 2,
  description: "Consume up to 5 safe steps after an explore, stopping before hazards/water.",
  args: ["<dir>"],
  examples: ["skill march west"]
});
