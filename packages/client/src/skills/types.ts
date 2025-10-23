// skills/types.ts 
export type Dir =
  | "north"|"south"|"east"|"west"
  | "northeast"|"northwest"|"southeast"|"southwest";

export type StepInfo = {
  dy: -2 | -1 | 0 | 1 | 2 | null;   // how much to change Y to enter this column; null = not enterable
  air2: boolean;                 // two stacked AIR at the body space for that dy
  hasWater: boolean;
  hasLavaOrMagma: boolean;
  enterable: boolean;            // !hasLavaOrMagma && dy !== null
};

export type ScanSummary = {
  dir: Dir;
  steps: [StepInfo, StepInfo, StepInfo, StepInfo, StepInfo];
  safe_len: number;              // consecutive prefix of enterable steps with no water/lava
  water_at: 1|2|3|4|5|null;
  hazard_at: 1|2|3|4|5|null;
};

export type PlayerProgress = {
  level: number;
  unlockedSkills: Set<string>;
  flags?: Record<string, boolean>;
};

export type SkillCtx = {
  recentCommands: string[];                          // lowercased history
  latestScan: (dir: Dir) => ScanSummary | undefined; // provided by your parser/state
  exec: (atomicCmd: string) => Promise<void>;        // send ONE primitive command
  say?: (text: string) => void;
  progress: PlayerProgress;
  invokeSkill?: (name: string, ...args: string[]) => Promise<SkillResult>; // skill composition
};

export type SkillResult = "done" | "blocked" | "locked";

export type Skill = (ctx: SkillCtx, ...args: string[]) => Promise<SkillResult>;

export type SkillMeta = {
  fn: Skill;
  requiredLevel?: number;
  flag?: string;
  description?: string;   // short one-liner
  args?: string[];        // e.g., ["<dir>"]
  examples?: string[];    // e.g., ["skill march west"]
};

export const Skills: Record<string, SkillMeta> = {};

export function registerSkill(
  name: string,
  fn: Skill,
  opts: Omit<SkillMeta, "fn"> = {}
) {
  Skills[name.toLowerCase()] = { fn, ...opts };
}



