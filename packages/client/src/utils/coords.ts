// utils/coords.ts
export function parseTuplesFromArgs(args: string[]) {
  const s = args.join(" ");
  const re = /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;
  const out: Array<{ x:number; y:number; z:number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ x:+m[1], y:+m[2], z:+m[3] });
  return out;
}

export function looksLikeJsonCoord(s?: string) {
  return !!s && s.trim().startsWith("{"); // matches what `done` passes (JSON.stringify(block))
}
