// progress/model.ts
export type PlayerProgress = {
  level: number;                // starts at 1
  tilesMoved: number;           // cumulative steps taken
  unlockedSkills: string[];     // store as array; rehydrate to Set if you like
  flags?: Record<string, boolean>;
};

export const MARCH_UNLOCK_MOVES = 5;
export const INCLUDE_VERTICAL = true;   // set false if you don't want u/d to count

export function loadProgress(id: string): PlayerProgress {
  const raw = localStorage.getItem(`prog:${id}`); // swap for your storage
  return raw ? JSON.parse(raw) : { level: 1, tilesMoved: 0, unlockedSkills: [] };
}
export function saveProgress(id: string, p: PlayerProgress) {
  localStorage.setItem(`prog:${id}`, JSON.stringify(p));
}

export function maybeLevelUp(p: PlayerProgress): boolean {
  // simple: level 2 when moves >= 5 (add more thresholds later)
  const targetLevel = p.tilesMoved >= MARCH_UNLOCK_MOVES ? 2 : 1;
  const leveled = targetLevel > p.level;
  if (leveled) p.level = targetLevel;
  return leveled;
}

export function ensureUnlocked(p: PlayerProgress, skill: string) {
  if (!p.unlockedSkills.includes(skill)) p.unlockedSkills.push(skill);
}
