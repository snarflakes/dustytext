// src/commandQueue.ts

// A FIFO command queue to ensure only one blockchain command runs at a time

export type Job = () => Promise<void>;

class CommandQueue {
  private queue: Job[] = [];
  private running = false;

  enqueue(job: Job) {
    this.queue.push(job);
    this.runNext();
  }

  private async runNext() {
    if (this.running || this.queue.length === 0) return;

    this.running = true;
    const nextJob = this.queue.shift()!;
    try {
      await nextJob();
    } catch (err) {
      console.error("Command failed:", err);
    } finally {
      this.running = false;
      this.runNext();
    }
  }
}

export const commandQueue = new CommandQueue();

export type Source = "human" | "ai";
export type Block = { x: number; y: number; z: number; name?: string; layer?: number };
export type QueuedOp = { action: string; block: Block };

export const queuedOps: QueuedOp[] = [];

// Lock: only one "actor" (human or ai) can queue at a time
let activeQueueSource: Source | null = null;

export function getQueueOwner(): Source | null { return activeQueueSource; }
export function getQueueSize(): number { return queuedOps.length; }
export function queueSizeByAction(action: string): number {
  return queuedOps.filter(q => q.action === action).length;
}

export function addToQueue(action: string, blocks: Block[], source: Source) {
  action = action || "mine";
  if (activeQueueSource && activeQueueSource !== source) {
    throw new Error(`Queue owned by ${activeQueueSource}. Type 'done' or 'clear' before ${source} can queue.`);
  }
  if (!activeQueueSource) activeQueueSource = source;

  // De-dupe by (action + coord)
  const seen = new Set(queuedOps.map(q => `${q.action}:${q.block.x},${q.block.y},${q.block.z}`));
  for (const b of blocks) {
    const key = `${action}:${b.x},${b.y},${b.z}`;
    if (!seen.has(key)) {
      queuedOps.push({ action, block: b });
      seen.add(key);
    }
  }
}
export function isQueued(action: string, b: Block) {
  return queuedOps.some(q => q.action === action && q.block.x===b.x && q.block.y===b.y && q.block.z===b.z);
}
export function removeFromQueue(action: string, b: Block) {
  const i = queuedOps.findIndex(q => q.action === action && q.block.x===b.x && q.block.y===b.y && q.block.z===b.z);
  if (i !== -1) { queuedOps.splice(i,1); return true; }
  return false;
}

let paused = false;
let pausePromise: Promise<void> | null = null;
let _resume: (() => void) | null = null;
let pauseReason: string | null = null;

export function pauseQueue(reason: string = "move") {
  if (paused) return;
  paused = true;
  pauseReason = reason;
  pausePromise = new Promise<void>(res => (_resume = res));
}

export function resumeQueue() {
  if (!paused) return;
  paused = false;
  pauseReason = null;
  const r = _resume; _resume = null;
  pausePromise = null;
  r && r();
}

export async function waitIfPaused() {
  if (paused && pausePromise) await pausePromise;
}

export async function withQueuePause<T>(fn: () => Promise<T>) {
  pauseQueue("move"); // keeps your existing callsites unchanged
  try { return await fn(); }
  finally { resumeQueue(); }
}

// (optional, useful for logs/AI): expose status
export function getQueueStatus() {
  return { paused, pauseReason, owner: getQueueOwner(), size: getQueueSize() };
}

// Clear the unified selection queue.
// - If `action` is provided, only that action's items are removed.
// - If the queue becomes empty, release ownership and ensure we're not paused.
export function clearSelection(action?: string) {
  if (typeof action === "string" && action.length > 0) {
    // remove only matching action entries
    for (let i = queuedOps.length - 1; i >= 0; i--) {
      if (queuedOps[i].action === action) queuedOps.splice(i, 1);
    }
  } else {
    // remove everything
    queuedOps.splice(0, queuedOps.length);
  }

  // If nothing left, release the owner and unpause so the system can't get stuck.
  if (queuedOps.length === 0) {
    activeQueueSource = null;
    resumeQueue(); // safe even if not paused
  }
}