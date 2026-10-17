"use client";

import { useState } from "react";
import { ExerciseLibraryList, type LibraryExerciseRow } from "./exercise-library-list";
import type { BiomechTagOption, BiomechTagSelection } from "./biomech-tag-picker";
import { MovementPatternList } from "./movement-pattern-list";
import { NewMovementPatternForm } from "./new-movement-pattern-form";
import { AddStarterLaddersButton } from "./add-starter-ladders-button";
import { SortMyExercises } from "./sort-my-exercises";
import type { MovementPlane } from "./movement-pattern-row";
import { OneRepMaxCalculator } from "@/components/tools/one-rep-max-calculator";

interface PatternWithLadder {
  id: string;
  name: string;
  plane: MovementPlane;
  ladder: { key: string; exerciseName: string; tier: "A" | "B" | "C" | null; unilateral?: boolean; rank?: number }[];
}

type Tab = "exercises" | "patterns" | "sort" | "one-rep-max";

export function ExerciseLibraryTabs({
  groupId,
  coachId,
  initialExercises,
  initialPatterns,
  exerciseLibrary,
  biomechVocabulary,
  initialBiomechTagsByExercise,
}: {
  groupId: string;
  coachId: string;
  initialExercises: LibraryExerciseRow[];
  initialPatterns: PatternWithLadder[];
  exerciseLibrary: string[];
  biomechVocabulary: BiomechTagOption[];
  initialBiomechTagsByExercise: Record<string, BiomechTagSelection[]>;
}) {
  const [tab, setTab] = useState<Tab>("exercises");

  return (
    <div>
      {/* Four tabs do not fit a phone's width: the row scrolls sideways instead of pushing the page wider. */}
      <div className="flex items-center gap-1 border-b border-steel/20 mb-6 overflow-x-auto" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "exercises"}
          onClick={() => setTab("exercises")}
          className={`h-11 px-4 shrink-0 whitespace-nowrap font-body text-sm border-b-2 transition-colors ${
            tab === "exercises"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          All Exercises
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "patterns"}
          onClick={() => setTab("patterns")}
          className={`h-11 px-4 shrink-0 whitespace-nowrap font-body text-sm border-b-2 transition-colors ${
            tab === "patterns"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          Movement Patterns
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sort"}
          onClick={() => setTab("sort")}
          className={`h-11 px-4 shrink-0 whitespace-nowrap font-body text-sm border-b-2 transition-colors ${
            tab === "sort"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          Sort my exercises
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "one-rep-max"}
          onClick={() => setTab("one-rep-max")}
          className={`h-11 px-4 shrink-0 whitespace-nowrap font-body text-sm border-b-2 transition-colors ${
            tab === "one-rep-max"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          1RM Calculator
        </button>
      </div>

      {tab === "exercises" && (
        <ExerciseLibraryList
          groupId={groupId}
          coachId={coachId}
          initialExercises={initialExercises}
          biomechVocabulary={biomechVocabulary}
          initialBiomechTagsByExercise={initialBiomechTagsByExercise}
        />
      )}
      {tab === "patterns" && (
        <div>
          <AddStarterLaddersButton />
          <NewMovementPatternForm />
          {initialPatterns.length > 0 && (
            <div className="mt-6">
              <MovementPatternList initialPatterns={initialPatterns} exerciseLibrary={exerciseLibrary} />
            </div>
          )}
        </div>
      )}
      {tab === "sort" && (
        <SortMyExercises
          libraryNames={initialExercises.map((e) => e.name)}
          sortedNames={initialExercises.filter((e) => e.pattern).map((e) => e.name)}
          patternChoices={initialPatterns.map((p) => p.name)}
          patternIds={Object.fromEntries(initialPatterns.map((p) => [p.name, p.id]))}
          ranksByPattern={Object.fromEntries(initialPatterns.map((p) => [p.name, p.ladder.map((l) => l.rank ?? 0)]))}
        />
      )}
      {tab === "one-rep-max" && <OneRepMaxCalculator />}
    </div>
  );
}
