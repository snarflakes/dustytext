export function countBlocksForMine(cmd: string): number {
  const lc = cmd.trim().toLowerCase();
  if (!lc.startsWith("mine")) return 0;

  // Single block: "mine down" or "mine (1,2,3)"
  const rest = lc.slice(4).trim();
  if (!rest.includes(" ") || rest.startsWith("(")) return 1;

  // Batch form: count coordinate tuples like "(1,2,3) (4,5,6)"
  const tupleMatches = rest.match(/\([^)]+\)/g);
  if (tupleMatches) return tupleMatches.length;

  return 1; // fallback for other mine commands
}