import { AsyncLocalStorage } from "node:async_hooks";

// Counts the AI calls made during ONE run of a scheduled job, so the job monitor can tell "every call failed" from "nothing to do". The AI jobs swallow a failed
// call (a briefing for one coach is skipped, not fatal), which is how a total outage once showed as "ok" for days (Assistant, Oct 7). Per-run, via an async
// context, so two requests on the same server instance never count each other's calls.

export interface AiRunStats {
  attempts: number;
  failures: number;
  lastClass: string | null;
}

const storage = new AsyncLocalStorage<AiRunStats>();

export function trackAiRun<T>(fn: (stats: AiRunStats) => Promise<T>): Promise<T> {
  const stats: AiRunStats = { attempts: 0, failures: 0, lastClass: null };
  return storage.run(stats, () => fn(stats));
}

// Called by the Claude wrapper for every call it makes (no-op outside a tracked run).
export function noteAiAttempt(result: { ok: boolean; errorClass?: string }): void {
  const stats = storage.getStore();
  if (!stats) return;
  stats.attempts += 1;
  if (!result.ok) {
    stats.failures += 1;
    stats.lastClass = result.errorClass ?? "unknown";
  }
}

// True when the run made calls and every one of them failed.
export function everyAiCallFailed(stats: AiRunStats): boolean {
  return stats.attempts > 0 && stats.failures === stats.attempts;
}
