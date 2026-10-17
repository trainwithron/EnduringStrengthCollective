// Runs `fn` over `items` a few at a time (instead of one after another), and stops starting new items once `deadlineMs` has passed since the call began, so a long list finishes inside a function's time limit.
// Items not started are returned (`notStarted`) so the caller can report them; an item whose function throws is returned in `failed` and never stops the rest.
export interface RunPoolResult<T> {
  notStarted: T[];
  failed: { item: T; error: unknown }[];
}

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>, opts: { deadlineMs?: number; now?: () => number } = {}): Promise<RunPoolResult<T>> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const queue = [...items];
  const failed: { item: T; error: unknown }[] = [];
  const worker = async () => {
    for (;;) {
      if (opts.deadlineMs !== undefined && now() - startedAt >= opts.deadlineMs) return;
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await fn(item);
      } catch (error) {
        failed.push({ item, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return { notStarted: queue, failed };
}
