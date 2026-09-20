// Calendar Spotter Phase 2 — links a newly-started session to the real
// booking it fulfills, if one exists. Pure matching logic only; the
// caller fetches candidate bookings (this athlete, confirmed, roughly
// near "now") and this picks the closest one by start time.
export interface CandidateBooking {
  id: string;
  startAt: Date;
}

// 2-hour tolerance — generous enough that a coach starting a session a
// little early/late (or a client arriving late) still links correctly,
// tight enough that it never accidentally matches a different day's
// booking for a client with multiple weekly sessions.
const DEFAULT_TOLERANCE_MINUTES = 120;

export function findMatchingBookingId(
  bookings: CandidateBooking[],
  sessionStartedAt: Date,
  toleranceMinutes: number = DEFAULT_TOLERANCE_MINUTES
): string | null {
  const toleranceMs = toleranceMinutes * 60000;
  const candidates = bookings.filter(
    (b) => Math.abs(b.startAt.getTime() - sessionStartedAt.getTime()) <= toleranceMs
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(a.startAt.getTime() - sessionStartedAt.getTime()) -
      Math.abs(b.startAt.getTime() - sessionStartedAt.getTime())
  );
  return candidates[0].id;
}
