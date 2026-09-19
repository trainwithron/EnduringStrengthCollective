"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TrackedField } from "@/lib/exercise-fields";

// equipment_qr_decal_scoping_sept19.md — the "logged-in existing client"
// fast path. There is no ad-hoc/freeform single-exercise logging
// anywhere else in this app — every session is normally started from a
// workout template (start-workout-button.tsx). Reuses
// athlete_sessions.workout_id's existing nullable-ness (already proven
// safe by the history-preservation migration, 0035) to create a
// one-exercise session with no template behind it at all, then drops
// the athlete straight into the same session logger every other
// workout uses — no new logging UI needed.
export function QrQuickLogStart({
  athleteId,
  groupId,
  exerciseName,
  movementPatternId,
  trackedFields,
}: {
  athleteId: string;
  groupId: string;
  exerciseName: string;
  movementPatternId: string | null;
  trackedFields: TrackedField[];
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleStart() {
    setStarting(true);
    setError(null);
    const supabase = createBrowserClient();

    const { data: session, error: sessionError } = await supabase
      .from("athlete_sessions")
      .insert({
        workout_id: null,
        group_id: groupId,
        athlete_id: athleteId,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      setStarting(false);
      setError("Couldn't start logging — check your connection and try again.");
      return;
    }

    const { data: insertedExercise } = await supabase
      .from("session_exercises")
      .insert({
        session_id: session.id,
        group_workout_exercise_id: null,
        exercise_name: exerciseName,
        exercise_order: 0,
        movement_pattern_id: movementPatternId,
        tracked_fields: trackedFields,
      })
      .select("id")
      .single();

    if (insertedExercise) {
      await supabase.from("set_logs").insert(
        [0, 1, 2].map((setOrder) => ({
          session_exercise_id: insertedExercise.id,
          set_order: setOrder,
          weight: null,
          reps: null,
        }))
      );
    }

    router.push(`/sessions/${session.id}`);
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="font-body text-xs text-rust mb-2 text-center" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        className="w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {starting ? "Starting…" : `Log ${exerciseName}`}
      </button>
    </div>
  );
}
