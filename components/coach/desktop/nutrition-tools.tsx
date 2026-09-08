"use client";

import { useState } from "react";
import { MacroCalculator, type CalculatedMacros } from "@/components/tools/macro-calculator";
import { MealPlanGenerator, type ImportedMacros } from "@/components/coach/desktop/meal-plan-generator";
import type { WeeklyWeightTrend } from "@/lib/weight-trend";

interface SavedPlanShape {
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, unknown>;
  meals: Record<string, unknown>;
}

// Combines the Macro Calculator with the Meal Planner on the client
// profile page so a coach can compute a target and hand it straight to
// the planner without retyping anything — the "Use these macros" button
// below flows through this shared state.
export function NutritionTools({
  athleteId,
  groupId,
  date,
  latestBodyWeight,
  weightTrend,
  existingPlan,
}: {
  athleteId: string;
  groupId: string;
  date: string;
  latestBodyWeight: number | null;
  weightTrend: WeeklyWeightTrend;
  existingPlan: SavedPlanShape | null;
}) {
  const [importedMacros, setImportedMacros] = useState<ImportedMacros | null>(null);

  function handleUseMacros(macros: CalculatedMacros) {
    setImportedMacros({ ...macros, key: Date.now() });
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-3">
          Macro calculator
        </h3>
        <MacroCalculator onUseMacros={handleUseMacros} />
      </div>

      <div className="pt-6 border-t border-steel/20">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-3">
          Meal planner
        </h3>
        <MealPlanGenerator
          athleteId={athleteId}
          groupId={groupId}
          date={date}
          latestBodyWeight={latestBodyWeight}
          weightTrend={weightTrend}
          existingPlan={existingPlan}
          importedMacros={importedMacros}
        />
      </div>
    </div>
  );
}
