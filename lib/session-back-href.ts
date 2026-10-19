// Where Back goes from a session page. A coach logging for a client (coach mode) returns to that client's log overview, the day the session belongs to, still inside coach mode. Everyone else keeps the group's
// workout page, as before. (Oct 19 audit: from a finished or paused coach-logged session Back opened the group's workout page, which for most one-on-one clients says "This workout isn't available", and
// its Go to Home left coach mode.)
export function sessionBackHref(opts: { groupId: string; athleteId: string; workoutId: string | null; coachMode: boolean }): string {
  if (opts.coachMode) {
    const base = `/groups/${opts.groupId}/athletes/${opts.athleteId}/log`;
    return opts.workoutId ? `${base}/${opts.workoutId}` : base;
  }
  return opts.workoutId ? `/groups/${opts.groupId}/workouts/${opts.workoutId}` : `/groups/${opts.groupId}`;
}
