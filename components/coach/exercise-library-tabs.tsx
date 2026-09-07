"use client";

import { useState } from "react";
import { ExerciseLibraryList, type LibraryExerciseRow } from "./exercise-library-list";
import { MovementPatternList } from "./movement-pattern-list";
import { NewMovementPatternForm } from "./new-movement-pattern-form";
import type { MovementPlane } from "./movement-pattern-row";

interface PatternWithLadder {
  id: string;
  name: string;
  plane: MovementPlane;
  ladder: { key: string; exerciseName: string; tier: "A" | "B" | "C" | null }[];
}

const TABS = ["exercises", "patterns"] as const;
type Tab = (typeof TABS)[number];

export function ExerciseLibraryTabs({
  coachId,
  initialExercises,
  initialPatterns,
  exerciseLibrary,
}: {
  coachId: string;
  initialExercises: LibraryExerciseRow[];
  initialPatterns: PatternWithLadder[];
  exerciseLibrary: string[];
}) {
  const [tab, setTab] = useState<Tab>("exercises");

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-steel/20 mb-6">
        <button
          type="button"
          onClick={() => setTab("exercises")}
          className={`h-10 px-4 font-body text-sm border-b-2 transition-colors ${
            tab === "exercises"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          All Exercises
        </button>
        <button
          type="button"
          onClick={() => setTab("patterns")}
          className={`h-10 px-4 font-body text-sm border-b-2 transition-colors ${
            tab === "patterns"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          Movement Patterns
        </button>
      </div>

      {tab === "exercises" ? (
        <ExerciseLibraryList coachId={coachId} initialExercises={initialExercises} />
      ) : (
        <div>
          <NewMovementPatternForm />
          {initialPatterns.length > 0 && (
            <div className="mt-6">
              <MovementPatternList initialPatterns={initialPatterns} exerciseLibrary={exerciseLibrary} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
