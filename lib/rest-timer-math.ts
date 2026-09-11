// Pure countdown math for the workout rest timer — kept separate from
// any DOM/timer-interval concerns so it's directly testable.

export function computeRemainingSeconds(
  startedAtMs: number,
  durationSeconds: number,
  nowMs: number
): number {
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  return Math.max(0, Math.ceil(durationSeconds - elapsedSeconds));
}

// "1:30" — same M:SS convention used for both the stopwatch's elapsed
// time and the rest timer's countdown. Kept as its own tiny function
// rather than reusing lib/progression-models.ts's pace-specific
// formatter of the same shape — importing something named
// "formatPaceSecondsToClock" here would read confusingly even though
// the underlying math is identical.
export function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
