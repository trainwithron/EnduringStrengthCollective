"use client";

import { useState } from "react";
import { ExerciseLibraryList, type LibraryExerciseRow } from "./exercise-library-list";
import type { BiomechTagOption, BiomechTagSelection } from "./biomech-tag-picker";
import { MovementPatternList } from "./movement-pattern-list";
import { NewMovementPatternForm } from "./new-movement-pattern-form";
import { AddStarterLaddersButton } from "./add-starter-ladders-button";
import { SortMyExercises } from "./sort-my-exercises";
import type { ExercisePlane, MovementPlane } from "./movement-pattern-row";
import { OneRepMaxCalculator } from "@/components/tools/one-rep-max-calculator";
import { GymMachinesPanel } from "./gym-machines-panel";
import type { MachineRow } from "@/lib/gym-machines";

interface PatternWithLadder {
  id: string;
  name: string;
  plane: MovementPlane;
  ladder: { key: string; exerciseName: string; tier: "A" | "B" | "C" | null; unilateral?: boolean; rank?: number; plane?: ExercisePlane }[];
}

type Tab = "exercises" | "patterns" | "sort" | "machines" | "one-rep-max";

export function ExerciseLibraryTabs({
  groupId,
  coachId,
  initialExercises,
  initialPatterns,
  exerciseLibrary,
  biomechVocabulary,
  initialBiomechTagsByExercise,
  initialMachines = null,
  orgId = null,
  isAdmin = false,
  scanCounts = null,
}: {
  groupId: string;
  coachId: string;
  initialExercises: LibraryExerciseRow[];
  initialPatterns: PatternWithLadder[];
  exerciseLibrary: string[];
  biomechVocabulary: BiomechTagOption[];
  initialBiomechTagsByExercise: Record<string, BiomechTagSelection[]>;
  // The coach's machines; null before the database update that adds them (the tab is not shown).
  initialMachines?: MachineRow[] | null;
  // The organization of the workspace the library is open in (null in a coach's own space): printed QR codes and new machines carry it.
  orgId?: string | null;
  // The platform admin (Ron): the shared machine list's additions and reviews.
  isAdmin?: boolean;
  // How often each machine's QR code was scanned (step 215); null before that database step.
  scanCounts?: Record<string, { month: number; total: number }> | null;
}) {
  const [tab, setTab] = useState<Tab>("exercises");

  return (
    <div>
      {/* The tabs do not fit a phone's width: the row scrolls sideways instead of pushing the page wider. */}
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
        {initialMachines && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "machines"}
            onClick={() => setTab("machines")}
            className={`h-11 px-4 shrink-0 whitespace-nowrap font-body text-sm border-b-2 transition-colors ${
              tab === "machines"
                ? "border-rust text-chalk"
                : "border-transparent text-steel active:text-chalk"
            }`}
          >
            Machines
          </button>
        )}
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
          orgId={orgId}
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
      {tab === "machines" && initialMachines && <GymMachinesPanel coachId={coachId} orgId={orgId} initialMachines={initialMachines} exercises={initialExercises} isAdmin={isAdmin} scanCounts={scanCounts} />}
      {tab === "one-rep-max" && <OneRepMaxCalculator />}
    </div>
  );
}
