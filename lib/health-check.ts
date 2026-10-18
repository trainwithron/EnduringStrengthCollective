import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MONITORING_STARTED, findStaleJobs, type CronRunRow } from "@/lib/cron-jobs";

// What /api/health answers, and what the public status page shows: one reading, two readers. "status" is "ok" when the database answers and every job is healthy, "degraded" (still 200) when the database answers but some
// job is failing or has stopped, and "error" (503) when the database does not answer. Only job names are shown, never details.
export interface HealthReading {
  httpStatus: number;
  body: Record<string, unknown>;
  status: "ok" | "degraded" | "error";
}

export async function readHealth(): Promise<HealthReading> {
  const startedAt = Date.now();
  try {
    const supabase = createServiceRoleClient();
    // Cheapest possible real round-trip to the database — not asking anything about the data itself, just confirming the connection and credentials actually work end to end.
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (error) throw error;

    let stale: { job: string; reason: string }[] = [];
    let monitoring = false;
    try {
      const { data, error: cronError } = await supabase.from("cron_runs").select("job, last_success_at, last_status, consecutive_failures, updated_at");
      if (!cronError && data && data.length > 0) {
        monitoring = true;
        const rows = data as (CronRunRow & { updated_at: string })[];
        stale = findStaleJobs(rows, new Date(), { since: MONITORING_STARTED }).map((s) => ({ job: s.job, reason: s.reason }));
      }
    } catch {
      // Job monitoring is not set up yet: report the database alone.
    }

    const status = stale.length > 0 ? "degraded" : "ok";
    return {
      httpStatus: 200,
      status,
      body: {
        status,
        database: "reachable",
        // An intentional switch-off (AI_DISABLED=true) must not read as a quiet system.
        ai: process.env.AI_DISABLED === "true" ? "paused on purpose" : "on",
        jobs: monitoring ? (stale.length > 0 ? { status: "attention", stale } : { status: "ok" }) : { status: "not monitored yet" },
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    };
  } catch {
    return {
      httpStatus: 503,
      status: "error",
      body: { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
    };
  }
}

// The reading the PUBLIC status page shows. The page is open to anyone, so it must not cost two database reads for every visit, and it must not hang when the database is slow: the reading is remembered for 30 seconds, and a
// read that takes longer than 4 seconds counts as "we are having trouble" (which is what a person looking at a page that will not load should be told). The monitor's /api/health is not cached: it always asks.
let remembered: { at: number; reading: HealthReading } | null = null;
export const STATUS_PAGE_TTL_MS = 30_000;
export const STATUS_PAGE_TIMEOUT_MS = 4_000;

export function forgetStatusPageReading(): void {
  remembered = null;
}

export async function readHealthForPage(opts: { read?: () => Promise<HealthReading>; now?: () => number; ttlMs?: number; timeoutMs?: number } = {}): Promise<HealthReading> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? STATUS_PAGE_TTL_MS;
  if (remembered && now() - remembered.at < ttl) return remembered.reading;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<HealthReading>((resolve) => {
    timer = setTimeout(
      () => resolve({ httpStatus: 503, status: "error", body: { status: "error", database: "unreachable", timestamp: new Date().toISOString() } }),
      opts.timeoutMs ?? STATUS_PAGE_TIMEOUT_MS
    );
  });
  try {
    const reading = await Promise.race([(opts.read ?? readHealth)(), slow]);
    remembered = { at: now(), reading };
    return reading;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
