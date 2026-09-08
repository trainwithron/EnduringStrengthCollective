"use client";

import { useState } from "react";
import {
  estimateProteinFromBodyWeight,
  estimateMaintenanceCalories,
  applyGoalAdjustment,
  fillCarbsAndFat,
  type ActivityLevel,
  type MacroGoal,
} from "@/lib/macros";

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary (desk job, little exercise)" },
  { value: "light", label: "Lightly active (1-3 workouts/week)" },
  { value: "moderate", label: "Moderately active (3-5 workouts/week)" },
  { value: "very_active", label: "Very active (6+ workouts/week or physical job)" },
];

const GOAL_OPTIONS: { value: MacroGoal; label: string }[] = [
  { value: "cut", label: "Fat loss (-20%)" },
  { value: "maintain", label: "Maintenance" },
  { value: "lean_bulk", label: "Lean bulk (+10%)" },
];

const SPLIT_OPTIONS: { value: "high" | "balanced" | "low"; label: string }[] = [
  { value: "high", label: "Higher carb" },
  { value: "balanced", label: "Balanced" },
  { value: "low", label: "Higher fat" },
];

export interface CalculatedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export function MacroCalculator({
  onUseMacros,
}: {
  onUseMacros?: (macros: CalculatedMacros) => void;
} = {}) {
  const [weight, setWeight] = useState("180");
  const [activity, setActivity] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<MacroGoal>("maintain");
  const [proteinPerLb, setProteinPerLb] = useState("1");
  const [split, setSplit] = useState<"high" | "balanced" | "low">("balanced");

  const weightNum = parseFloat(weight) || 0;
  const valid = weightNum > 0;

  const maintenance = valid ? estimateMaintenanceCalories(weightNum, activity) : 0;
  const targetCalories = valid ? applyGoalAdjustment(maintenance, goal) : 0;
  const proteinG = valid
    ? Math.round(weightNum * (parseFloat(proteinPerLb) || 1))
    : 0;
  const remainder = valid ? fillCarbsAndFat(targetCalories, proteinG, split) : null;

  return (
    <div className="max-w-lg space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Body weight (lbs)
          </span>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Protein (g per lb)
          </span>
          <input
            type="number"
            step="0.1"
            value={proteinPerLb}
            onChange={(e) => setProteinPerLb(e.target.value)}
            className="h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Activity level</span>
        <select
          value={activity}
          onChange={(e) => setActivity(e.target.value as ActivityLevel)}
          className="h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        >
          {ACTIVITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Goal</span>
        <select
          value={goal}
          onChange={(e) => setGoal(e.target.value as MacroGoal)}
          className="h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        >
          {GOAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Carb/fat split</span>
        <div className="flex gap-2">
          {SPLIT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSplit(o.value)}
              className={`h-9 px-3 font-body text-xs border flex-1 ${
                split === o.value
                  ? "bg-rust text-graphite border-rust"
                  : "border-steel/30 text-steel"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {!valid && (
        <p className="font-body text-xs text-steel">Enter a body weight to see an estimate.</p>
      )}

      {valid && (
        <div className="pt-4 border-t border-steel/15 space-y-4">
          <div>
            <p className="font-body text-xs text-steel">
              Estimated maintenance: <span className="text-chalk">{maintenance} cal/day</span>
            </p>
            <p className="font-display text-3xl leading-none mt-1">{targetCalories}</p>
            <p className="font-body text-xs text-steel mt-1">Calories/day for this goal</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{proteinG}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Protein</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{remainder?.carbsG ?? "—"}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Carbs</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{remainder?.fatG ?? "—"}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Fat</p>
            </div>
          </div>

          {onUseMacros && remainder && (
            <button
              type="button"
              onClick={() =>
                onUseMacros({
                  calories: targetCalories,
                  protein: proteinG,
                  carbs: remainder.carbsG,
                  fats: remainder.fatG,
                })
              }
              className="w-full h-10 bg-positive text-graphite font-body text-sm font-medium"
            >
              Use these macros in the meal planner ↓
            </button>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-steel/15">
        <h3 className="font-display uppercase text-sm tracking-wide text-chalk mb-2">
          Finding your real maintenance
        </h3>
        <div className="font-body text-sm text-steel space-y-3 leading-relaxed">
          <p>
            Every calculator here — this one included — is built on population averages.
            Two people at the same weight, activity level, and goal can have real
            maintenance numbers that differ by three or four hundred calories, because
            things like NEAT, gut efficiency, and day-to-day movement never show up in a
            formula. Treat the number above as a smart starting point, not a verdict.
          </p>
          <p>
            The only maintenance number that&apos;s actually true is the one your body
            reports back. Here&apos;s how to find it:
          </p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Start at the estimate above — it&apos;s a fine place to begin.</li>
            <li>
              Eat that same target every day for a full week, tracking honestly (weigh
              your food, log everything, no untracked days).
            </li>
            <li>
              Weigh yourself each morning under the same conditions and average the week.
            </li>
            <li>Compare that average to the week before it.</li>
          </ol>
          <p>
            If your weight held steady — within about half a pound either way — you&apos;ve
            found your real maintenance, full stop, regardless of what any calculator
            said. If you gained, you were eating above it; if you lost, you were eating
            below it. Either way, you now have a real number to build from instead of a
            guess.
          </p>
        </div>
      </div>
    </div>
  );
}
