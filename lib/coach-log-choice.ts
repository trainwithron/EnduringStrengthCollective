import type { DaySessionCard } from "@/lib/session-stack";

// The coach's "Log a workout" entry for a client opens on a SMALL choice, never straight into a day (that made a loop and hid the rest of the program): one card per active program, with
// "Start [Day]'s workout" when something is due today and "View whole program" always. Pure, so it is tested.

// "Tuesday", on the coach's clock.
export function weekdayName(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(at);
}

export function startLabel(weekday: string): string {
  return `Start ${weekday}'s workout`;
}

export const PICK_LABEL = "Pick a workout";
export const VIEW_PROGRAM_LABEL = "View whole program";

export interface ChoiceProgram {
  programId: string;
  name: string;
  label: string | null;
}

export interface LogChoice {
  programId: string;
  heading: string;
  // start: something due today; done: today's is logged; pick: nothing due today, choose from the program.
  kind: "start" | "done" | "pick";
  workoutId: string | null;
  title: string | null;
  exerciseCount: number;
}

export function buildLogChoices(programs: ChoiceProgram[], cards: DaySessionCard[], exerciseCountByWorkout: Record<string, number>): LogChoice[] {
  return programs.map((p) => {
    const heading = p.label?.trim() || p.name;
    const ready = cards.find((c) => c.programId === p.programId && c.status === "ready");
    if (ready) return { programId: p.programId, heading, kind: "start" as const, workoutId: ready.workoutId, title: ready.title, exerciseCount: exerciseCountByWorkout[ready.workoutId] ?? 0 };
    const done = cards.find((c) => c.programId === p.programId && c.status === "done");
    if (done) return { programId: p.programId, heading, kind: "done" as const, workoutId: done.workoutId, title: done.title, exerciseCount: exerciseCountByWorkout[done.workoutId] ?? 0 };
    return { programId: p.programId, heading, kind: "pick" as const, workoutId: null, title: null, exerciseCount: 0 };
  });
}

export function exerciseCountLine(n: number): string {
  return `${n} ${n === 1 ? "exercise" : "exercises"}`;
}
