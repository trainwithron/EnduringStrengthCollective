// The numbers on a program's card on a client's profile. A number with nothing behind it is left out, never shown as 0.
export function programCardStats(
  workouts: { id: string; week_number: number | null }[],
  logs: { workout_id: string; created_at: string }[],
  timeZone?: string
): { value: string; label: string }[] {
  if (workouts.length === 0) return [];
  const ids = new Set(workouts.map((w) => w.id));
  const mine = logs.filter((l) => ids.has(l.workout_id));
  const done = new Set(mine.map((l) => l.workout_id)).size;
  const weeks = Math.max(0, ...workouts.map((w) => w.week_number ?? 0));
  const stats: { value: string; label: string }[] = [];
  if (weeks > 0) stats.push({ value: String(weeks), label: weeks === 1 ? "Week" : "Weeks" });
  stats.push({ value: `${done} of ${workouts.length}`, label: "Workouts done" });
  if (mine.length > 0) {
    const last = mine.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at;
    stats.push({ value: new Date(last).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone }), label: "Last workout" });
  }
  return stats;
}
