import type { DayWorkoutInfo } from "./athlete-day-schedule";

// Whether the Today card itself links the client's one program (its name under the workout title, CL5, Nov 21). It does only on the card that shows a single workout to do or view:
// not when everything today is done ("Done for today"), not with two or more programs' workouts on the day, and not on a rest, unscheduled or no-program day. When it does not,
// Home shows the "Your program" card instead, so a one-program client always has a way into their program (part A review, Nov 21). Mirrors the branches of the Today card in
// components/athlete/day-card.tsx.
export function todayCardLinksProgram(
  workout: Pick<DayWorkoutInfo, "status" | "workoutId">,
  sessions: readonly Pick<DayWorkoutInfo, "status" | "workoutId">[],
  isToday: boolean
): boolean {
  const finished = sessions.length > 0 ? sessions : workout.workoutId ? [workout] : [];
  if (isToday && finished.length > 0 && finished.every((x) => x.status === "done")) return false;
  if (sessions.length > 1) return false;
  const shown = sessions.length === 1 ? sessions[0] : workout;
  return shown.status !== "no-program" && shown.status !== "unscheduled" && shown.status !== "rest";
}

/** "Your program(s)" under the Today card: always with two or more programs; with one, only when the Today card does not already link it. */
export function showProgramsBlock(programCount: number, workout: Pick<DayWorkoutInfo, "status" | "workoutId">, sessions: readonly Pick<DayWorkoutInfo, "status" | "workoutId">[], isToday: boolean): boolean {
  if (programCount > 1) return true;
  return programCount === 1 && !todayCardLinksProgram(workout, sessions, isToday);
}
