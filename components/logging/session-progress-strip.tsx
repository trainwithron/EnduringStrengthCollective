"use client";

import type { SessionExerciseEntry } from "@/lib/types";
import type { WeightUnit } from "@/lib/units";
import { formatLift } from "@/lib/lift-weight";
import { useLiftUnit } from "./lift-unit-context";

// coach_mobile_v2_feature_spec.md item 4 — built once here, shared above
// both swipe-carousel variants (horizontal and vertical), which only
// need to report their own activeIndex up via onActiveIndexChange rather
// than each re-implementing this. "Just finished" replaces the old
// behavior where advancing past a completed exercise just made it
// disappear; the next-exercise preview is genuinely new (both carousels
// only ever showed "Exercise i of n," no upcoming name/summary). A
// video-clip preview was floated in the same conversation and explicitly
// deferred — no exercise video content ships yet.
function lastCompletedSetSummary(exercise: SessionExerciseEntry, unit: WeightUnit): string | null {
  const completed = exercise.sets.filter((s) => s.status === "completed");
  if (completed.length === 0) return null;
  const last = completed[completed.length - 1];
  const setCount = completed.length;

  if (exercise.trackedFields.includes("reps") && last.reps) {
    const weightPart =
      exercise.trackedFields.includes("weight") && last.weight != null ? ` @ ${formatLift(last.weight, unit)}` : "";
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
  const unit = useLiftUnit();
  const previous = exercises[activeIndex - 1] ?? null;
  const previousSummary = previous ? lastCompletedSetSummary(previous, unit) : null;

  // What was just done ("Bench Press — 3×8 @ 135 lb"). Next is on the bottom bar now (Look Refresh, client step), so this is only the look back.
  if (!previousSummary) return null;

  return (
    <div className="flex items-center gap-3 mb-2 px-3 py-1.5 rounded-row bg-surface/60 overflow-hidden [@media(max-height:760px)]:hidden">
      <p className="font-body text-xs text-steel truncate min-w-0">
        <span className="text-chalk">{previous!.exerciseName}</span> — {previousSummary}
      </p>
    </div>
  );
}
