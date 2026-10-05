// Every scheduled job (vercel.json "crons") with how long it may go without a successful run before something is wrong. Used by the
// watchdog and the health route. lib/cron-jobs.test.ts checks this list matches vercel.json exactly, so a job added to one and not the
// other fails the tests.
export interface CronJob {
  job: string;
  path: string;
  // Hours since the last successful run beyond which the job counts as stale. About 1.25x its schedule, with slack for a late start.
  maxAgeHours: number;
}

const DAILY = 30;
const WEEKLY = 8 * 24;
const FREQUENT = 1; // every 5 or 15 minutes

export const CRON_JOBS: CronJob[] = [
  { job: "spotter-tier-sync", path: "/api/cron/spotter-tier-sync", maxAgeHours: DAILY },
  { job: "coach-briefing", path: "/api/cron/coach-briefing", maxAgeHours: DAILY },
  { job: "oura-sync", path: "/api/oura/sync", maxAgeHours: DAILY },
  { job: "coach-digest", path: "/api/cron/coach-digest", maxAgeHours: DAILY },
  { job: "milestone-scan", path: "/api/cron/milestone-scan", maxAgeHours: WEEKLY },
  { job: "nutrition-checkin-suggestions", path: "/api/cron/nutrition-checkin-suggestions", maxAgeHours: WEEKLY },
  { job: "rest-day-nudge", path: "/api/cron/rest-day-nudge", maxAgeHours: DAILY },
  { job: "withings-sync", path: "/api/withings/sync", maxAgeHours: DAILY },
  { job: "google-health-sync", path: "/api/google-health/sync", maxAgeHours: DAILY },
  { job: "coach-chat-cleanup", path: "/api/cron/coach-chat-cleanup", maxAgeHours: DAILY },
  { job: "session-reminder", path: "/api/cron/session-reminder", maxAgeHours: FREQUENT },
  { job: "google-calendar-sync", path: "/api/cron/google-calendar-sync", maxAgeHours: DAILY },
  { job: "attendance-nudge-sms", path: "/api/cron/attendance-nudge-sms", maxAgeHours: DAILY },
  { job: "webhook-retry", path: "/api/cron/webhook-retry", maxAgeHours: FREQUENT },
  { job: "trainer-dispatch-advance", path: "/api/cron/trainer-dispatch-advance", maxAgeHours: FREQUENT },
  { job: "expire-session-credits", path: "/api/cron/expire-session-credits", maxAgeHours: DAILY },
  { job: "process-booking-waitlist", path: "/api/cron/process-booking-waitlist", maxAgeHours: FREQUENT },
  { job: "flag-recurring-booking-conflicts", path: "/api/cron/flag-recurring-booking-conflicts", maxAgeHours: DAILY },
  { job: "series-top-up", path: "/api/cron/series-top-up", maxAgeHours: DAILY },
  { job: "cron-watchdog", path: "/api/cron/cron-watchdog", maxAgeHours: DAILY },
];

export interface CronRunRow {
  job: string;
  last_success_at: string | null;
  last_status: string;
  consecutive_failures: number;
}

export interface StaleJob {
  job: string;
  reason: "failing" | "not_run_recently" | "never_run";
  hoursSinceSuccess: number | null;
}

// Jobs that need attention: failing right now, or without a success for longer than they should. A job that has never run is only
// reported once `graceHours` have passed since `since` (when monitoring began), so a fresh install is not flagged at once.
export function findStaleJobs(rows: CronRunRow[], now: Date, options: { since?: Date; graceHours?: number } = {}): StaleJob[] {
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const out: StaleJob[] = [];
  for (const def of CRON_JOBS) {
    const row = byJob.get(def.job);
    if (!row) {
      const graceMs = (options.graceHours ?? 48) * 3600000;
      if (options.since && now.getTime() - options.since.getTime() < graceMs) continue;
      out.push({ job: def.job, reason: "never_run", hoursSinceSuccess: null });
      continue;
    }
    const hours = row.last_success_at ? (now.getTime() - new Date(row.last_success_at).getTime()) / 3600000 : null;
    if (row.last_status === "error" && row.consecutive_failures >= 1) {
      out.push({ job: def.job, reason: "failing", hoursSinceSuccess: hours });
    } else if (hours === null || hours > def.maxAgeHours) {
      out.push({ job: def.job, reason: "not_run_recently", hoursSinceSuccess: hours });
    }
  }
  return out;
}

// Alert on the first failure, then again at 3, 10 and 30 in a row, so a broken job is not announced every five minutes.
export function shouldAlertForFailures(consecutiveFailures: number): boolean {
  return [1, 3, 10, 30].includes(consecutiveFailures);
}
