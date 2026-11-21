// How long one-on-one clients stay (Ron, Nov 20: R4), for the Business page. Read-only and plain:
//   - time with you: from signing up to now for a client still active (a workout or a past session in the last ACTIVE_DAYS, or signed up within them), otherwise to their last active day
//     (their last workout or past session; a client with neither counts no time). A client removed from your clients counts to their last active day, never past the removal.
//   - still active after 3, 6 and 12 months: of the clients who signed up at least that long ago, how many were still active that long after signing up.
// The rows come from business_client_tenure (step 219): current one-on-one clients and ones removed (not put back), with dates only, under the same privacy as the rest of the page.

export const ACTIVE_DAYS = 30;
export const MILESTONES = [3, 6, 12] as const;
export type RetentionPeriod = "12m" | "24m" | "all";
export const PERIOD_LABEL: Record<RetentionPeriod, string> = { "12m": "Signed up in the last 12 months", "24m": "Signed up in the last 2 years", all: "Everyone" };
const DAY = 86_400_000;

export interface TenureRow {
  athlete_id: string;
  group_id: string;
  joined_at: string | null;
  removed_at: string | null;
  last_active: string | null;
}

/** N calendar months after a moment (Jan 31 + 1 month = the last day of February). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** When a client's time with you ends: now while they are still active, else their last active day (not before signing up, not after a removal). */
export function tenureEnd(row: TenureRow, now: Date): Date | null {
  if (!row.joined_at) return null;
  const start = new Date(row.joined_at);
  if (Number.isNaN(start.getTime())) return null;
  const removed = row.removed_at ? new Date(row.removed_at) : null;
  const last = row.last_active ? new Date(row.last_active) : null;
  if (!removed && (now.getTime() - start.getTime() < ACTIVE_DAYS * DAY || (last && now.getTime() - last.getTime() <= ACTIVE_DAYS * DAY))) return now;
  let end = last ?? start;
  if (removed && end > removed) end = removed;
  return end < start ? start : end;
}

export interface RetentionSummary {
  clients: number;
  stillActive: number;
  /** average time with you, in whole days; null with no clients */
  averageDays: number | null;
  after: { months: number; signedUpLongEnough: number; stillActive: number; pct: number | null }[];
}

export function retentionSummary(rows: TenureRow[], now: Date, period: RetentionPeriod = "all"): RetentionSummary {
  const since = period === "12m" ? addMonths(now, -12) : period === "24m" ? addMonths(now, -24) : null;
  // the same client twice (two one-on-one spaces, or removed and back): each time with you counts as its own
  const spans = rows
    .map((r) => ({ start: r.joined_at ? new Date(r.joined_at) : null, end: tenureEnd(r, now) }))
    .filter((s): s is { start: Date; end: Date } => !!s.start && !!s.end && !Number.isNaN(s.start.getTime()) && s.start <= now && (!since || s.start >= since));
  const total = spans.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()), 0);
  return {
    clients: spans.length,
    stillActive: spans.filter((s) => s.end.getTime() === now.getTime()).length,
    averageDays: spans.length > 0 ? Math.round(total / spans.length / DAY) : null,
    after: MILESTONES.map((months) => {
      const eligible = spans.filter((s) => addMonths(s.start, months) <= now);
      const still = eligible.filter((s) => s.end >= addMonths(s.start, months)).length;
      return { months, signedUpLongEnough: eligible.length, stillActive: still, pct: eligible.length > 0 ? Math.round((still / eligible.length) * 100) : null };
    }),
  };
}

/** "4 months", "1 year 2 months", "12 days". */
export function durationWords(days: number): string {
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} year${y === 1 ? "" : "s"}${m ? ` ${m} month${m === 1 ? "" : "s"}` : ""}`;
}
