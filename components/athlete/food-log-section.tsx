"use client";

import { useState } from "react";
import type { GeneratedMeal } from "@/lib/meal-engine";
import { MealCheckoffList, type FoodLogEntry } from "./meal-checkoff-list";
import { QuickLogFoodButton } from "./quick-log-food-button";

// Wires the checkoff list + quick-log entry point + a running "logged so
// far today" total into one section for the athlete's Nutrition page
// (calorie_tracking_ux_research_and_plan.md, V1 — the app's first real
// food-logging UI).
export function FoodLogSection({
  athleteId,
  groupId,
  logDate,
  meals,
  initialEntries,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  meals: GeneratedMeal[];
  initialEntries: FoodLogEntry[];
}) {
  const [quickLogEntries, setQuickLogEntries] = useState(initialEntries.filter((e) => !e.mealSlot));
  const [allEntries, setAllEntries] = useState(initialEntries);

  const loggedTotals = allEntries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories ?? 0),
      proteinG: acc.proteinG + (e.proteinG ?? 0),
      carbsG: acc.carbsG + (e.carbsG ?? 0),
      fatG: acc.fatG + (e.fatG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  function handleQuickLogged(entry: FoodLogEntry) {
    setQuickLogEntries((prev) => [...prev, entry]);
    setAllEntries((prev) => [...prev, entry]);
  }

  function handleMealEntryLogged(entry: FoodLogEntry) {
    setAllEntries((prev) => [...prev.filter((e) => e.mealSlot !== entry.mealSlot), entry]);
  }

  return (
    <div className="space-y-3">
      {allEntries.length > 0 && (
        <div className="border border-steel/20 p-3">
          <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1.5">
            Logged so far today
          </p>
          <p className="font-display text-lg leading-none">
            {Math.round(loggedTotals.calories)} kcal
          </p>
          <p className="font-body text-xs text-steel mt-0.5">
            {Math.round(loggedTotals.proteinG)}p / {Math.round(loggedTotals.carbsG)}c /{" "}
            {Math.round(loggedTotals.fatG)}f
          </p>
        </div>
      )}

      <MealCheckoffList
        athleteId={athleteId}
        groupId={groupId}
        logDate={logDate}
        meals={meals}
        initialEntries={initialEntries}
        onEntryLogged={handleMealEntryLogged}
      />

      <QuickLogFoodButton
        athleteId={athleteId}
        groupId={groupId}
        logDate={logDate}
        onLogged={handleQuickLogged}
      />

      {quickLogEntries.length > 0 && (
        <div className="space-y-1.5">
          {quickLogEntries.map((e) => (
            <div key={e.id} className="border border-steel/15 p-2.5">
              <p className="font-body text-xs text-chalk">{e.description}</p>
              <p className="font-body text-[11px] text-steel mt-0.5">
                {e.calories} kcal · {e.proteinG}p / {e.carbsG}c / {e.fatG}f
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
