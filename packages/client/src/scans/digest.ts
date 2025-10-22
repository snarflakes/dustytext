// scans/digest.ts
// Parses the 6×5 ASCII table printed after `explore <dir>` into a ScanSummary.
// Depends on types defined in skills/types.ts.

import type { Dir, ScanSummary, StepInfo } from "../skills/types";

// ---------- direction helpers ----------
const DIRS: Dir[] = [
  "north","south","east","west",
  "northeast","northwest","southeast","southwest",
];

function toDir(s: string): Dir | undefined {
  const lc = s.toLowerCase();
  if ((DIRS as string[]).includes(lc)) return lc as Dir;
  // Short forms
  const map: Record<string, Dir> = {
    n: "north", s: "south", e: "east", w: "west",
    ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
  };
  return map[lc] as Dir | undefined;
}

// ---------- cell classifiers ----------
function isAir(x: string) { return /air/i.test(x); }
function isWater(x: string) { return /water/i.test(x); }
function isLava(x: string) { return /(lava|magma)/i.test(x); }
// Treat any non-air, non-water as a viable floor (snow/grass/dirt/stone/etc.)
function isSolidFloor(x: string) { return !isAir(x) && !isWater(x); }

// ---------- row parsing ----------
const ROW_KEYS = ["+2","+1","0","-1","-2","-3"] as const;
type RowKey = typeof ROW_KEYS[number];

function tokenizeRow(line: string): string[] {
  // e.g., "+2: Air Air Snow ..." -> ["Air","Air","Snow",...]
  const m = line.match(/^[\s]*([+]|-)?\d:?|\s*/); // just to avoid costly ops if malformed
  const idx = line.indexOf(":");
  if (idx === -1) return [];
  return line.slice(idx + 1).trim().split(/\s+/);
}

// ---------- main digest for a single table block ----------
export function digestExploreTable(block: string, dir: Dir): ScanSummary | undefined {
  // Collect six labeled rows
  const rows: Record<RowKey, string[]> = {
    "+2": [], "+1": [], "0": [], "-1": [], "-2": [], "-3": []
  };
  const lines = block.split(/\r?\n/);

  for (const key of ROW_KEYS) {
    const line = lines.find(l => l.trimStart().startsWith(`${key}:`));
    if (!line) return undefined;
    const cells = tokenizeRow(line);
    if (cells.length < 5) return undefined;
    rows[key] = cells.slice(0, 5);
  }

  const steps: StepInfo[] = [];

  for (let col = 0; col < 5; col++) {
    // Column slice for convenience
    const c = {
      "+2": rows["+2"][col], "+1": rows["+1"][col], "0": rows["0"][col],
      "-1": rows["-1"][col], "-2": rows["-2"][col], "-3": rows["-3"][col],
    };

    // Hazards in this column
    const water = isWater(c["+2"]) || isWater(c["+1"]) || isWater(c["0"]) ||
                  isWater(c["-1"]) || isWater(c["-2"]) || isWater(c["-3"]);
    const lava  = isLava(c["+2"]) || isLava(c["+1"]) || isLava(c["0"]) ||
                  isLava(c["-1"]) || isLava(c["-2"]) || isLava(c["-3"]);

    // Choose target foot height h ∈ {+1, 0, -1, -2}
    // Body occupies [h, h+1], floor must exist at [h-1], and [h,h+1] must both be AIR.
    // Preference order: level (0), small up (+1), small drop (-1), bigger drop (-2).
    const candidates: Array<-2|-1|0|1> = [0, 1, -1, -2];
    let chosen: -2 | -1 | 0 | 1 | null = null;

    for (const h of candidates) {
      const b0 = h === 1 ? "+1" : h === 0 ? "0"  : h === -1 ? "-1" : "-2";
      const b1 = h === 1 ? "+2" : h === 0 ? "+1" : h === -1 ? "0"  : "-1";
      const fl = h === 1 ? "0"  : h === 0 ? "-1" : h === -1 ? "-2" : "-3";

      const air2 = isAir(c[b0]) && isAir(c[b1]);
      const floor = isSolidFloor(c[fl]);

      if (air2 && floor) { chosen = h; break; }
    }

    const enterable = !lava && chosen !== null;
    steps.push({
      dy:      chosen,
      air2:    chosen !== null, // by construction if chosen
      hasWater: water,
      hasLavaOrMagma: lava,
      enterable
    });
  }

  // Compute safe_len and first hazard/water columns
  let safe_len = 0 as number;
  let water_at: ScanSummary["water_at"] = null;
  let hazard_at: ScanSummary["hazard_at"] = null;

  for (let i = 0; i < 5; i++) {
    const s = steps[i];
    if (water_at === null && s.hasWater) water_at = (i + 1) as 1|2|3|4|5;
    if (hazard_at === null && s.hasLavaOrMagma) hazard_at = (i + 1) as 1|2|3|4|5;

    // A "safe" step is enterable and has no water or lava/magma in that column
    if (s.enterable && !s.hasWater && !s.hasLavaOrMagma) safe_len++;
    else break;
  }

  return {
    dir,
    steps: steps as ScanSummary["steps"],
    safe_len,
    water_at,
    hazard_at
  };
}

// ---------- log extractor: find latest explore-table block and digest ----------
/**
 * Extract the latest "Exploring <DIR> from (...)" block from log lines,
 * parse its 6 table rows, and return a ScanSummary.
 */
export function extractLatestScanFromLog(logLines: string[], preferredDir?: Dir): ScanSummary | undefined {
  // Walk backwards to find the last "Exploring ..." header
  for (let i = logLines.length - 1; i >= 0; i--) {
    const hdr = parseExploreHeader(logLines[i]);
    if (!hdr) continue;

    const dir = toDir(hdr.dir) ?? preferredDir;
    if (!dir) continue;

    // Collect a small window of lines after the header to capture the table
    const window = logLines.slice(i, Math.min(logLines.length, i + 40)).join("\n");

    // Fast check: require all 6 row labels present
    if (!ROW_KEYS.every(k => new RegExp(`^\\s*\\${k}:`, "m").test(window))) continue;

    const sum = digestExploreTable(window, dir);
    if (sum) return sum;
  }
  return undefined;
}

function parseExploreHeader(line: string): { dir: string } | null {
  // Examples:
  // "Exploring NORTHWEST from (1860, 83, 435) — clicks will queue mine:"
  // "Exploring WEST from ..."
  const m = line.match(/^\s*Exploring\s+([A-Z]+)\b/i);
  if (!m) return null;
  return { dir: m[1] };
}
