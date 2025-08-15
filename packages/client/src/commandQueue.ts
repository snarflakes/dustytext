// src/core/commandQueue.ts

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