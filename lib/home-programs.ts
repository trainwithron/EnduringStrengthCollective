import { pickUpWhereLeftOff, pickupLabel, type Pickup, type PickupWorkout } from "./program-pickup";

// The "Your programs" block on a client's Home: one card per active program, with how far along they are and where they pick up ("Week 2, Day 3": the workout right after the one they did last, see lib/program-pickup.ts).
// Pure, so it is tested with real shapes: programs with no dates, a program with nothing in it yet, a skipped day, a finished program, and two programs at once.
export interface HomeProgramInput {
  id: string;
  name: string;
  created_at?: string | null;
}
export interface HomeWorkoutInput extends PickupWorkout {
  program_id: string;
}
export interface HomeProgramCard {
  id: string;
  name: string;
  total: number;
  done: number;
  /** "Week 2, Day 3" (right after the one done last), "Program complete", or "Nothing in it yet" */
  upNext: string;
}

const byAge = (a: HomeProgramInput, b: HomeProgramInput) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.name.localeCompare(b.name);

function groupByProgram(workouts: HomeWorkoutInput[]): Map<string, HomeWorkoutInput[]> {
  const byProgram = new Map<string, HomeWorkoutInput[]>();
  for (const w of workouts) {
    const list = byProgram.get(w.program_id) ?? [];
    list.push(w);
    byProgram.set(w.program_id, list);
  }
  return byProgram;
}

/** Where each program picks up, by program id. */
export function programPickups(programs: HomeProgramInput[], workouts: HomeWorkoutInput[], doneAt: ReadonlyMap<string, string>): Map<string, Pickup> {
  const byProgram = groupByProgram(workouts);
  return new Map(programs.map((p) => [p.id, pickUpWhereLeftOff(byProgram.get(p.id) ?? [], doneAt)]));
}

export function homeProgramCards(programs: HomeProgramInput[], workouts: HomeWorkoutInput[], doneAt: ReadonlyMap<string, string>): HomeProgramCard[] {
  const byProgram = groupByProgram(workouts);
  return [...programs].sort(byAge).map((p) => {
    const list = byProgram.get(p.id) ?? [];
    const done = list.filter((w) => doneAt.has(w.id)).length;
    return { id: p.id, name: p.name, total: list.length, done, upNext: pickupLabel(pickUpWhereLeftOff(list, doneAt)) };
  });
}
