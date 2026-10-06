"use client";

import { findDemo, type DemoRow } from "@/lib/exercise-demo";
import type { SessionExerciseEntry } from "@/lib/types";
import { DemoSheet } from "./demo-sheet";

// One demo sheet for the whole workout: shows the chosen exercise's demo and steps to the previous or next exercise without closing. Remounts the player for
// each exercise (the key) so the last video never keeps playing.
export function DemoBrowserSheet({
  exercises,
  library,
  currentId,
  onChange,
  onClose,
}: {
  exercises: SessionExerciseEntry[];
  library: DemoRow[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  const index = exercises.findIndex((e) => e.id === currentId);
  if (index < 0) return null;
  const ex = exercises[index];
  const demo = findDemo(library, ex.exerciseName);
  const neighbour = (e: SessionExerciseEntry | undefined) =>
    e ? { name: e.exerciseName || "Exercise", youtubeUrl: findDemo(library, e.exerciseName)?.youtubeUrl ?? null } : null;
  const equipment = ex.equipmentType ? String(ex.equipmentType).replace(/_/g, " ") : null;
  return (
    <DemoSheet
      key={ex.id}
      title={ex.exerciseName || "Exercise"}
      youtubeUrl={demo?.youtubeUrl ?? null}
      videoPath={demo?.videoPath ?? null}
      credit={demo && demo.foundAs.trim().toLowerCase() !== ex.exerciseName.trim().toLowerCase() ? demo.foundAs : null}
      details={{ notes: ex.notes ?? null, equipment }}
      nav={{
        index,
        total: exercises.length,
        prev: neighbour(exercises[index - 1]),
        next: neighbour(exercises[index + 1]),
        onPrev: () => index > 0 && onChange(exercises[index - 1].id),
        onNext: () => index < exercises.length - 1 && onChange(exercises[index + 1].id),
      }}
      onClose={onClose}
    />
  );
}
