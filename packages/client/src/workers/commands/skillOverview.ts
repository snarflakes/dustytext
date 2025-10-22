import { Skills } from "../../skills/types";
import { canUseSkill } from "../../skills/gate";
import type { SkillCtx } from "../../skills/types";

export function renderSkillOverview(ctx: SkillCtx): string {
  const rows = Object.entries(Skills)
    .map(([name, meta]) => {
      const access = canUseSkill(name, ctx);
      const status = access.ok ? "✓ available" : `🔒 ${access.reason}`;
      const args = meta.args?.join(" ") ?? "";
      const desc = meta.description ?? "";
      return `• ${name}${args ? " " + args : ""} — ${status}\n  ${desc}${
        meta.examples?.length ? `\n  e.g., ${meta.examples[0]}` : ""}`;
    })
    .sort((a, b) => {
      const av = a.includes("✓ available") ? 0 : 1;
      const bv = b.includes("✓ available") ? 0 : 1;
      return av - bv || a.localeCompare(b);
    });

  return [
    "[SKILLS]",
    ...rows,
    "Tip: use `skill <name> ...` to invoke; `skill info <name>` for details."
  ].join("\n");
}

export function renderSkillInfo(ctx: SkillCtx, name: string): string {
  const meta = Skills[name.toLowerCase()];
  if (!meta) return `[SYSTEM] Unknown skill: ${name}`;
  const access = canUseSkill(name, ctx);
  const status = access.ok ? "✓ available" : `🔒 ${access.reason}`;
  const args = meta.args?.join(" ") ?? "";
  const examples = (meta.examples ?? []).map(e => `  - ${e}`).join("\n") || "  (no examples)";
  return [
    `[SKILL] ${name}${args ? " " + args : ""}`,
    `Status: ${status}`,
    `About: ${meta.description ?? "(no description)"}`,
    `Examples:\n${examples}`
  ].join("\n");
}

