"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function ClientSlotRow({
  groupWorkoutExerciseId,
  athleteId,
  groupId,
  resolvedExerciseName,
  setsCount,
  isOverridden,
  ladder,
  lastLogged,
}: {
  groupWorkoutExerciseId: string;
  athleteId: string;
  groupId: string;
  resolvedExerciseName: string;
  setsCount: number;
  isOverridden: boolean;
  ladder: { exerciseName: string }[];
  lastLogged: { weight: number; reps: number } | null;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handlePick(exerciseName: string) {
    setBusy(true);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setBusy(false);
      return;
    }

    await supabase.from("athlete_exercise_overrides").upsert(
      {
        group_workout_exercise_id: groupWorkoutExerciseId,
        athlete_id: athleteId,
        group_id: groupId,
        exercise_name: exerciseName,
        created_by: userData.user.id,
      },
      { onConflict: "group_workout_exercise_id,athlete_id" }
    );

    setBusy(false);
    router.refresh();
  }

  async function handleReset() {
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase
      .from("athlete_exercise_overrides")
      .delete()
      .eq("group_workout_exercise_id", groupWorkoutExerciseId)
      .eq("athlete_id", athleteId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <p className="font-body font-medium text-[15px]">
          {resolvedExerciseName}
          {isOverridden && (
            <span className="font-body text-[11px] text-rust ml-2 align-middle">customized</span>
          )}
        </p>
        {isOverridden && (
          <button
            type="button"
            onClick={handleReset}
            disabled={busy}
            className="font-body text-xs text-steel active:text-rust transition-colors"
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="font-body text-xs text-steel mt-0.5">
        {setsCount} {setsCount === 1 ? "set" : "sets"} (same scheme as the template)
      </p>
      {lastLogged && (
        <p className="font-body text-xs text-steel mt-0.5">
          Last logged: {lastLogged.weight} &times; {lastLogged.reps}
        </p>
      )}

      {ladder.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {ladder.map((rung) => (
            <button
              key={rung.exerciseName}
              type="button"
              onClick={() => handlePick(rung.exerciseName)}
              disabled={busy || rung.exerciseName === resolvedExerciseName}
              className={`h-8 px-3 border font-body text-xs transition-colors ${
                rung.exerciseName === resolvedExerciseName
                  ? "bg-rust border-rust text-graphite"
                  : "border-steel/30 text-steel active:border-rust active:text-rust"
              }`}
            >
              {rung.exerciseName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
