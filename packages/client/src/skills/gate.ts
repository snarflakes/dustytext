// skills/gate.ts
import { Skills, SkillCtx } from "./types";

export function canUseSkill(skillName: string, ctx: SkillCtx): { ok: boolean; reason?: string } {
  const entry = Skills[skillName.toLowerCase()];
  if (!entry) return { ok: false, reason: "unknown" };

  // Hard unlock list takes precedence (e.g., quest reward)
  if (ctx.progress.unlockedSkills.has(skillName.toLowerCase())) return { ok: true };

  // Otherwise, check level / flag requirements
  if (entry.requiredLevel && ctx.progress.level < entry.requiredLevel) {
    return { ok: false, reason: `requires level ${entry.requiredLevel}` };
  }
  if (entry.flag && !ctx.progress.flags?.[entry.flag]) {
    return { ok: false, reason: `requires ${entry.flag}` };
  }
  return { ok: true };
}
