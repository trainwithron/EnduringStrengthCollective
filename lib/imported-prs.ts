// Imported history counts (release CB). The client profile's totals, graphs and records are read from client_exercise_rollup: one row per workout and exercise, counted sets only (an unclear data point
// is never in it). Imported workouts have no workout log, so they are added to the logged ones here; a record in imported history is worked out IN HINDSIGHT, in date order, silently: it is shown in
// the record list with its own date and never celebrated, posted, shared or notified. Pure, so every rule is tested.

export interface RollupRow {
  sessionId: string;
  at: string; // ISO timestamp
  exerciseName: string;
  bestWeight: number | null;
  bestE1rm: number | null;
  volume: number;
  sets: number;
  imported: boolean; // a history import or a coach-entered past workout
  hasLog: boolean; // a workout log exists for it (a live workout, or an imported one that was promoted)
}

export function parseRollup(rows: any[] | null | undefined): RollupRow[] {
  return (rows ?? []).map((r) => ({
    sessionId: String(r.session_id),
    at: String(r.at),
    exerciseName: String(r.exercise_name),
    bestWeight: r.best_weight == null ? null : Number(r.best_weight),
    bestE1rm: r.best_e1rm == null ? null : Number(r.best_e1rm),
    volume: Number(r.volume ?? 0),
    sets: Number(r.sets ?? 0),
    imported: !!r.imported,
    hasLog: !!r.has_log,
  }));
}

const key = (name: string) => name.trim().toLowerCase();

// An imported workout that has no workout log of its own: the ones the profile adds to its totals.
function countedImports(rows: RollupRow[]): RollupRow[] {
  return rows.filter((r) => r.imported && !r.hasLog);
}

export function importedTotals(rows: RollupRow[]): { workouts: number; volume: number } {
  const imported = countedImports(rows);
  return { workouts: new Set(imported.map((r) => r.sessionId)).size, volume: imported.reduce((sum, r) => sum + r.volume, 0) };
}

export interface HindsightPr {
  exerciseName: string;
  date: string;
  weight: number;
}

// A record in imported history: the heaviest weight in that exercise up to that day, beating everything the client had done before it (live workouts and imports alike, date order, strictly heavier,
// the first time an exercise appears is not a record, a weight of 0 never is). Live workouts keep the records they already celebrated: only imported workouts are looked at here.
export function hindsightPrs(rows: RollupRow[]): HindsightPr[] {
  const ordered = rows.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.sessionId.localeCompare(b.sessionId));
  const best = new Map<string, number>();
  const found: HindsightPr[] = [];
  // Rows of one workout are judged together against what came BEFORE that workout, never against each other.
  const pending: { name: string; weight: number }[] = [];
  let currentSession: string | null = null;
  const settle = () => {
    for (const p of pending) best.set(p.name, Math.max(best.get(p.name) ?? 0, p.weight));
    pending.length = 0;
  };
  for (const row of ordered) {
    if (row.sessionId !== currentSession) {
      settle();
      currentSession = row.sessionId;
    }
    if (row.bestWeight == null || row.bestWeight <= 0) continue;
    const name = key(row.exerciseName);
    const prior = best.get(name);
    if (row.imported && !row.hasLog && prior !== undefined && row.bestWeight > prior) {
      found.push({ exerciseName: row.exerciseName, date: row.at, weight: row.bestWeight });
    }
    pending.push({ name, weight: row.bestWeight });
  }
  settle();
  return found.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// The best weight per day for each exercise, oldest first: the data behind the exercise graph.
export function dailyBestByExercise(rows: RollupRow[]): Record<string, { date: string; value: number }[]> {
  const byExercise = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.bestWeight == null || row.bestWeight <= 0) continue;
    const date = row.at.slice(0, 10);
    const days = byExercise.get(row.exerciseName) ?? new Map<string, number>();
    if (!days.has(date) || row.bestWeight > days.get(date)!) days.set(date, row.bestWeight);
    byExercise.set(row.exerciseName, days);
  }
  const out: Record<string, { date: string; value: number }[]> = {};
  for (const [name, days] of byExercise) {
    out[name] = Array.from(days.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

export const INCLUDES_IMPORTED_TAG = "Includes imported history";
