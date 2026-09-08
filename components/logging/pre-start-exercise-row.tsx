"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatCondensedSets } from "@/lib/exercise-fields";
import type { WorkoutOverviewExercise } from "@/lib/workout-overview-data";

export function PreStartExerciseRow({
  exercise,
  athleteId,
  groupId,
  videoUrl,
  lastTime,
  goal,
}: {
  exercise: WorkoutOverviewExercise;
  athleteId: string;
  groupId: string;
  videoUrl?: string;
  lastTime?: { weight: number; reps: number };
  goal?: { weight: number | null; reps: number | null };
}) {
  const [swapping, setSwapping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSwap(name: string) {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: upsertError } = await supabase.from("athlete_exercise_overrides").upsert(
      {
        group_workout_exercise_id: exercise.id,
        athlete_id: athleteId,
        group_id: groupId,
        exercise_name: name,
        created_by: athleteId,
      },
      { onConflict: "group_workout_exercise_id,athlete_id" }
    );
    setBusy(false);
    if (upsertError) {
      setError("Couldn't swap — check your connection and try again.");
      return;
    }
    setSwapping(false);
    router.refresh();
  }

  const summary = formatCondensedSets(exercise.sets, exercise.trackedFields);

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body font-medium text-[15px] truncate">
            {exercise.exerciseName}{" "}
            <span className="font-body text-steel font-normal">{summary}</span>
          </p>
          {exercise.notes && (
            <p className="font-body text-xs text-steel mt-0.5">{exercise.notes}</p>
          )}
          {exercise.isOverridden && (
            <p className="font-body text-[11px] text-steel mt-0.5">customized for you</p>
          )}
          {lastTime && (
            <p className="font-body text-[11px] text-steel mt-0.5">
              Last: {lastTime.weight}&times;{lastTime.reps}
            </p>
          )}
          {goal && (goal.weight != null || goal.reps != null) && (
            <p className="font-body text-[11px] text-rust mt-0.5">
              Goal: {goal.weight != null ? `${goal.weight} lbs` : ""}
              {goal.weight != null && goal.reps != null ? " × " : ""}
              {goal.reps != null ? `${goal.reps} reps` : ""}
            </p>
          )}
        </div>
        {exercise.ladder.length > 0 && (
          <button
            type="button"
            onClick={() => setSwapping((v) => !v)}
            className="shrink-0 font-body text-xs text-steel active:text-rust transition-colors"
          >
            Swap Exercise
          </button>
        )}
      </div>

      {videoUrl && (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-body text-xs text-rust inline-block mt-1"
        >
          Watch demo &rarr;
        </a>
      )}

      {swapping && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {exercise.ladder.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleSwap(name)}
              disabled={busy}
              className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
            >
              {busy ? "Swapping…" : name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
