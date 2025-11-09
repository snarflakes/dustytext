import { Skills } from "../../skills/types";
import { canUseSkill } from "../../skills/gate";
import type { SkillCtx } from "../../skills/types";

const clean = (s?: string) =>
  (s ?? "")
    .replace(/[\r\n\t]+/g, " ")   // remove hidden line breaks/tabs
    .replace(/\s{2,}/g, " ")      // collapse doubles
    .trim();

export function renderSkillOverview(ctx: SkillCtx): string {
  const rows = Object.entries(Skills)
    .map(([rawName, meta]) => {
      const name = clean(rawName);                   // ← sanitize
      const args = clean(meta.args?.join(" "));
      const desc = clean(meta.description ?? "");
      const access = canUseSkill(name, ctx);
      const status = access.ok ? "✓ available" : `🔒 ${access.reason}`;

      const head = `• ${name}${args ? " " + args : ""} — ${status}`;
      const ex = meta.examples?.[0] ? `\n  e.g., ${meta.examples[0]}` : "";
      return `${head}\n  ${desc}${ex}`;
    })
    .sort((a, b) => {
      const av = a.includes("✓ available") ? 0 : 1;
      const bv = b.includes("✓ available") ? 0 : 1;
      return av - bv || a.localeCompare(b);
    });

  return [
    `[SKILLS] Level ${ctx.progress.level}`,
    ...rows,
    "Tip: use `skill [name] ...` to invoke; `skill info [name]` for details."
  ].join("\n");
}

export function renderSkillInfo(ctx: SkillCtx, name: string): string {
  const meta = Skills[name.toLowerCase()];
  if (!meta) return `[SYSTEM] Unknown skill: ${name}`;
  const access = canUseSkill(name, ctx);
  const status = access.ok ? "✓ available" : `🔒 ${access.reason}`;
  const args = clean(meta.args?.join(" ") || "");
  const examples = (meta.examples ?? []).map(e => `  - ${e}`).join("\n") || "  (no examples)";
  const cleanName = clean(name);
  return [
    `[SKILL] ${cleanName}${args ? " " + args : ""}`,
    `Status: ${status}`,
    `About: ${meta.description ?? "(no description)"}`,
    `Examples:\n${examples}`
  ].join("\n");
}















