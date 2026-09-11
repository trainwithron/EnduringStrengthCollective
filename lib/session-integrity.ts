// Suspiciously-fast-session flag — a passive integrity signal, never a
// blocker. Compares a completed session's real elapsed time (already
// captured by athlete_sessions.duration_seconds via the shipped stopwatch
// feature) against a rough expected-minimum floor derived from its
// prescribed sets and typical rest — not a precise model of how long a
// workout "should" take, just enough to catch the physically-implausible
// case (many sets logged in a few minutes) Ron found in his own real data.

// Conservative per-set floor: real time under the bar plus a fraction of
// the prescribed rest — deliberately generous (never flags a genuinely
// fast, efficient athlete) so this only fires on results that are
// physically implausible, not just brisk.
const SECONDS_PER_SET_FLOOR = 20; // time actually performing the set
const MIN_REST_FRACTION = 0.5; // credit at least half of prescribed rest

export function computeExpectedMinimumSeconds(
  sets: { restSeconds: number | null }[]
): number {
  return sets.reduce(
    (total, s) => total + SECONDS_PER_SET_FLOOR + (s.restSeconds ?? 60) * MIN_REST_FRACTION,
    0
  );
}

export function isSuspiciouslyFast(actualSeconds: number, expectedMinimumSeconds: number): boolean {
  if (expectedMinimumSeconds <= 0) return false;
  return actualSeconds < expectedMinimumSeconds * 0.5;
}

export interface FlaggableSession {
  sessionId: string;
  actualSeconds: number;
  expectedMinimumSeconds: number;
  completedAt: string;
}

export type IntegrityLevel = "none" | "single" | "pattern";

// Per-athlete rollup: a lone fast session is a quiet, easy-to-dismiss
// anomaly (a genuinely fast athlete, a coach-logged partial session);
// a repeated pattern is the real signal worth a coach conversation —
// same escalation shape already used elsewhere in this app for
// compliance/readiness (a count crossing a small threshold changes
// visual weight, not just a bigger number).
const PATTERN_THRESHOLD = 3;

export function computeIntegrityLevel(sessions: FlaggableSession[]): {
  level: IntegrityLevel;
  flaggedCount: number;
  flaggedSessions: FlaggableSession[];
} {
  const flagged = sessions.filter((s) => isSuspiciouslyFast(s.actualSeconds, s.expectedMinimumSeconds));
  const level: IntegrityLevel =
    flagged.length === 0 ? "none" : flagged.length >= PATTERN_THRESHOLD ? "pattern" : "single";
  return { level, flaggedCount: flagged.length, flaggedSessions: flagged };
}
