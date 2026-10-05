// Several programs can be active for one client at once. This is the pure
// part of deciding what the athlete sees on a given day: one card per program
// that has something to do (or was just done), in the coach's order.

export type ProgramTodayKind =
  | "ready" // something to start now (today's workout, or an unlogged one that is due)
  | "done_today" // today's scheduled workout is already logged
  | "locked" // the next workout isn't due yet
  | "all_done" // every workout in the program is logged
  | "empty"; // the program has no workouts

export interface ProgramToday {
  programId: string;
  name: string;
  label: string | null;
  sortOrder: number | null;
  createdAt: string;
  kind: ProgramTodayKind;
  workoutId: string | null;
  title: string | null;
  unlocksOn: Date | null;
  // Set when today's workout is already logged: what would come next for this program if the
  // athlete wants to keep going (the rolling next-unlogged pick, held back until its date).
  after?: { kind: "ready" | "locked"; workoutId: string; unlocksOn: Date | null } | null;
}

export interface DaySessionCard {
  programId: string;
  // What the athlete sees as the card's heading: the coach's label if set, else the program name.
  heading: string;
  status: "ready" | "done";
  workoutId: string;
  title: string;
}

export type StackFallback =
  | { status: "locked"; unlocksOn: Date; workoutId: string }
  | { status: "done" }
  | { status: "no-program" };

export function compareProgramOrder(
  a: { sortOrder: number | null; createdAt: string },
  b: { sortOrder: number | null; createdAt: string }
): number {
  const aHas = a.sortOrder != null;
  const bHas = b.sortOrder != null;
  if (aHas && bHas && a.sortOrder !== b.sortOrder) return (a.sortOrder as number) - (b.sortOrder as number);
  if (aHas !== bHas) return aHas ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function programHeading(p: { name: string; label: string | null }): string {
  return p.label && p.label.trim() ? p.label.trim() : p.name;
}

// One card per program that has something ready or just finished today. When
// nothing qualifies, `fallback` says why (the earliest locked workout, all
// done, or no program), which is what the single-program screens always showed.
export function buildSessionStack(perProgram: ProgramToday[]): {
  cards: DaySessionCard[];
  fallback: StackFallback;
} {
  const ordered = [...perProgram].sort(compareProgramOrder);

  const cards: DaySessionCard[] = [];
  for (const p of ordered) {
    if ((p.kind === "ready" || p.kind === "done_today") && p.workoutId) {
      cards.push({
        programId: p.programId,
        heading: programHeading(p),
        status: p.kind === "ready" ? "ready" : "done",
        workoutId: p.workoutId,
        title: p.title ?? "Workout",
      });
    }
  }
  if (cards.length > 0) return { cards, fallback: { status: "done" } };

  const lockedWithDate = ordered
    .filter((p) => p.kind === "locked" && p.unlocksOn && p.workoutId)
    .sort((a, b) => (a.unlocksOn as Date).getTime() - (b.unlocksOn as Date).getTime());
  if (lockedWithDate.length > 0) {
    const first = lockedWithDate[0];
    return {
      cards: [],
      fallback: { status: "locked", unlocksOn: first.unlocksOn as Date, workoutId: first.workoutId as string },
    };
  }

  const anyContent = ordered.some((p) => p.kind !== "empty");
  return { cards: [], fallback: anyContent ? { status: "done" } : { status: "no-program" } };
}
