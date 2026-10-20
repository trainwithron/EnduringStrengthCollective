"use client";

import { useState } from "react";
import type { GeneratedMeal } from "@/lib/meal-engine";
import { MealCheckoffList, type FoodLogEntry } from "./meal-checkoff-list";
import { TodaysMealCards } from "./todays-meal-cards";
import { MealPlanRetryBox } from "./meal-plan-retry-box";
import type { RetryState } from "@/lib/meal-plan-retry";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";
import { QuickLogFoodButton } from "./quick-log-food-button";
import { BarcodeScanButton } from "./barcode-scan-button";
import { PhotoLogFoodButton } from "./photo-log-food-button";
import { FoodSearchLog } from "./food-search-log";
import { FoodLogEntries } from "./food-log-entries";
import { MyFoodsPanel } from "./my-foods-panel";
import { FavoriteFoodChips } from "./favorite-food-chips";
import { RecentFoodChips } from "./recent-food-chips";
import { withJustLogged, type RecentFoodLogOption } from "@/lib/recent-food-logs";
import { LogNutrients } from "@/components/nutrition/log-nutrients";
import type { DayTotals, LoggedEntry } from "@/lib/nutrient-day";
import type { PlanEstimate } from "@/lib/nutrient-view";
import type { Sex } from "@/lib/dri-data";
import { COACH_CAN_SEE_LINE, hasTarget, noTargetLine, sumLoggedFood, type DayTargetLike } from "@/lib/nutrition-tracking";

// Wires the checkoff list + quick-log entry point + a running "logged so
// far today" total into one section for the athlete's Nutrition page
// (calorie_tracking_ux_research_and_plan.md, V1 — the app's first real
// food-logging UI).
// On a phone (FIX_NUTRITION_PHONE item 2): what is logged so far, the plan, one-tap Favorites and Recent, then every way to log (search first), what was logged, and the vitamins
// and minerals last, so Search foods and "I ate this" are on the first screen. `logDate` is the day shown (the day switcher above picks it); everything here is for that day.
export function FoodLogSection({
  athleteId,
  groupId,
  logDate,
  meals,
  initialEntries,
  recents,
  plan,
  target,
  coachProgramming = true,
  nutrients,
  planRetry = null,
  selfCoached = false,
  totalsTitle = "Logged so far today",
  planHeading,
  isToday = true,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  meals: GeneratedMeal[];
  initialEntries: FoodLogEntry[];
  recents: RecentFoodLogOption[];
  // The saved plan for the day (already filtered against this client's food preferences). When it has meals they are shown as option cards; otherwise the plain checklist.
  plan?: { meals: Record<string, MealEntryPayload[]> | null; hiddenCount: number; emptiedMeals: { bucket: string; mealId: string }[] } | null;
  // The day's target when a coach has set one. Without it the totals still show, with a friendly line instead of a comparison.
  target?: DayTargetLike | null;
  // False for a client on a tier with no targets or meal plans (the group tier): the no-target line then does not promise a target.
  coachProgramming?: boolean;
  // Vitamins and minerals shown with the log: the 29 days before the day added up on the server, the person's age and sex for their reference intake, and (optionally) an estimate from the meal plan.
  nutrients?: { pastDays: DayTotals[]; age: number | null; sex: Sex | null; planEstimate: PlanEstimate | null; partialLog?: boolean } | null;
  // "Not feeling it? Tell us what to change." under the meals. Null for a coach acting as the client, a client with no saved plan, and anyone who may not ask.
  planRetry?: RetryState | null;
  // A coach in their own personal space is their own coach: "No target yet" / "No meal plan yet", never "your coach".
  selfCoached?: boolean;
  // The totals line's title and the plan's heading for the day shown ("Logged so far today" / "Logged yesterday").
  totalsTitle?: string;
  planHeading?: string;
  // Whether the day shown is today (the day switcher can show another).
  isToday?: boolean;
}) {
  const planHasMeals = !!plan?.meals && Object.values(plan.meals).some((entries) => (entries ?? []).length > 0);
  const [allEntries, setAllEntries] = useState(initialEntries);
  // Foods logged on this page, oldest first: they go to the front of Recent.
  const [justLogged, setJustLogged] = useState<FoodLogEntry[]>([]);

  const loggedTotals = sumLoggedFood(allEntries);
  const withTarget = hasTarget(target);
  // The day's entries in the shape the nutrient totals read; they follow every food as it is logged, edited or deleted.
  const loggedToday: LoggedEntry[] = allEntries.map((e) => ({ logDate, status: e.status, description: e.description, calories: e.calories, nutrients: e.nutrients ?? null }));
  const of = (value: number | null | undefined) => (value != null ? ` / ${Math.round(value)}` : "");
  const shownRecents = withJustLogged(justLogged, recents);

  function remember(entries: FoodLogEntry[]) {
    setJustLogged((prev) => [...prev, ...entries.filter((e) => e.status !== "skipped")]);
  }

  function handleQuickLogged(entry: FoodLogEntry) {
    setAllEntries((prev) => [...prev, entry]);
    remember([entry]);
  }

  // A meal ticked off against the plan replaces the earlier entry for that plan meal. A free-form food (quick_log) logged under a meal name such as "snack" is a different
  // thing and stays.
  function handleMealEntryLogged(entry: FoodLogEntry) {
    setAllEntries((prev) => [...prev.filter((e) => e.mealSlot !== entry.mealSlot || e.status === "quick_log"), entry]);
  }

  function handleAdded(added: FoodLogEntry[]) {
    setAllEntries((prev) => [...prev, ...added]);
    remember(added);
  }
  function handleChanged(entry: FoodLogEntry) {
    setAllEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)));
  }
  function handleDeleted(id: string) {
    setAllEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="border border-steel/20 p-3" data-testid="logged-totals">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">{totalsTitle}</p>
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
        {!withTarget && <p className="font-body text-xs text-steel mt-2">{noTargetLine(coachProgramming, selfCoached)}</p>}
        <p className="font-body text-xs text-steel mt-1">{COACH_CAN_SEE_LINE}</p>
      </div>

      {planHasMeals ? (
        <>
          <TodaysMealCards
            athleteId={athleteId}
            groupId={groupId}
            logDate={logDate}
            meals={plan!.meals}
            hiddenCount={plan!.hiddenCount}
            emptiedMeals={plan!.emptiedMeals}
            entries={allEntries}
            onEntryLogged={handleMealEntryLogged}
            heading={planHeading}
          />
          {planRetry && <MealPlanRetryBox groupId={groupId} state={planRetry} />}
        </>
      ) : coachProgramming ? (
        // Nothing is promised to a client whose coach does not set macros or a meal plan for them ("Your coach is still setting up your meal plan" would wait forever).
        <MealCheckoffList
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          meals={meals}
          initialEntries={initialEntries}
          onEntryLogged={handleMealEntryLogged}
          selfCoached={selfCoached}
        />
      ) : null}

      {/* One tap logs a starred or a recent food again (each hides when it has nothing). */}
      <div className="space-y-2">
        <FavoriteFoodChips athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
        <RecentFoodChips athleteId={athleteId} groupId={groupId} logDate={logDate} recents={shownRecents} onLogged={handleQuickLogged} />
      </div>

      <div className="space-y-2">
        <FoodSearchLog athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
        <MyFoodsPanel athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleAdded} />
        <QuickLogFoodButton athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
        <BarcodeScanButton athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
        <PhotoLogFoodButton athleteId={athleteId} groupId={groupId} logDate={logDate} onLogged={handleQuickLogged} />
      </div>

      <FoodLogEntries
        athleteId={athleteId}
        groupId={groupId}
        logDate={logDate}
        entries={allEntries}
        onAdded={handleAdded}
        onChanged={handleChanged}
        onDeleted={handleDeleted}
        isToday={isToday}
      />

      {nutrients && (
        <LogNutrients
          groupId={groupId}
          athleteId={athleteId}
          todayKey={logDate}
          pastDays={nutrients.pastDays}
          age={nutrients.age}
          sex={nutrients.sex}
          entries={loggedToday}
          audience="client"
          planEstimate={nutrients.planEstimate}
          partialLog={nutrients.partialLog}
        />
      )}
    </div>
  );
}
