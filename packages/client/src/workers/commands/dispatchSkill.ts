// commands/dispatchSkill.ts
import { Skills } from "../../skills/types";
import { canUseSkill } from "../../skills/gate";
import { renderSkillOverview, renderSkillInfo } from "./skillOverview";
import type { SkillCtx, Dir } from "../../skills/types";

const HELP_WORDS = new Set(["", "help", "list", "?", "ls", "show"]);

export async function tryDispatchSkill(raw: string, ctx: SkillCtx): Promise<boolean> {
  const lc = raw.toLowerCase().trim();

  // Accept both "skills" and "skill" prefixes for humans
  if (lc === "skills" || lc === "skill") {
    ctx.say?.(renderSkillOverview(ctx));
    return true;
  }

  if (!lc.startsWith("skill ")) return false;

  const rest = lc.slice("skill ".length).trim();
  // "skill help", "skill list", "skill", "skill ?"
  if (HELP_WORDS.has(rest)) {
    ctx.say?.(renderSkillOverview(ctx));
    return true;
  }

  // "skill info <name>" - handle this BEFORE trying to parse as skill name
  if (rest.startsWith("info")) {
    const parts = rest.split(/\s+/);
    if (parts.length === 1) {
      // Just "skill info" with no skill name
      ctx.say?.("[SYSTEM] Usage: skill info <skillname>");
      return true;
    }
    const name = parts.slice(1).join(" ").trim();
    ctx.say?.(renderSkillInfo(ctx, name));
    return true;
  }

  // "skill <name> [args]"
  const [name, ...args] = rest.split(/\s+/);
  const entry = Skills[name];
  if (!entry) { ctx.say?.(`[SYSTEM] Unknown skill: ${name}`); return true; }

  const access = canUseSkill(name, ctx);
  if (!access.ok) { ctx.say?.(`[SYSTEM] ${name.toUpperCase()} locked: ${access.reason}`); return true; }

  const res = await entry.fn(ctx, ...args);
  if (res === "blocked") ctx.say?.(`[SYSTEM] ${name} paused: re-scan or reroute needed`);
  return true;
}
