import {
  orderTrackedFields,
  TARGET_PROP,
  fieldDef,
  type TrackedField,
} from "@/lib/exercise-fields";
import type { ExerciseSetTarget } from "@/lib/types";

export interface DisplayExercise {
  id: string;
  exerciseName: string;
  exerciseOrder: number;
  trackedFields: TrackedField[];
  sets: ExerciseSetTarget[];
}

function formatFieldValue(field: TrackedField, value: number | string): string {
  if (field === "weight") return `${value} lb`;
  if (field === "time") return `${value}s`;
  if (field === "rest") return `${value}s rest`;
  if (field === "reps") return `${value} reps`;
  return `${value} ${fieldDef(field).label}`;
}

function formatSetTarget(set: ExerciseSetTarget, trackedFields: TrackedField[]): string {
  const parts: string[] = [];
  for (const field of orderTrackedFields(trackedFields)) {
    const value = (set as any)[TARGET_PROP[field]];
    if (value == null || value === "") continue;
    parts.push(formatFieldValue(field, value));
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// Run-length encodes consecutive sets with identical formatted targets
// into one line ("3 × 185 lb · 8 reps") instead of one row per set —
// the common case (a uniform prescription) stays a single clean line on
// a big screen, while a genuinely varied prescription (a progression
// table) still shows each distinct block in order.
function groupSets(sets: ExerciseSetTarget[], trackedFields: TrackedField[]) {
  const groups: { count: number; label: string }[] = [];
  for (const set of sets) {
    const label = formatSetTarget(set, trackedFields);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ count: 1, label });
  }
  return groups;
}

export function DisplayWorkoutPanel({
  workoutTitle,
  exercises,
}: {
  workoutTitle: string;
  exercises: DisplayExercise[];
}) {
  return (
    <div>
      <h2 className="font-display uppercase text-2xl tracking-wide text-chalk mb-6">
        {workoutTitle}
      </h2>

      {exercises.length === 0 ? (
        <p className="font-body text-lg text-steel">No exercises in this workout.</p>
      ) : (
        <div className="space-y-6">
          {exercises
            .slice()
            .sort((a, b) => a.exerciseOrder - b.exerciseOrder)
            .map((exercise) => (
              <div key={exercise.id} className="border-b border-steel/15 pb-5 last:border-b-0">
                <p className="font-display text-xl text-chalk mb-1.5">{exercise.exerciseName}</p>
                <div className="space-y-0.5">
                  {groupSets(exercise.sets, exercise.trackedFields).map((g, i) => (
                    <p key={i} className="font-body text-base text-steel">
                      {g.count > 1 ? `${g.count} × ` : ""}
                      {g.label}
                    </p>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
