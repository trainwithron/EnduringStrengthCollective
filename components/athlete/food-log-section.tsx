"use client";

import { useState } from "react";
import type { GeneratedMeal } from "@/lib/meal-engine";
import { MealCheckoffList, type FoodLogEntry } from "./meal-checkoff-list";
import { TodaysMealCards } from "./todays-meal-cards";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";
import { QuickLogFoodButton } from "./quick-log-food-button";
import { BarcodeScanButton } from "./barcode-scan-button";
import { PhotoLogFoodButton } from "./photo-log-food-button";
import { FavoriteStar } from "./favorite-star";
import type { RecentFoodLogOption } from "@/lib/recent-food-logs";
import { NO_TARGET_LINE, hasTarget, sumLoggedFood, type DayTargetLike } from "@/lib/nutrition-tracking";

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
  recents,
  plan,
  target,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  meals: GeneratedMeal[];
  initialEntries: FoodLogEntry[];
  recents: RecentFoodLogOption[];
  // The saved plan for today (already filtered against this client's food preferences). When it has meals they are shown as option cards; otherwise the plain checklist.
  plan?: { meals: Record<string, MealEntryPayload[]> | null; hiddenCount: number; emptiedMeals: { bucket: string; mealId: string }[] } | null;
  // Today's target when a coach has set one. Without it the totals still show, with a friendly line instead of a comparison.
  target?: DayTargetLike | null;
}) {
  const planHasMeals = !!plan?.meals && Object.values(plan.meals).some((entries) => (entries ?? []).length > 0);
  const [quickLogEntries, setQuickLogEntries] = useState(initialEntries.filter((e) => !e.mealSlot));
  const [allEntries, setAllEntries] = useState(initialEntries);

  const loggedTotals = sumLoggedFood(allEntries);
  const withTarget = hasTarget(target);
  const of = (value: number | null | undefined) => (value != null ? ` / ${Math.round(value)}` : "");

  function handleQuickLogged(entry: FoodLogEntry) {
    setQuickLogEntries((prev) => [...prev, entry]);
    setAllEntries((prev) => [...prev, entry]);
  }

  function handleMealEntryLogged(entry: FoodLogEntry) {
    setAllEntries((prev) => [...prev.filter((e) => e.mealSlot !== entry.mealSlot), entry]);
  }

  return (
    <div className="space-y-3">
      <div className="border border-steel/20 p-3" data-testid="logged-totals">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Logged so far today</p>
        <p className="font-display text-lg leading-none [font-variant-numeric:tabular-nums]">
          {Math.round(loggedTotals.calories)}
          {withTarget ? of(target?.calories) : ""} kcal
        </p>
        <p className="font-body text-xs text-steel mt-0.5 [font-variant-numeric:tabular-nums]">
          {Math.round(loggedTotals.proteinG)}
          {withTarget ? of(target?.proteinG) : ""}p / {Math.round(loggedTotals.carbsG)}
          {withTarget ? of(target?.carbsG) : ""}c / {Math.round(loggedTotals.fatG)}
          {withTarget ? of(target?.fatG) : ""}f
        </p>
        {!withTarget && <p className="font-body text-xs text-steel mt-2">{NO_TARGET_LINE}</p>}
      </div>

      {planHasMeals ? (
        <TodaysMealCards
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          meals={plan!.meals}
          hiddenCount={plan!.hiddenCount}
          emptiedMeals={plan!.emptiedMeals}
          entries={allEntries}
          onEntryLogged={handleMealEntryLogged}
        />
      ) : (
        <MealCheckoffList
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          meals={meals}
          initialEntries={initialEntries}
          onEntryLogged={handleMealEntryLogged}
        />
      )}

      <div className="space-y-2">
        <QuickLogFoodButton
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          recents={recents}
          onLogged={handleQuickLogged}
        />
        <BarcodeScanButton athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
        <PhotoLogFoodButton athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
      </div>

      {quickLogEntries.length > 0 && (
        <div className="space-y-1.5">
          {quickLogEntries.map((e) => (
            <div key={e.id} className="border border-steel/15 p-2.5">
              <p className="font-body text-xs text-chalk">{e.description}</p>
              <p className="font-body text-xs text-steel mt-0.5">
                {e.calories} kcal · {e.proteinG}p / {e.carbsG}c / {e.fatG}f
              </p>
              <div className="mt-1.5">
                <FavoriteStar profileId={athleteId} entry={e} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
