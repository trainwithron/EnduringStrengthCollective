import { estimateTrainingMax } from "@/lib/training-max";

// The one estimate used everywhere (lib/training-max.ts): Epley with the reps left in reserve, whole pounds. A set with no RPE counts as RPE 9. Null for a set of more than 8 reps (not reliable).
export function estimateOneRepMax(weight: number, reps: number): number | null {
  const t = estimateTrainingMax(weight, reps, null);
  return t == null ? null : Math.round(t);
}

// Rounded to a loadable weight: 5 lb, or 2.5 kg for someone who lifts in kilograms (audit C17).
export function percentageTable(oneRepMax: number, step = 5): { pct: number; weight: number }[] {
  return [95, 90, 85, 80, 75, 70, 65, 60].map((pct) => ({
    pct,
    weight: Math.round((oneRepMax * pct) / 100 / step) * step,
  }));
}
