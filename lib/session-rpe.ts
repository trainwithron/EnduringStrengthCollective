// Foster's session-RPE training-load model: perceived effort (1-10) times
// session duration in minutes gives an arbitrary-unit "load" that's
// comparable across totally different session types (a short, brutal
// interval session and a long, easy one can land at a similar number).
export function computeSessionLoad(sessionRpe: number, durationSeconds: number): number {
  return Math.round(sessionRpe * (durationSeconds / 60));
}

export function computeAverageSessionRpe(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface WeeklyLoadBucket {
  weekLabel: string; // "Sep 1"
  load: number;
}

export interface SessionLoadRow {
  sessionRpe: number;
  durationSeconds: number;
  createdAtDateKey: string; // "YYYY-MM-DD"
}

// Same zero-filled, oldest-to-newest, Sunday-anchored weekly bucketing as
// computeWeeklyActivity (lib/team-performance-metrics.ts) — kept as its own
// function here rather than imported, since that one counts workouts while
// this one sums a computed load value per row.
export function computeWeeklyTrainingLoad(
  rows: SessionLoadRow[],
  asOfDateKey: string,
  weeksBack: number
): WeeklyLoadBucket[] {
  const asOf = new Date(`${asOfDateKey}T00:00:00`);
  const asOfWeekStart = new Date(asOf);
  asOfWeekStart.setDate(asOf.getDate() - asOf.getDay());

  const buckets: WeeklyLoadBucket[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const weekStart = new Date(asOfWeekStart);
    weekStart.setDate(asOfWeekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const load = rows
      .filter((r) => {
        const d = new Date(`${r.createdAtDateKey}T00:00:00`);
        return d.getTime() >= weekStart.getTime() && d.getTime() < weekEnd.getTime();
      })
      .reduce((sum, r) => sum + computeSessionLoad(r.sessionRpe, r.durationSeconds), 0);
    buckets.push({ weekLabel: label, load });
  }
  return buckets;
}
