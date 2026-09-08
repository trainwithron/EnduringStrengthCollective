"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ExerciseSetTarget } from "@/lib/types";
import type { TrackedField } from "@/lib/exercise-fields";

interface TemplateExercise {
  id: string;
  exerciseName: string;
  exerciseOrder: number;
  movementPatternId?: string | null;
  trackedFields: TrackedField[];
  sets: ExerciseSetTarget[];
  goalWeight?: number | null;
  goalReps?: number | null;
}

// target_reps is free text (ranges like "8-10", tags like "AMRAP") since a
// coach can prescribe those — only coerce it into the numeric `reps` column
// when it's a plain number; otherwise the athlete fills in what they did.
function parseRepsTarget(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function StartWorkoutButton({
  workoutId,
  groupId,
  athleteId,
  exercises,
  loggedByCoach,
}: {
  workoutId: string;
  groupId: string;
  athleteId: string;
  exercises: TemplateExercise[];
  // Set when a coach starts this session on a client's behalf (in-person
  // training) rather than the athlete starting it themselves — carried
  // through to workout_logs on completion so it can be badged in their
  // history instead of silently looking like their own entry.
  loggedByCoach?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const router = useRouter();

  async function handleStart() {
    setStarting(true);
    const supabase = createBrowserClient();

    const { data: session, error: sessionError } = await supabase
      .from("athlete_sessions")
      .insert({
        workout_id: workoutId,
        group_id: groupId,
        athlete_id: athleteId,
        logged_by_coach: loggedByCoach ?? false,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      setStarting(false);
      return;
    }

    // Copy the template into the athlete's own mutable rows — later
    // swaps/additions here never touch group_workout_exercises. Batched
    // into two bulk inserts (one for every exercise, one for every set)
    // instead of two round trips per exercise — a 6-exercise workout was
    // previously 12 sequential requests blocking "Starting…" the whole time.
    const { data: insertedExercises } = await supabase
      .from("session_exercises")
      .insert(
        exercises.map((ex) => ({
          session_id: session.id,
          group_workout_exercise_id: ex.id,
          exercise_name: ex.exerciseName,
          exercise_order: ex.exerciseOrder,
          movement_pattern_id: ex.movementPatternId ?? null,
          tracked_fields: ex.trackedFields,
        }))
      )
      .select("id, group_workout_exercise_id");

    const sessionExerciseIdByTemplateId = new Map(
      (insertedExercises ?? []).map((r) => [r.group_workout_exercise_id, r.id])
    );

    const allSets = exercises.flatMap((ex) => {
      const sessionExerciseId = sessionExerciseIdByTemplateId.get(ex.id);
      if (!sessionExerciseId) return [];

      return ex.sets.length > 0
        ? ex.sets.map((target) => ({
            session_exercise_id: sessionExerciseId,
            set_order: target.setOrder,
            // Per-set targets win; fall back to the progression rule's
            // computed goal (same as before per-set targets existed)
            // whenever the coach left that field blank for this set.
            weight: target.targetWeight ?? ex.goalWeight ?? null,
            reps: parseRepsTarget(target.targetReps) ?? ex.goalReps ?? null,
            rpe: target.targetRpe,
            rir: target.targetRir,
            tempo: target.targetTempo,
            time_seconds: target.targetTimeSeconds,
            height: target.targetHeight,
            distance: target.targetDistance,
          }))
        : [
            {
              session_exercise_id: sessionExerciseId,
              set_order: 0,
              weight: ex.goalWeight ?? null,
              reps: ex.goalReps ?? null,
            },
          ];
    });

    if (allSets.length > 0) {
      await supabase.from("set_logs").insert(allSets);
    }

    router.push(`/sessions/${session.id}`);
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={starting}
      className="w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
    >
      {starting ? "Starting…" : "Start workout"}
    </button>
  );
}
