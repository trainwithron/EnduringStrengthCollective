// The workout timer counts from the session's start. A paused workout is not being worked, so when it is resumed the start is moved forward by the time it sat paused: the timer carries on from where the
// work stopped (the last set he completed) instead of counting the hours in between. Pure, so it is tested.
export function resumedStartedAt(startedAt: string, lastActivityAt: string | null, now: Date): string {
  const start = new Date(startedAt).getTime();
  const last = lastActivityAt ? new Date(lastActivityAt).getTime() : start;
  const worked = Math.max(0, Math.min(last, now.getTime()) - start);
  return new Date(now.getTime() - worked).toISOString();
}
