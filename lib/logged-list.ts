// The "Logged workouts" list on a client's profile: the workouts the client logged, and past history that was imported, in date order (newest first). Imported rows are plain history: they are listed and
// marked Imported, but they have no workout log, so they never count in the Workouts, Volume or PRs numbers.

export interface LoggedItem<L> {
  key: string;
  date: string;
  log: L | null;
  imported: { id: string; exercises: number } | null;
}

export function mergeLoggedList<L extends { id: string; created_at: string }>(
  logs: L[],
  imported: { id: string; started_at: string; exercises: number }[],
  limit: number
): LoggedItem<L>[] {
  const items: LoggedItem<L>[] = [
    ...logs.map((log) => ({ key: log.id, date: log.created_at, log, imported: null })),
    ...imported.map((s) => ({ key: s.id, date: s.started_at, log: null, imported: { id: s.id, exercises: s.exercises } })),
  ];
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, limit);
}
