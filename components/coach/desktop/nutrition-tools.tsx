"use client";

import { useState } from "react";
import { MacroCalculator, type CalculatedMacros } from "@/components/tools/macro-calculator";
import { MealPlanGenerator, type ImportedMacros } from "@/components/coach/desktop/meal-plan-generator";
import type { WeeklyWeightTrend } from "@/lib/weight-trend";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import type { FoodRules } from "@/lib/allergen-check";
import type { WeightUnit } from "@/lib/units";
import type { ActivityLevel } from "@/lib/macros";

interface SavedPlanShape {
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, unknown>;
  meals: Record<string, unknown>;
}

// One coherent "Meal Planner" flow, not two stacked tools (real layout
// feedback from Ron, from a screenshot of this exact page): the
// calculator is Step 1, collapsing to a one-line summary once it's been
// run — same collapse pattern MacroCalculator's own "Finding your real
// maintenance" sub-section already uses — and its output feeds straight
// into Step 2 (the planner) below via the existing importedMacros wiring,
// no retyping.
export function NutritionTools({
  athleteId,
  groupId,
  date,
  latestBodyWeight,
  weightTrend,
  existingPlan,
  defaultAdherenceDays,
  defaultRecoveryRating,
  defaultDietaryRestrictions,
  isInjured,
  maintenanceCalories,
  injurySurplusPct,
  initialConsecutiveSurplusSpikes,
  defaultPhase,
  proteinGPerLb,
  foodRules,
  rulesReadable = true,
  weightUnit = "lb",
  initialActivity = null,
}: {
  athleteId: string;
  groupId: string;
  date: string;
  latestBodyWeight: number | null;
  weightTrend: WeeklyWeightTrend;
  existingPlan: SavedPlanShape | null;
  defaultAdherenceDays?: number | null;
  defaultRecoveryRating?: number | null;
  defaultDietaryRestrictions?: string | null;
  isInjured?: boolean;
  maintenanceCalories?: number | null;
  injurySurplusPct?: number;
  initialConsecutiveSurplusSpikes?: number;
  // This client's real tagged phase, mapped via milestoneTagToNutritionPhase
  // — seeds both Step 1 and Step 2's own default, rather than each
  // opening on a hardcoded guess regardless of what's actually tagged.
  defaultPhase?: NutritionPhase | null;
  // This client's own protein target in g per pound (their preferences).
  proteinGPerLb?: number;
  // This client's food rules; the generator never offers an option that breaks them.
  foodRules?: FoodRules;
  // False when the client's saved food rules could not be read: the planner builds nothing then.
  rulesReadable?: boolean;
  // How the client sees weight, and the activity level they gave: the calculator starts from them.
  weightUnit?: WeightUnit;
  initialActivity?: ActivityLevel | null;
}) {
  const [importedMacros, setImportedMacros] = useState<ImportedMacros | null>(null);
  const [calculatorExpanded, setCalculatorExpanded] = useState(true);

  function handleUseMacros(macros: CalculatedMacros) {
    setImportedMacros({ ...macros, key: Date.now() });
    setCalculatorExpanded(false);
  }

  return (
    <div className="space-y-6">
      <h3 className="font-body text-xs text-steel uppercase tracking-wide">Meal planner</h3>

      <div id="macro-calculator" className="border border-steel/20">
        <button
          type="button"
          onClick={() => setCalculatorExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="font-body text-sm font-medium text-chalk shrink-0">
            Step 1 — Macro Calculator
          </span>
          <span className="font-body text-xs text-steel flex items-center gap-2 min-w-0">
            {importedMacros && (
              <span className="truncate">
                {importedMacros.calories} cal · {importedMacros.protein}p · {importedMacros.carbs}c ·{" "}
                {importedMacros.fats}f
              </span>
            )}
            <span className="shrink-0">{calculatorExpanded ? "▾" : "▸"}</span>
          </span>
        </button>
        {calculatorExpanded && (
          <div className="px-4 pb-4 border-t border-steel/15 pt-4">
            <MacroCalculator onUseMacros={handleUseMacros} initialWeight={latestBodyWeight} initialGoal={defaultPhase} weightUnit={weightUnit} initialActivity={initialActivity} />
          </div>
        )}
      </div>

      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
          Step 2 — Generate the plan
        </p>
        <MealPlanGenerator
          athleteId={athleteId}
          groupId={groupId}
          date={date}
          latestBodyWeight={latestBodyWeight}
          weightTrend={weightTrend}
          existingPlan={existingPlan}
          importedMacros={importedMacros}
          defaultAdherenceDays={defaultAdherenceDays}
          defaultRecoveryRating={defaultRecoveryRating}
          defaultDietaryRestrictions={defaultDietaryRestrictions}
          isInjured={isInjured}
          maintenanceCalories={maintenanceCalories}
          injurySurplusPct={injurySurplusPct}
          initialConsecutiveSurplusSpikes={initialConsecutiveSurplusSpikes}
          initialPhase={defaultPhase}
          proteinGPerLb={proteinGPerLb}
          foodRules={foodRules}
          rulesReadable={rulesReadable}
        />
      </div>
    </div>
  );
}
