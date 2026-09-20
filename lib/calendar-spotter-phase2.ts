// Calendar Spotter Phase 2
// (calendar_spotter_phase2_and_cross_industry_scheduling_optimization_
// research_sept19.md) — three org/coach-scoped scheduling patterns,
// distinct from calendar-spotter.ts's per-athlete attendance-drift
// focus. Same governing rule as every Spotter in this app: pure
// detection, suggestive only, never auto-applied.

// --- Pattern 1: recurring schedule gaps ------------------------------
// A coach's own recurring availability minus their actual bookings,
// over real calendar occurrences (not just "this window has few
// bookings ever") — flags a window that has gone unbooked every single
// time it recurred in the lookback period, real dead time worth
// noticing rather than one slow week.

export interface AvailabilityWindow {
  weekday: number; // 0 (Sun) - 6 (Sat), matches Date.getDay()
  startTime: string; // "HH:MM" (or "HH:MM:SS", only H/M are read)
  endTime: string;
}

export interface BookingInstant {
  startAt: Date;
}

export interface RecurringGapResult {
  weekday: number;
  startTime: string;
  endTime: string;
  weeksChecked: number;
}

const DEFAULT_WEEKS_BACK = 6;

export function detectRecurringScheduleGaps(
  windows: AvailabilityWindow[],
  bookings: BookingInstant[],
  asOf: Date,
  weeksBack: number = DEFAULT_WEEKS_BACK
): RecurringGapResult[] {
  const results: RecurringGapResult[] = [];

  for (const window of windows) {
    const [startHour, startMinute] = window.startTime.split(":").map(Number);
    const [endHour, endMinute] = window.endTime.split(":").map(Number);

    let weeksChecked = 0;
    let weeksUnbooked = 0;
    const cursor = new Date(asOf);
    cursor.setHours(0, 0, 0, 0);

    // Walk backward one day at a time until weeksBack real occurrences
    // of this weekday are found (never assumes exactly 7 days/week
    // apart from "today" — correct even if asOf isn't itself that
    // weekday).
    while (weeksChecked < weeksBack) {
      cursor.setDate(cursor.getDate() - 1);
      if (cursor.getDay() !== window.weekday) continue;
      weeksChecked++;

      const rangeStart = new Date(cursor);
      rangeStart.setHours(startHour, startMinute, 0, 0);
      const rangeEnd = new Date(cursor);
      rangeEnd.setHours(endHour, endMinute, 0, 0);

      const hasBooking = bookings.some((b) => b.startAt >= rangeStart && b.startAt < rangeEnd);
      if (!hasBooking) weeksUnbooked++;
    }

    if (weeksChecked === weeksBack && weeksUnbooked === weeksChecked) {
      results.push({ weekday: window.weekday, startTime: window.startTime, endTime: window.endTime, weeksChecked });
    }
  }

  return results;
}

// --- Pattern 2: uneven load across a multi-trainer org ---------------
// Compares real booked-minutes totals per trainer over a trailing
// window. Only compares trainers who have SOME real booked activity —
// a trainer with literally zero bookings is a different, more urgent
// signal than "half-empty," and forcing a ratio against zero produces
// a meaningless Infinity rather than a real number.

export interface TrainerLoad {
  trainerId: string;
  trainerName: string;
  bookedMinutes: number;
}

export interface UnevenLoadResult {
  overloadedTrainerId: string;
  overloadedTrainerName: string;
  overloadedMinutes: number;
  underloadedTrainerId: string;
  underloadedTrainerName: string;
  underloadedMinutes: number;
  ratio: number;
}

const DEFAULT_MIN_RATIO = 2;

export function detectUnevenTrainerLoad(
  loads: TrainerLoad[],
  minRatio: number = DEFAULT_MIN_RATIO
): UnevenLoadResult | null {
  const withBookings = loads.filter((l) => l.bookedMinutes > 0);
  if (withBookings.length < 2) return null;

  const sorted = [...withBookings].sort((a, b) => b.bookedMinutes - a.bookedMinutes);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const ratio = top.bookedMinutes / bottom.bookedMinutes;
  if (ratio < minRatio) return null;

  return {
    overloadedTrainerId: top.trainerId,
    overloadedTrainerName: top.trainerName,
    overloadedMinutes: top.bookedMinutes,
    underloadedTrainerId: bottom.trainerId,
    underloadedTrainerName: bottom.trainerName,
    underloadedMinutes: bottom.bookedMinutes,
    ratio,
  };
}

// --- Pattern 3: booked-vs-actual duration mismatch --------------------
// Needs athlete_sessions.booking_id (migration 0203) to exist first —
// the caller supplies real (booked, actual) minute pairs for sessions
// that are genuinely linked to a real booking. Gated on a real minimum
// sample size (not Wilson — this is a continuous duration measure, not
// a proportion; a plain sample-size floor is the honest tool here,
// same reasoning already used for the Spotter feedback loop's own
// stop-suggesting threshold), so a handful of outlier days never
// triggers a re-slotting suggestion.

export interface BookedVsActualPair {
  bookedMinutes: number;
  actualMinutes: number;
}

export interface DurationMismatchResult {
  sampleSize: number;
  avgBookedMinutes: number;
  avgActualMinutes: number;
  avgDeltaMinutes: number;
  avgDeltaPct: number;
  direction: "shorter" | "longer";
}

const DEFAULT_MIN_SAMPLE_SIZE = 10;
const DEFAULT_THRESHOLD_PCT = 20;

export function detectBookedVsActualMismatch(
  pairs: BookedVsActualPair[],
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  thresholdPct: number = DEFAULT_THRESHOLD_PCT
): DurationMismatchResult | null {
  if (pairs.length < minSampleSize) return null;

  const avgBookedMinutes = pairs.reduce((sum, p) => sum + p.bookedMinutes, 0) / pairs.length;
  const avgActualMinutes = pairs.reduce((sum, p) => sum + p.actualMinutes, 0) / pairs.length;
  const avgDeltaMinutes = avgActualMinutes - avgBookedMinutes;
  const avgDeltaPct = avgBookedMinutes === 0 ? 0 : (Math.abs(avgDeltaMinutes) / avgBookedMinutes) * 100;

  if (avgDeltaPct < thresholdPct) return null;

  return {
    sampleSize: pairs.length,
    avgBookedMinutes,
    avgActualMinutes,
    avgDeltaMinutes,
    avgDeltaPct,
    direction: avgDeltaMinutes < 0 ? "shorter" : "longer",
  };
}
