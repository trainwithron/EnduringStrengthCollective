// "% of max" (Ron, Nov 20, wave 2 T3): a set prescribed as a percent of the athlete's max. Each athlete's own weight is the percent of their training max for that lift (the
// coach's locked tested max when there is one, else the estimate from logged sets; both live in athlete_training_maxes), rounded to the nearest plate step. No max yet: no
// number, and the set says the percent.

// Weights are stored in pounds; the nearest 5 lb is what a bar can be loaded to with the usual plates.
export const PLATE_STEP_LB = 5;

/** The coach's typed weight cell: "75%" is a percent of max, a plain number a fixed weight, empty clears both. Null when it is neither (left to the field's own check). */
export function parseWeightCell(raw: string): { pct: number | null; weight: number | null } | null {
  const text = raw.trim();
  if (text === "") return { pct: null, weight: null };
  const pct = text.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (pct) {
    const n = Number(pct[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 150) return null;
    return { pct: Math.round(n * 10) / 10, weight: null };
  }
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return { pct: null, weight: n };
}

/** The athlete's own weight for a percent: the max times the percent, to the nearest plate step. Null without a max. */
export function weightFromPct(pct: number | null | undefined, max: number | null | undefined, step: number = PLATE_STEP_LB): number | null {
  if (pct == null || max == null || !(pct > 0) || !(max > 0)) return null;
  return Math.round(((max * pct) / 100) / step) * step;
}

/** "75%" as the coach's builder and the printed sheet write it. */
export function pctText(pct: number): string {
  return `${Number(pct.toFixed(1))}%`;
}

/** The athlete's training maxes by lowercased lift name (the way exercises are matched elsewhere). */
export function maxByLift(rows: { exercise_name: string; estimated_max: number | string | null }[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    const n = Number(r.estimated_max);
    if (Number.isFinite(n) && n > 0) out.set(r.exercise_name.trim().toLowerCase(), n);
  }
  return out;
}

/** The weight a set shows an athlete: the coach's fixed weight when there is one, else their own weight from the percent. */
export function setWeightFor(set: { targetWeight: number | null; targetPctMax?: number | null }, exerciseName: string, maxes: Map<string, number>): number | null {
  if (set.targetWeight != null) return set.targetWeight;
  return weightFromPct(set.targetPctMax ?? null, maxes.get(exerciseName.trim().toLowerCase()) ?? null);
}
