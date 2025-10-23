import type { Dir, Skill, ScanSummary, StepInfo } from "./types";
import { registerSkill } from "./types";
import { getCachedScan } from "./scanCache";

function normalizeDirection(dir: string): Dir {
  const dirMap: Record<string, Dir> = {
    'n': 'north', 'north': 'north',
    'e': 'east', 'east': 'east', 
    's': 'south', 'south': 'south',
    'w': 'west', 'west': 'west',
    'ne': 'northeast', 'northeast': 'northeast',
    'nw': 'northwest', 'northwest': 'northwest', 
    'se': 'southeast', 'southeast': 'southeast',
    'sw': 'southwest', 'southwest': 'southwest'
  };
  return dirMap[dir.toLowerCase()] || dir.toLowerCase() as Dir;
}

function movesSinceExplore(recent: string[], dir: Dir) {
  const d = dir.toLowerCase();
  // Check for both full and abbreviated forms
  const patterns = [
    `explore ${d}`,
    `exp ${d}`,
    `explore ${d.charAt(0)}`, // e.g., "explore n"
    `exp ${d.charAt(0)}`      // e.g., "exp n"
  ];
  
  let lastExploreIndex = -1;
  for (const pattern of patterns) {
    const idx = recent.lastIndexOf(pattern);
    if (idx > lastExploreIndex) {
      lastExploreIndex = idx;
    }
  }
  
  console.log(`March: Last explore index for ${d}: ${lastExploreIndex}`);
  console.log(`March: Recent commands:`, recent.slice(-10)); // Show last 10 commands
  
  if (lastExploreIndex === -1) return -1;
  
  let k = 0;
  for (let i = lastExploreIndex + 1; i < recent.length; i++) {
    console.log(`March: Checking command at ${i}: "${recent[i]}"`);
    if (recent[i] === `move ${d}`) {
      k++;
      console.log(`March: Found move ${d}, k=${k}`);
    } else break;
  }
  console.log(`March: Total moves since explore: ${k}`);
  return k;
}

// Parse explore output directly from recent logs
function parseExploreOutput(_recentCommands: string[], dir: Dir): ScanSummary | undefined {
  // 1) Find the last rendered explore block
  const allPre = document.querySelectorAll<HTMLPreElement>(".explore-output");
  const pre = allPre[allPre.length - 1];
  if (!pre) {
    console.log(`March: No .explore-output element found`);
    return undefined;
  }

  // 2) Collect every clickable block inside it
  const nodes = pre.querySelectorAll<HTMLElement>(".clickable-block");
  const allBlocks: Array<{ x:number; y:number; z:number; name:string; distance:number; layer:number }> = [];

  nodes.forEach(el => {
    let raw = el.getAttribute("data-block");
    if (!raw) return;
    // Decode HTML entities if innerHTML serializer escaped quotes
    raw = raw.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && "distance" in obj && "layer" in obj) {
        allBlocks.push(obj as any);
      }
    } catch (e) {
      // ignore
    }
  });

  if (allBlocks.length === 0) {
    // Fallback: attribute regex tolerant to " or ' quotes (as a backup if above somehow fails)
    const html = pre.innerHTML;
    const attrRe = /data-block=(?:"([^"]+)"|'([^']+)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(html))) {
      const json = (m[1] ?? m[2])!.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      try { allBlocks.push(JSON.parse(json)); } catch {
        // Ignore malformed JSON in fallback parsing
      }
    }
  }

  console.log(`March: Parsed ${allBlocks.length} blocks from DOM`);

  if (allBlocks.length === 0) return undefined;

  // 3) Index by distance (1..5) and layer (+2..-3)
  const byDist = new Map<number, Map<number, any>>();
  for (const b of allBlocks) {
    const d = Number(b.distance);
    const L = Number(b.layer);
    if (!byDist.has(d)) byDist.set(d, new Map());
    byDist.get(d)!.set(L, b);
  }

  // helpers
  const isAir   = (b: any) => String(b?.name ?? "").toLowerCase() === "air";
  const isWater = (b: any) => /water/i.test(String(b?.name ?? ""));
  const isLava  = (b: any) => /(lava|magma)/i.test(String(b?.name ?? ""));
  const isPassableVegetation = (b: any) => /grass/i.test(String(b?.name ?? "")) && String(b?.name ?? "").toLowerCase().includes("switch");
  const isSolidFloor = (b: any) => !!b && !isAir(b) && !isWater(b); // any non-air, non-water block can be floor
  const isWalkable = (b: any) => isAir(b) || isPassableVegetation(b); // can walk through air or passable vegetation

  // 4) Build StepInfo[5] with elevation choice
  const steps: StepInfo[] = [];
  for (let dist = 1; dist <= 5; dist++) {
    const m = byDist.get(dist) ?? new Map<number, any>();
    const cell = (L: number) => m.get(L);

    const water = [-3,-2,-1,0,1,2].some(L => isWater(cell(L)));
    const lava  = [-3,-2,-1,0,1,2].some(L => isLava(cell(L)));

    // choose foot level h ∈ {+1, 0, -1, -2} s.t.
    //   walkable space at [h] and [h+1], and solid floor at [h-1]
    const cand: Array<-2|-1|0|1> = [0, 1, -1, -2]; // prefer level, then step up, then down
    let chosen: -2|-1|0|1|null = null;

    for (const h of cand) {
      const b0 = cell(h);            // body bottom
      const b1 = cell(h + 1);        // body top
      const fl = cell(h - 1);        // floor
      if (isWalkable(b0) && isWalkable(b1) && isSolidFloor(fl)) { 
        chosen = h; 
        console.log(`March: Distance ${dist}, chosen elevation ${h}, b0=${b0?.name}, b1=${b1?.name}, fl=${fl?.name}`);
        break; 
      }
    }

    const enterable = !lava && chosen !== null;
    steps.push({
      dy: chosen,
      air2: chosen !== null,   // by construction, [h] and [h+1] are air
      hasWater: water,
      hasLavaOrMagma: lava,
      enterable
    });
  }

  // 5) safe_len / first hazards
  let safe_len = 0 as number;
  let water_at: ScanSummary["water_at"] = null;
  let hazard_at: ScanSummary["hazard_at"] = null;
  for (let i = 0; i < 5; i++) {
    const s = steps[i];
    if (water_at === null && s.hasWater)  water_at  = (i + 1) as any;
    if (hazard_at === null && s.hasLavaOrMagma) hazard_at = (i + 1) as any;
    if (s.enterable && !s.hasWater && !s.hasLavaOrMagma) safe_len++;
    else break;
  }

  return {
    dir,
    steps: steps as any,
    safe_len,
    water_at,
    hazard_at
  };
}

export const marchSkill: Skill = async (ctx, dirArg?: string) => {
  const dir = normalizeDirection(dirArg || "west");
  
  // First try to get cached scan data
  let sum = getCachedScan(dir);
  
  // If no cached data, try from context
  if (!sum) {
    sum = ctx.latestScan(dir);
  }
  
  // If still no data, try parsing from recent logs
  if (!sum) {
    sum = parseExploreOutput(ctx.recentCommands, dir);
  }
  
  // If still no data, run explore
  if (!sum) { 
    await ctx.exec(`explore ${dir}`); 
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Try parsing the fresh explore output
    sum = parseExploreOutput(ctx.recentCommands, dir);
    
    if (!sum) {
      console.log("March: No scan data found after explore");
      return "blocked"; 
    }
  }

  const k = Math.max(0, movesSinceExplore(ctx.recentCommands, dir));
  
  // Find the optimal elevation for the entire path
  const availableSteps = sum.steps.slice(k, Math.min(5, k + sum.safe_len));
  if (availableSteps.length === 0 || !availableSteps.every(s => s.enterable && !s.hasWater && !s.hasLavaOrMagma)) {
    console.log("March: No safe moves available");
    await ctx.exec(`explore ${dir}`);
    return "blocked";
  }

  // Find the best starting elevation by checking what elevation works for the most consecutive steps
  let bestElevation = 0;
  let maxSteps = 0;
  
  // Try each starting elevation - prioritize current elevation (0) first
  for (const startElevation of [0, 1, -1, -2]) {
    let consecutiveSteps = 0;
    
    // Count how many consecutive steps work, allowing elevation changes
    for (const step of availableSteps) {
      if (step.enterable && !step.hasWater && !step.hasLavaOrMagma) {
        // A step is walkable if:
        // 1. It's enterable (has air space for body)
        // 2. We can reach it (elevation change <= 2 blocks down, any up)
        const elevationChange = step.dy - (consecutiveSteps === 0 ? startElevation : availableSteps[consecutiveSteps - 1].dy);
        const canReach = elevationChange >= -2; // Can drop max 2 blocks, can climb any amount
        
        if (canReach) {
          consecutiveSteps++;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    // Prefer current elevation (0) when steps are equal
    if (consecutiveSteps > maxSteps || (consecutiveSteps === maxSteps && startElevation === 0)) {
      maxSteps = consecutiveSteps;
      bestElevation = startElevation;
    }
  }

  console.log(`March debug: Available steps: ${availableSteps.map(s => `dy=${s.dy}, enterable=${s.enterable}`).join(', ')}`);

  const moveCommands: string[] = [];
  
  // Track current elevation as we build the path
  let currentElevation = bestElevation;
  
  // Add initial elevation adjustment if needed
  if (bestElevation > 0) {
    for (let i = 0; i < bestElevation; i++) {
      moveCommands.push('up');
    }
  } else if (bestElevation < 0) {
    for (let i = 0; i < Math.abs(bestElevation); i++) {
      moveCommands.push('down');
    }
  }
  
  // Add the directional moves with elevation adjustments
  for (let i = 0; i < maxSteps; i++) {
    const step = availableSteps[i];
    const targetElevation = step.dy ?? 0;
    
    // Add the directional move first
    moveCommands.push(dir);
    
    // Then add elevation change for the NEXT position if needed
    const elevationChange = targetElevation - currentElevation;
    if (elevationChange > 0) {
      for (let j = 0; j < elevationChange; j++) {
        moveCommands.push('up');
      }
    } else if (elevationChange < 0) {
      for (let j = 0; j < Math.abs(elevationChange); j++) {
        moveCommands.push('down');
      }
    }
    
    // Update current elevation
    currentElevation = targetElevation;
  }

  console.log(`March debug: k=${k}, safe_len=${sum.safe_len}, bestElevation=${bestElevation}, maxSteps=${maxSteps}, moveCommands=${moveCommands.join(' ')}`);

  if (moveCommands.length === 0) {
    console.log("March: No safe moves available");
    await ctx.exec(`explore ${dir}`);
    return "blocked";
  }

  // Execute the movement sequence
  const moveCommand = `move ${moveCommands.join(' ')}`;
  
  console.log(`March: Executing ${moveCommand}`);
  await ctx.exec(moveCommand);
  console.log(`March: Move command completed`);
  return "done";
};

// Register the skill with metadata
registerSkill("march", marchSkill, {
  requiredLevel: 2,
  description: "Consume up to 5 safe steps after an explore, stopping before hazards/water. Used as such: skill march east",
  args: ["<dir>"],
  examples: ["skill march west"]
});
