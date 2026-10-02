// Strength Meet Week Taper (goal_date_aware_nutrition_and_programming_
// idea.md) — the structural analog of the existing Endurance Race
// Taper (lib/endurance-taper.ts): a read-only, advisory recommendation
// the coach applies by hand, never a program-mutating engine. Confirmed
// before building this that the endurance feature doesn't actually
// write to or scale any program/workout row either — "same engine,
// different parameter profile" really means "same kind of advisory
// display," not a shared write-path, since no such write-path exists
// for either sport.
//
// Deliberately narrow, per the research's own scope: never touches
// anything more than ~2 weeks out — everything earlier stays the
// coach's own hand-authored program untouched. The overreach week
// (a week of intentionally harder-than-normal loading right before the
// taper begins) needs real logged-history gating and a per-client
// opt-in; explicitly deferred, not part of this pass.
//
// Boundary choice, stated plainly since the research described these
// two phases by rough day-ranges rather than exact cutoffs: t-1 covers
// 7-14 days out (the description's own "~7-10 days out," stretched to
// the stated 2-week outer bound so there's no silent gap between
// "more than 2 weeks" and "exactly 10 days"); t-0 covers 0-6 days out
// (meet week itself, a 7-day window ending on the meet date). Revisit
// this exact split if it doesn't match how a real meet week actually
// gets scheduled once this ships.
export type StrengthTaperLabel = "t-1" | "t-0";

export interface StrengthTaperWeek {
  label: StrengthTaperLabel;
  daysUntilMeet: number;
  volumeLoadPctRange: [number, number]; // apply to the coach's most recently authored week's overall volume-load
  heavySinglePct: number | null; // % of the main lift's current training max for one real heavy single this week; null = no new heavy single (meet week itself — opener-weight practice only)
  guidance: string;
}

const T1_VOLUME_LOAD_RANGE: [number, number] = [45, 55]; // "~50%"
const T1_HEAVY_SINGLE_PCT = 92.5; // midpoint of the stated 90-95% range
const T0_VOLUME_LOAD_RANGE: [number, number] = [30, 50];

// null when more than 2 weeks out (not in the taper window at all) or
// once the meet date has passed.
export function computeStrengthTaperWeek(daysUntilMeet: number): StrengthTaperWeek | null {
  if (daysUntilMeet < 0 || daysUntilMeet > 14) return null;

  if (daysUntilMeet <= 6) {
    return {
      label: "t-0",
      daysUntilMeet,
      volumeLoadPctRange: T0_VOLUME_LOAD_RANGE,
      heavySinglePct: null,
      guidance:
        "Meet week: cut to 30-50% volume-load, assistance work to zero. Competition-lift practice only, at opener weights — no new PRs attempted.",
    };
  }

  return {
    label: "t-1",
    daysUntilMeet,
    volumeLoadPctRange: T1_VOLUME_LOAD_RANGE,
    heavySinglePct: T1_HEAVY_SINGLE_PCT,
    guidance:
      "~7-10 days out: scale the most recently authored week down to about 50% volume-load, and keep one real heavy single around 90-95% of the current training max.",
  };
}

// Plate-rounded heavy-single weight for display — same 2.5 lb rounding
// convention already used throughout this app's other percent-of-max
// calculators (GZCLP, the 1RM percentage table).
export function computeHeavySingleWeight(trainingMax: number, heavySinglePct: number): number {
  return Math.round((trainingMax * heavySinglePct) / 100 / 2.5) * 2.5;
}
