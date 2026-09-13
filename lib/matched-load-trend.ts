// AI Assistant, Slice 1 — "The Matched-Load Watcher"
// (ai_assistant_opus_deep_dive_findings.md). The single best-evidenced,
// cheapest signal in the whole assistant concept: RPE rising at a
// matched-or-lower top-set load across several consecutive sessions is a
// real fatigue-accumulation marker that objective load measures miss
// (Pind et al. 2021, Frontiers in Physiology — perceived effort rose
// across a loading block while heart-rate-zone distribution stayed
// flat). The same function runs in reverse for the celebration case: RPE
// FALLING at a matched-or-higher load is a real strength gain the
// athlete's top-set weight hasn't caught up to yet.
//
// Deliberately zero AI, zero new schema — reads straight off
// set_logs.rpe/weight, already tracked by default. Detection only: this
// file has no opinion about WHY a trend exists (a deliberate diet phase,
// an injury, a bad week) — that's the caller's job (dashboard-data.ts
// suppresses the fatigue direction for an athlete in a nutrition_checkins
// 'fat_loss' phase, since falling performance is the expected, not
// concerning, result of a deliberate deficit).

// Minimum consecutive sessions before a trend counts as real, not noise —
// same role as lib/pr-fatigue.ts's isEstablishingBaseline, just expressed
// as a session count rather than a calendar window (RPE-per-session-per-
// exercise is naturally sparser than daily check-in data, so a session
// count is the meaningful unit here).
export const MATCHED_LOAD_WINDOW_SESSIONS = 3;

export interface ExerciseSessionPoint {
  sessionDate: string;
  topWeight: number;
  topSetRpe: number;
}

export interface MatchedLoadTrend {
  direction: "fatigue" | "strength_gain";
  exerciseName: string;
  sessionCount: number;
  rpeStart: number;
  rpeEnd: number;
  weightStart: number;
  weightEnd: number;
}

function longestStreak(
  points: ExerciseSessionPoint[],
  direction: "fatigue" | "strength_gain"
): number {
  let count = 1;
  for (let i = points.length - 1; i > 0; i--) {
    const curr = points[i];
    const prev = points[i - 1];
    const weightOk =
      direction === "fatigue"
        ? curr.topWeight <= prev.topWeight
        : curr.topWeight >= prev.topWeight;
    const rpeOk =
      direction === "fatigue"
        ? curr.topSetRpe >= prev.topSetRpe
        : curr.topSetRpe <= prev.topSetRpe;
    if (!weightOk || !rpeOk) break;
    count++;
  }
  return count;
}

// `points` must already be sorted oldest -> newest, one entry per
// session (that session's single heaviest logged set for this exercise,
// and that set's own RPE — not an average across the session).
//
// Extends backward from the most recent session as far as the pattern
// holds, so a genuine 5-session streak reports sessionCount: 5, not
// capped at the 3-session minimum. A perfectly flat streak (weight AND
// RPE both unchanged throughout) satisfies neither direction's final
// "real net change" check and correctly returns null — this only fires
// on an actual trend, not the absence of one.
export function detectMatchedLoadTrend(
  exerciseName: string,
  points: ExerciseSessionPoint[]
): MatchedLoadTrend | null {
  if (points.length < MATCHED_LOAD_WINDOW_SESSIONS) return null;

  const fatigueStreak = longestStreak(points, "fatigue");
  if (fatigueStreak >= MATCHED_LOAD_WINDOW_SESSIONS) {
    const window = points.slice(-fatigueStreak);
    const rpeStart = window[0].topSetRpe;
    const rpeEnd = window[window.length - 1].topSetRpe;
    if (rpeEnd > rpeStart) {
      return {
        direction: "fatigue",
        exerciseName,
        sessionCount: fatigueStreak,
        rpeStart,
        rpeEnd,
        weightStart: window[0].topWeight,
        weightEnd: window[window.length - 1].topWeight,
      };
    }
  }

  const gainStreak = longestStreak(points, "strength_gain");
  if (gainStreak >= MATCHED_LOAD_WINDOW_SESSIONS) {
    const window = points.slice(-gainStreak);
    const rpeStart = window[0].topSetRpe;
    const rpeEnd = window[window.length - 1].topSetRpe;
    if (rpeEnd < rpeStart) {
      return {
        direction: "strength_gain",
        exerciseName,
        sessionCount: gainStreak,
        rpeStart,
        rpeEnd,
        weightStart: window[0].topWeight,
        weightEnd: window[window.length - 1].topWeight,
      };
    }
  }

  return null;
}
