// The "Your programs" block on a client's Home: one card per active program, with how far along they are and where they are up to ("Week 2, Day 3"). Pure, so it is tested with real shapes: programs with no dates,
// a program with nothing in it yet, a week that is skipped, and two programs at once.
export interface HomeProgramInput {
  id: string;
  name: string;
  created_at?: string | null;
}
export interface HomeWorkoutInput {
  id: string;
  program_id: string;
  week_number: number | null;
  day_index: number | null;
}
export interface HomeProgramCard {
  id: string;
  name: string;
  total: number;
  done: number;
  /** "Week 2, Day 3" (the first workout not finished yet, by order), "All done", or "Nothing in it yet" */
  upNext: string;
}

export function homeProgramCards(programs: HomeProgramInput[], workouts: HomeWorkoutInput[], doneWorkoutIds: ReadonlySet<string>): HomeProgramCard[] {
  const byProgram = new Map<string, HomeWorkoutInput[]>();
  for (const w of workouts) {
    const list = byProgram.get(w.program_id) ?? [];
    list.push(w);
    byProgram.set(w.program_id, list);
  }
  const ordered = [...programs].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.name.localeCompare(b.name));
  return ordered.map((p) => {
    const list = (byProgram.get(p.id) ?? []).slice().sort((a, b) => (a.week_number ?? 1) - (b.week_number ?? 1) || (a.day_index ?? 0) - (b.day_index ?? 0));
    const done = list.filter((w) => doneWorkoutIds.has(w.id)).length;
    const next = list.find((w) => !doneWorkoutIds.has(w.id));
    const upNext = list.length === 0 ? "Nothing in it yet" : !next ? "All done" : `Week ${next.week_number ?? 1}, Day ${next.day_index ?? 1}`;
    return { id: p.id, name: p.name, total: list.length, done, upNext };
  });
}
