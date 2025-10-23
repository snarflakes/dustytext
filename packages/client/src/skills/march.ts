import type { Dir, Skill, ScanSummary, StepInfo } from "./types";
import { registerSkill } from "./types";
import { getCachedScan } from "./scanCache";

// ---------- utils ----------

function normalizeDirection(dir: string): Dir {
  const dirMap: Record<string, Dir> = {
    n: "north", north: "north",
    e: "east",  east:  "east",
    s: "south", south: "south",
    w: "west",  west:  "west",
    ne: "northeast",  northeast:  "northeast",
    nw: "northwest",  northwest:  "northwest",
    se: "southeast",  southeast:  "southeast",
    sw: "southwest",  southwest:  "southwest",
  };
  return (dirMap[dir.toLowerCase()] ?? dir.toLowerCase()) as Dir;
}

/** Count how many steps of `dir` occurred since last explore of that dir.
 *  Works for both single-step `move west` and packed `move up west west down`.
 */
function movesSinceExplore(recent: string[], dir: Dir): number {
  const d = dir.toLowerCase();
  const patterns = [
    `explore ${d}`,
    `exp ${d}`,
    `explore ${d.charAt(0)}`,
    `exp ${d.charAt(0)}`
  ];
  let lastExploreIndex = -1;
  for (const p of patterns) {
    const idx = recent.lastIndexOf(p);
    if (idx > lastExploreIndex) lastExploreIndex = idx;
  }
  if (lastExploreIndex === -1) return -1;

  let k = 0;
  for (let i = lastExploreIndex + 1; i < recent.length; i++) {
    const entry = (recent[i] || "").trim().toLowerCase();
    if (entry === `move ${d}`) {
      k += 1;
      continue;
    }
    if (entry.startsWith("move ")) {
      // Packed form: only count if tokens are up/down or the same dir
      const toks = entry.slice(5).trim().split(/\s+/).filter(Boolean);
      const bad = toks.some(t => t !== "up" && t !== "down" && t !== d);
      if (bad) break;
      k += toks.filter(t => t === d).length;
      continue;
    }
    // Any other command breaks the chain
    break;
  }
  return k;
}

// ---------- parsing the last explore table from DOM ----------

/** DOM parser for the last printed explore table → ScanSummary */
function parseExploreOutput(_recentCommands: string[], dir: Dir): ScanSummary | undefined {
  const allPre = document.querySelectorAll<HTMLPreElement>(".explore-output");
  const pre = allPre[allPre.length - 1];
  if (!pre) return undefined;

  // Collect all blocks
  const nodes = pre.querySelectorAll<HTMLElement>(".clickable-block");
  const allBlocks: Array<{ x:number; y:number; z:number; name:string; distance:number; layer:number }> = [];

  nodes.forEach(el => {
    let raw = el.getAttribute("data-block");
    if (!raw) return;
    raw = raw.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && "distance" in obj && "layer" in obj) {
        allBlocks.push(obj as any);
      }
    } catch (_e) {
      // ignore malformed JSON; keep callback non-empty for eslint(no-empty)
      return;
    }
  });

  if (allBlocks.length === 0) {
    // Fallback attribute scrape (tolerates both " and ' quotes)
    const html = pre.innerHTML;
    const attrRe = /data-block=(?:"([^"]+)"|'([^']+)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(html))) {
      const json = (m[1] ?? m[2])!.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      try {
        allBlocks.push(JSON.parse(json));
      } catch (_e) {
        // skip bad attribute; keep loop non-empty
        continue;
      }
    }
  }

  if (allBlocks.length === 0) return undefined;

  // index by distance (1..5) and layer (+2..-3)
  const byDist = new Map<number, Map<number, any>>();
  for (const b of allBlocks) {
    const d = Number(b.distance);
    const L = Number(b.layer);
    if (!byDist.has(d)) byDist.set(d, new Map());
    byDist.get(d)!.set(L, b);
  }

  // helpers
  const PASSABLE_NAMES = ["switchgrass","fescue","vines","hempbush","cottonbush","bamboobush","flower","wheatseed"];
  const nameOf = (b: any) => String(b?.name ?? "").toLowerCase();
  const isAir   = (b: any) => nameOf(b) === "air";
  const isWater = (b: any) => /water/i.test(nameOf(b));
  const isLava  = (b: any) => /(lava|magma)/i.test(nameOf(b));
  const isPassableVegetation = (b: any) => PASSABLE_NAMES.some(p => nameOf(b).includes(p));
  const isWalkable = (b: any) => isAir(b) || isPassableVegetation(b);
  const isSolidFloor = (b: any) =>
    !!b && !isAir(b) && !isWater(b) && !isPassableVegetation(b) && !isLava(b);

  // Build 5 step infos with strict elevation rule + special-case for h=+2:
  // allow h ∈ {+2, +1, 0, -1, -2} such that:
  //  - [h] and [h+1] are walkable (for h=+2 we ASSUME [h+1]==+3 is Air)
  //  - [h-1] is solid (immediate floor)
  const steps: StepInfo[] = [];
  for (let dist = 1; dist <= 5; dist++) {
    const m = byDist.get(dist) ?? new Map<number, any>();
    const cell = (L: number) => m.get(L);

    const water = [-3,-2,-1,0,1,2].some(L => isWater(cell(L)));
    const lava  = [-3,-2,-1,0,1,2].some(L => isLava(cell(L)));

    const cand: Array<-2|-1|0|1|2> = [0, 1, 2, -1, -2]; // prefer level, +1, special +2, then downs
    let chosen: -2|-1|0|1|2|null = null;

    for (const h of cand) {
      const feet = cell(h);
      const head = (h + 1) <= 2 ? cell(h + 1) : { name: "Air" }; // assume +3 is Air when h=+2
      const fl   = cell(h - 1);

      const walkableHead = (h === 2) ? true : isWalkable(head); // special-case: treat +3 as Air
      if (isWalkable(feet) && walkableHead && isSolidFloor(fl)) {
        chosen = h; break;
      }
    }

    const enterable = !lava && chosen !== null;
    steps.push({
      dy: chosen,               // -2|-1|0|1|2|null
      air2: chosen !== null,
      hasWater: water,
      hasLavaOrMagma: lava,
      enterable
    });
  }

  // safe_len & first hazards
  let safe_len = 0;
  let water_at: ScanSummary["water_at"] = null;
  let hazard_at: ScanSummary["hazard_at"] = null;
  for (let i = 0; i < 5; i++) {
    const s = steps[i];
    if (water_at === null && s.hasWater)  water_at  = (i + 1) as any;
    if (hazard_at === null && s.hasLavaOrMagma) hazard_at = (i + 1) as any;
    if (s.enterable && !s.hasWater && !s.hasLavaOrMagma) safe_len++;
    else break;
  }

  return { dir, steps: steps as any, safe_len, water_at, hazard_at };
}

// ---------- skill ----------

export const marchSkill: Skill = async (ctx, dirArg?: string) => {
  const dir = normalizeDirection(dirArg || "west");

  // 1) get ScanSummary (cache -> ctx -> DOM parse -> explore)
  let sum = getCachedScan(dir) || ctx.latestScan(dir) || parseExploreOutput(ctx.recentCommands, dir);
  if (!sum) {
    await ctx.exec(`explore ${dir}`);
    await new Promise(r => setTimeout(r, 200));
    sum = parseExploreOutput(ctx.recentCommands, dir);
    if (!sum) return "blocked";
  }

  // 2) how many steps since explore? (-1 means unknown; treat as 0)
  const k0 = Math.max(0, movesSinceExplore(ctx.recentCommands, dir));

  // steps remaining in horizon & safe window
  const horizon = Math.min(5 - k0, Math.max(0, sum.safe_len - k0));
  if (horizon <= 0) {
    await ctx.exec(`explore ${dir}`);
    return "blocked";
  }

  // 3) build packed tokens with persistent height:
  // CLIMB (Δ>0): vertical BEFORE step
  // DROP  (Δ<0): step BEFORE vertical (avoids "down" into current solid floor)
  const tokens: string[] = [];
  let curDy: -2|-1|0|1|2 = 0;

  for (let i = 0; i < horizon; i++) {
    const step = sum.steps[k0 + i];
    if (!step || !step.enterable || step.hasWater || step.hasLavaOrMagma || step.dy == null) break;

    const target = step.dy as -2|-1|0|1|2;
    const delta = target - curDy;

    if (delta > 0) {
      for (let n = 0; n <  delta; n++) tokens.push("up");
      tokens.push(dir);
    } else if (delta < 0) {
      tokens.push(dir);
      for (let n = 0; n < -delta; n++) tokens.push("down");
    } else {
      tokens.push(dir);
    }
    curDy = target;
  }

  if (tokens.length === 0) {
    await ctx.exec(`explore ${dir}`);
    return "blocked";
  }

  await ctx.exec(`move ${tokens.join(" ")}`); // e.g., "move up west west ..." or "move west down west ..."
  return "done";
};

// ---------- register ----------

registerSkill("march", marchSkill, {
  requiredLevel: 2,
  description: "Consume up to 5 safe steps after an explore; vegetation is passable air; +2 assumes +3 air. Emits UP-before-step on climbs and DIR-before-DOWN on drops.",
  args: ["<dir>"],
  examples: ["skill march west", "skill march north"]
});
