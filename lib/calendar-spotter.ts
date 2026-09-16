// Calendar Spotter (scheduling_calendar_spotter_idea.md) — the deterministic,
// no-LLM, single-signal detector for attendance/booking-cadence drift, same
// governing pattern as the Programming and Nutrition Spotters: pure
// functions over already-shaped data, flag-only (never auto-acts), a coach
// decides what to do with a finding.
//
// Reads real attendance from public.bookings' new no_show/late_cancel
// columns (migration 0187) — a past confirmed booking is presumed attended
// unless the coach explicitly marks it a no-show (set_booking_no_show),
// and a late_cancel is the exact same on-time-vs-late judgment
// cancel_booking_and_refund_credit already made to decide a credit refund,
// just persisted so it can be read back here. Deliberately distinct from
// lib/quiet-client-tier.ts's computeQuietTier, which tracks workout-LOGGING
// cadence — this tracks booking-ATTENDANCE cadence, a genuinely separate
// signal for a coach running scheduled 1-on-1 sessions.

export interface AttendanceBooking {
  startAt: Date;
  status: "confirmed" | "cancelled";
  noShow: boolean;
  lateCancel: boolean;
}

// Grounded per proactive_variable_research_standing_rule.md, not guessed:
// Sobreiro et al. 2021 (IJERPH, n=5,209 real gym members) found
// "non-attendance days" (time since last visit) was the single strongest
// dropout predictor across every ML model tested (35-54% of predictive
// weight). A 2-consecutive-week gap also independently converges across
// multiple industry sources as the actionable intervention window.
const ATTENDANCE_GAP_DAYS = 14;

export interface AttendanceGapResult {
  isGapped: boolean;
  // null = never attended a booked session at all — deliberately NOT
  // flagged (no baseline to measure a "gap since" against), same honest
  // "no signal, no flag" convention already used for a missing DOB
  // elsewhere in this app.
  daysSinceLastAttended: number | null;
}

export function detectAttendanceGap(
  bookings: AttendanceBooking[],
  asOf: Date
): AttendanceGapResult {
  const attended = bookings.filter(
    (b) => b.status === "confirmed" && b.startAt.getTime() < asOf.getTime() && !b.noShow
  );
  if (attended.length === 0) {
    return { isGapped: false, daysSinceLastAttended: null };
  }
  const lastAttendedAt = attended.reduce(
    (latest, b) => (b.startAt.getTime() > latest ? b.startAt.getTime() : latest),
    attended[0].startAt.getTime()
  );
  const daysSinceLastAttended = Math.floor((asOf.getTime() - lastAttendedAt) / 86400000);
  return {
    isGapped: daysSinceLastAttended >= ATTENDANCE_GAP_DAYS,
    daysSinceLastAttended,
  };
}

// Catches "keeps booking then flaking," which a pure day-gap alone misses
// (a client who books weekly but no-shows/late-cancels most of them never
// accumulates a 14-day gap between BOOKINGS, only between real attendance).
// 3-4 week rolling window per the same research write-up; a reschedule or
// cancellation with 24h+ notice is responsible behavior, not disengagement,
// and deliberately does not count here (only late_cancel does).
const FLAKY_WINDOW_DAYS = 28;
const FLAKY_EVENT_THRESHOLD = 2;

export interface FlakyAttendanceResult {
  isFlaky: boolean;
  flakyEventCount: number;
}

export function detectFlakyAttendancePattern(
  bookings: AttendanceBooking[],
  asOf: Date
): FlakyAttendanceResult {
  const windowStartMs = asOf.getTime() - FLAKY_WINDOW_DAYS * 86400000;
  const flakyEventCount = bookings.filter((b) => {
    const t = b.startAt.getTime();
    if (t < windowStartMs || t > asOf.getTime()) return false;
    if (b.status === "confirmed") return b.noShow;
    if (b.status === "cancelled") return b.lateCancel;
    return false;
  }).length;
  return { isFlaky: flakyEventCount >= FLAKY_EVENT_THRESHOLD, flakyEventCount };
}

type AttendanceOutcome = "attended" | "flaky";

// An on-time cancellation is a non-event for this sequence (deliberately
// excluded, same "doesn't count against the client" rule as the flaky
// check above) — only an attended session or a genuine flaky event
// (no-show / late-cancel) advances the streak either way.
function toOutcomeSequence(bookings: AttendanceBooking[], asOf: Date): AttendanceOutcome[] {
  return bookings
    .filter((b) => b.startAt.getTime() <= asOf.getTime())
    .filter((b) => b.status === "confirmed" || b.lateCancel)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((b): AttendanceOutcome => (b.status === "confirmed" && !b.noShow ? "attended" : "flaky"));
}

const RECOVERY_STREAK = 2;

export interface AttendanceRecoveryResult {
  isRecovered: boolean;
}

// The good-news beat: 2 consecutive attended sessions after at least one
// flaky event earlier in the (already-passed) history — real, earned good
// news, not just "this client has always been fine." Stays attendance-only
// on purpose (scheduling_calendar_spotter_idea.md, resolved directly with
// Ron) — wearable/recovery correlation is recovery_trend_dual_channel_
// spotter_idea.md's separate job; the two connect one layer up, in the
// Collective Intelligence briefing's own cross-signal synthesis, not by
// merging Spotters.
export function detectAttendanceRecovery(
  bookings: AttendanceBooking[],
  asOf: Date
): AttendanceRecoveryResult {
  const sequence = toOutcomeSequence(bookings, asOf);
  if (sequence.length < RECOVERY_STREAK + 1) return { isRecovered: false };
  const recentStreak = sequence.slice(-RECOVERY_STREAK);
  const isStreakAttended = recentStreak.every((o) => o === "attended");
  if (!isStreakAttended) return { isRecovered: false };
  const priorToStreak = sequence.slice(0, -RECOVERY_STREAK);
  const hadFlakyBefore = priorToStreak.includes("flaky");
  return { isRecovered: hadFlakyBefore };
}
