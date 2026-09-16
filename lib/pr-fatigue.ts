// Phase 2 of the gamified-logging thread — PR-fatigue / baseline reframe.
// A brand-new exercise's very first "PR" is really just its only data
// point, not a genuine achievement to fanfare — celebrating it the same
// way as a real, hard-fought PR trains athletes to tune out the
// celebration entirely. Scoped per exercise NAME, not per account: an
// experienced lifter's first-ever set of a brand-new movement still gets
// the calm treatment, regardless of how many other exercises they've
// logged for years.

// Number of PRIOR completed sessions (excluding the current one) an
// athlete needs on a given exercise name before a new PR on it counts as
// a genuine, celebration-worthy result. Below this, there isn't enough
// real history yet to know if a number is actually impressive.
export const BASELINE_WINDOW_SESSIONS = 2;

export function isEstablishingBaseline(priorSessionCount: number): boolean {
  return priorSessionCount < BASELINE_WINDOW_SESSIONS;
}

// custom_shape_theming_idea.md — a PR can now come from weight, distance,
// time, or pace (complete_workout_session's PR detection is no longer
// weight-only), so this needs to hold whatever detail line actually
// applies rather than assuming weight/reps/oneRepMax. `primary`/
// `secondary` are pre-formatted by the caller (lib/shared-workout.ts) so
// this stays a plain display shape — this module never branches on which
// kind of PR it is, it only ever reads `.name`.
export interface PrListItem {
  name: string;
  primary: string;
  secondary: string;
}

export interface BaselineSplit {
  celebrate: PrListItem[];
  establishingBaseline: PrListItem[];
}

// priorSessionCountByName: exercise name -> count of prior completed
// sessions containing this exercise, excluding the current session.
// An exercise with no entry in the map is treated as zero prior
// sessions (the safest default — never over-celebrate on missing data).
export function splitPrsByBaseline(
  prList: PrListItem[],
  priorSessionCountByName: Map<string, number>
): BaselineSplit {
  const celebrate: PrListItem[] = [];
  const establishingBaseline: PrListItem[] = [];
  for (const pr of prList) {
    const priorCount = priorSessionCountByName.get(pr.name) ?? 0;
    if (isEstablishingBaseline(priorCount)) {
      establishingBaseline.push(pr);
    } else {
      celebrate.push(pr);
    }
  }
  return { celebrate, establishingBaseline };
}
