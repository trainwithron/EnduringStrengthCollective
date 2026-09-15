"use client";

import type { SessionExerciseEntry } from "@/lib/types";

// coach_mobile_v2_feature_spec.md item 4 — built once here, shared above
// both swipe-carousel variants (horizontal and vertical), which only
// need to report their own activeIndex up via onActiveIndexChange rather
// than each re-implementing this. "Just finished" replaces the old
// behavior where advancing past a completed exercise just made it
// disappear; the next-exercise preview is genuinely new (both carousels
// only ever showed "Exercise i of n," no upcoming name/summary). A
// video-clip preview was floated in the same conversation and explicitly
// deferred — no exercise video content ships yet.
function lastCompletedSetSummary(exercise: SessionExerciseEntry): string | null {
  const completed = exercise.sets.filter((s) => s.status === "completed");
  if (completed.length === 0) return null;
  const last = completed[completed.length - 1];
  const setCount = completed.length;

  if (exercise.trackedFields.includes("reps") && last.reps) {
    const weightPart =
      exercise.trackedFields.includes("weight") && last.weight != null ? ` @ ${last.weight}lb` : "";
    return `${setCount}×${last.reps}${weightPart}`;
  }
  if (exercise.trackedFields.includes("time") && last.timeSeconds != null) {
    return `${setCount}×${last.timeSeconds}s`;
  }
  if (exercise.trackedFields.includes("distance") && last.distance != null) {
    return `${setCount}×${last.distance}`;
  }
  if (exercise.trackedFields.includes("height") && last.height != null) {
    return `${setCount}×${last.height}`;
  }
  return `${setCount} ${setCount === 1 ? "set" : "sets"}`;
}

export function SessionProgressStrip({
  exercises,
  activeIndex,
}: {
  exercises: SessionExerciseEntry[];
  activeIndex: number;
}) {
  const previous = exercises[activeIndex - 1] ?? null;
  const next = exercises[activeIndex + 1] ?? null;
  const previousSummary = previous ? lastCompletedSetSummary(previous) : null;

  if (!previousSummary && !next) return null;

  return (
    <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 border border-steel/20 bg-surface/20">
      {previousSummary ? (
        <p className="font-body text-xs text-steel truncate min-w-0">
          <span className="text-chalk">{previous!.exerciseName}</span> — {previousSummary}
        </p>
      ) : (
        <span />
      )}
      {next && (
        <p className="font-body text-xs text-steel shrink-0 flex items-center gap-1">
          Next: <span className="text-chalk">{next.exerciseName}</span> →
        </p>
      )}
    </div>
  );
}
