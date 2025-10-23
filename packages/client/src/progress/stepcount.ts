// progress/stepcount.ts
const DIR_TOKENS = new Set(["n","s","e","w","ne","nw","se","sw","north","south","east","west","northeast","northwest","southeast","southwest"]);
const VERT_TOKENS = new Set(["u","d","up","down"]);

export function countStepsForMove(cmd: string): number {
  
  const INCLUDE_VERTICAL = true;   // set true to match model.ts
  
  const lc = cmd.trim().toLowerCase();
  if (!lc.startsWith("move")) return 0;

  // Single-step form: "move west" or "move northwest"
  const rest = lc.slice(4).trim();
  if (!rest.includes(" ")) return 1;

  // Packed form: "move w w u w" or "move up north north north"
  const toks = rest.split(/\s+/);
  let count = 0;
  for (const t of toks) {
    if (DIR_TOKENS.has(t)) count += 1;
    else if (VERT_TOKENS.has(t) && INCLUDE_VERTICAL) count += 1;
  }
  return count;
}
