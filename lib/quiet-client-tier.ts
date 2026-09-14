// Frequency-normalized quiet-client detection (coach_dashboard_redesign_
// scoping.md) — raw calendar days is the wrong unit: a 2-day/week
// program missing 5 days isn't concerning, a 6-day/week program missing
// 5 days has skipped almost everything prescribed. Normalizes to how
// many of the client's OWN scheduled training days have passed with
// nothing logged, compared to their own weekly frequency — mild tier ≈
// one week's worth of their own sessions missed, strong tier ≈ two
// weeks' worth.
//
// The 7-day/14-day calendar thresholds are the fallback ONLY for
// freeform clients with no program schedule to normalize against — real,
// sourced research behind these two numbers specifically (a 2025 mHealth
// study defining churn as one week with no workout; Bedford's gym-
// retention research showing 14 days as where dropout hazard peaks).
// The commonly-repeated "14 days -> 48% cancellation" stat traces to an
// unsourced commerce blog — never cite it.

export type QuietTier = "none" | "mild" | "strong";

// Shared wording so every surface that flags a quiet client (Dashboard
// hero, Calendar's Needs Attention box, Client Profile's own banner)
// says the same thing about the same tier — previously each surface
// wrote its own copy next to its own ad-hoc quiet-detection math, which
// is how Calendar's box ended up disagreeing with everywhere else.
export const QUIET_TIER_LABEL: Record<"mild" | "strong", string> = {
  mild: "hasn't logged in a while",
  strong: "has gone quiet — worth a personal check-in",
};

const FREEFORM_MILD_DAYS = 7;
const FREEFORM_STRONG_DAYS = 14;

function daysBetween(a: Date, b: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

// Counts how many of `trainingDays` (weekday numbers, 0=Sun..6=Sat) fall
// strictly after `since` and on or before `now`.
function countScheduledDaysMissed(since: Date, now: Date, trainingDays: number[]): number {
  const trainingSet = new Set(trainingDays);
  let count = 0;
  const cursor = new Date(since);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor.getTime() <= now.getTime()) {
    if (trainingSet.has(cursor.getDay())) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function computeQuietTier(params: {
  lastLoggedAt: Date | null;
  now: Date;
  // The athlete's own active program's training_days, when one exists
  // with a real schedule. Null/empty falls back to the calendar-day
  // thresholds (freeform logging, or an unscheduled "playlist mode"
  // program).
  trainingDays: number[] | null;
}): QuietTier {
  const { lastLoggedAt, now, trainingDays } = params;
  const hasSchedule = !!trainingDays && trainingDays.length > 0;

  // Never logged at all — same "ranks above any stale date" rule already
  // used by the Clients page's own needs-attention sort. Immediately
  // strong rather than waiting out a grace period; there's no real
  // baseline to be lenient against.
  if (!lastLoggedAt) return "strong";

  if (!hasSchedule) {
    const days = daysBetween(lastLoggedAt, now);
    if (days >= FREEFORM_STRONG_DAYS) return "strong";
    if (days >= FREEFORM_MILD_DAYS) return "mild";
    return "none";
  }

  const weeklyFrequency = trainingDays!.length;
  const missed = countScheduledDaysMissed(lastLoggedAt, now, trainingDays!);
  if (missed >= weeklyFrequency * 2) return "strong";
  if (missed >= weeklyFrequency) return "mild";
  return "none";
}
