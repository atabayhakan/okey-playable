interface Task {
  fn: () => void;
  remaining: number;
  due: number;
  handle: ReturnType<typeof setTimeout> | null;
}

/**
 * setTimeout that can be frozen. Playables requires all game activity to stop
 * between onPause and onResume, so every timed game action goes through here.
 */
export class Scheduler {
  private readonly tasks = new Set<Task>();
  private paused = false;

  /** Returns a cancel function. */
  after(ms: number, fn: () => void): () => void {
    const task: Task = { fn, remaining: ms, due: 0, handle: null };
    this.tasks.add(task);
    if (!this.paused) this.arm(task);
    return () => {
      if (task.handle !== null) clearTimeout(task.handle);
      this.tasks.delete(task);
    };
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    const now = performance.now();
    for (const task of this.tasks) {
      if (task.handle === null) continue;
      clearTimeout(task.handle);
      task.handle = null;
      task.remaining = Math.max(0, task.due - now);
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const task of this.tasks) this.arm(task);
  }

  private arm(task: Task): void {
    task.due = performance.now() + task.remaining;
    task.handle = setTimeout(() => {
      this.tasks.delete(task);
      task.fn();
    }, task.remaining);
  }
}
