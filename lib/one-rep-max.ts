// Epley formula — the most common estimated-1RM formula, accurate enough
// for training-percentage planning without needing a max-effort test.
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return Math.round(weight);
  return Math.round(weight * (1 + reps / 30));
}

export function percentageTable(oneRepMax: number): { pct: number; weight: number }[] {
  return [95, 90, 85, 80, 75, 70, 65, 60].map((pct) => ({
    pct,
    weight: Math.round((oneRepMax * pct) / 100 / 5) * 5,
  }));
}
