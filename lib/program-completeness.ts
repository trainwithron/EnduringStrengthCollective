// "Looks unfinished" on a program card (Ron). Only when a program clearly does not match its own shape: it has workout days, but half or more of them have no exercises in them.
// A program with no days at all (a blank new one) says nothing about its shape, so it is not marked. Nothing is blocked or hidden by this; it is only a prompt to look.
export function looksUnfinished(exerciseCountPerDay: number[]): boolean {
  if (exerciseCountPerDay.length === 0) return false;
  const empty = exerciseCountPerDay.filter((n) => n === 0).length;
  return empty * 2 >= exerciseCountPerDay.length;
}

// The workout days of a program as the programs pages read them: workouts(id, group_workout_exercises(count)).
export function programDayShape(workouts: { group_workout_exercises?: { count: number }[] | null }[] | null | undefined): { workoutCount: number; looksUnfinished: boolean } {
  const days = workouts ?? [];
  return { workoutCount: days.length, looksUnfinished: looksUnfinished(days.map((w) => w.group_workout_exercises?.[0]?.count ?? 0)) };
}
