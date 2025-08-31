export function coerceToSingleCommand(text: string): string {
  const cleaned = text.replace(/```[\s\S]*?```/g, "").trim();
  const first = cleaned.split(/\r?\n/)[0] ?? "";
  return first.replace(/^[\s"'`]+|[\s"'`]+$/g, "");
}

// Optional strictness:
const ALLOWED = new Set(["look","explore","move","mine","craft","build","inventory","health","survey","water","done","click"]);
export function enforceWhitelist(cmd: string): string | null {
  const v = cmd.trim().split(/\s+/)[0]?.toLowerCase();
  return ALLOWED.has(v) ? cmd : null;
}
