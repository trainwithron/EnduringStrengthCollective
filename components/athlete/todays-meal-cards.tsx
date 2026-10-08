"use client";

import { useEffect, useRef, useState } from "react";
import { IngredientLine } from "@/components/shared/ingredient-line";
import { createBrowserClient } from "@/lib/supabase/client";
import { choicesFeaturedFirst, type MealEntryPayload, type MealPlanBucket, type MealRecipeChoice } from "@/lib/meal-plan-assignment";
import { FavoriteStar } from "./favorite-star";
import { FreeTextFoodLog, type FoodLogEntry } from "./meal-checkoff-list";

const BUCKET_LABELS: Record<MealPlanBucket, string> = { daily: "Meals", train: "Training day", rest: "Rest day" };

// Today's meals as the client sees them: for each meal, the featured option first (its grams, its macros), the other options one tap away, and "I ate this" on any of them
// logs THAT option (its name and its own macros, not the slot's target). A plan saved before options carried macros logs the slot's target, as it always did.
export function TodaysMealCards({
  athleteId,
  groupId,
  logDate,
  meals,
  hiddenCount = 0,
  emptiedMeals = [],
  entries,
  onEntryLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  meals: Record<string, MealEntryPayload[]> | null;
  // Options left out because they break this client's food preferences, and the meals that now have nothing to show.
  hiddenCount?: number;
  emptiedMeals?: { bucket: string; mealId: string }[];
  entries: FoodLogEntry[];
  onEntryLogged: (entry: FoodLogEntry) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [modifying, setModifying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Slots with a save in flight. A second tap before the first save returns would otherwise insert a second row and double count: the lock is a ref, so it holds even before a re-render.
  const inFlight = useRef<Set<string>>(new Set());
  const [dayType, setDayType] = useState<"train" | "rest" | null>(null);
  // Read after mount (never during the server render), so the page and the browser agree on the first paint.
  useEffect(() => {
    setDayType(readDayType(athleteId, logDate));
  }, [athleteId, logDate]);
  if (!meals) return null;
  const buckets = (Object.keys(meals) as MealPlanBucket[]).filter((b) => (meals[b] ?? []).length > 0);
  if (buckets.length === 0) return null;
  // A carb-cycling plan has a training-day menu and a rest-day menu. The client sees only the one for today, chosen once; a slot logged under either counts for the day.
  const bothDayTypes = buckets.includes("train") && buckets.includes("rest");
  const shownBuckets = bothDayTypes ? (dayType ? buckets.filter((b) => b === dayType || b === "daily") : []) : buckets;

  // Only an entry ticked off against the plan is "this meal logged"; a free-form food logged under the same meal name (a snack) is not.
  const entryFor = (mealId: string) => entries.find((e) => e.mealSlot === mealId && e.status !== "quick_log");

  async function log(meal: MealEntryPayload, choice: MealRecipeChoice | null, status: "ate_it" | "skipped") {
    // Already logged (or being logged): ignore the tap.
    if (inFlight.current.has(meal.mealId) || entryFor(meal.mealId)) return;
    inFlight.current.add(meal.mealId);
    setError(null);
    setSaving(meal.mealId);
    const m = choice?.macros;
    const protein = status === "skipped" ? 0 : m ? m.proteinG : meal.proteinTarget;
    const carbs = status === "skipped" ? 0 : m ? m.carbsG : meal.carbsTarget;
    const fat = status === "skipped" ? 0 : m ? m.fatG : meal.fatTarget;
    const calories = status === "skipped" ? 0 : m ? m.calories : Math.round(meal.proteinTarget * 4 + meal.carbsTarget * 4 + meal.fatTarget * 9);
    const description = status === "ate_it" ? (choice?.recipeName ?? null) : null;
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("food_log_entries")
      .insert({ athlete_id: athleteId, group_id: groupId, log_date: logDate, meal_slot: meal.mealId, status, description, calories, protein_g: protein, carbs_g: carbs, fat_g: fat })
      .select("id")
      .single();
    setSaving(null);
    if (insertError || !data) {
      inFlight.current.delete(meal.mealId);
      setError("Couldn't save that. Try again.");
      return;
    }
    // Kept locked: the slot now has an entry, so a later tap is ignored by the check above.
    onEntryLogged({ id: data.id, mealSlot: meal.mealId, status, description, calories, proteinG: protein, carbsG: carbs, fatG: fat });
  }

  return (
    <div className="border border-steel/20 p-4">
      {hiddenCount > 0 && (
        <p role="status" className="font-body text-xs text-chalk border border-steel/30 bg-surface/40 p-2.5 mb-3">
          Your coach is updating {emptiedMeals.length > 0 ? (emptiedMeals.length === 1 ? "one meal" : `${emptiedMeals.length} meals`) : "some of your meals"} to match your food preferences. Anything that doesn&apos;t fit is hidden until then.
        </p>
      )}
      {error && (
        <p role="alert" className="font-body text-xs text-rust mb-2">
          {error}
        </p>
      )}
      {bothDayTypes && (
        <div className="mb-4">
          <p className="font-body text-sm text-chalk mb-2">{dayType ? `Today is a ${dayType === "train" ? "training" : "rest"} day.` : "Is today a training day or a rest day?"}</p>
          <div className="flex items-center gap-2">
            {(["train", "rest"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setDayType(t);
                  writeDayType(athleteId, logDate, t);
                }}
                className={`h-11 px-3 font-body text-xs border ${dayType === t ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
              >
                {t === "train" ? "Training day" : "Rest day"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-5">
        {shownBuckets.map((bucket) => (
          <div key={bucket}>
            {shownBuckets.length > 1 && <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">{BUCKET_LABELS[bucket] ?? bucket}</p>}
            <div className="space-y-4">
              {meals[bucket].map((meal) => {
                const choices = choicesFeaturedFirst(meal);
                const logged = entryFor(meal.mealId);
                const busy = saving === meal.mealId;
                const empty = emptiedMeals.some((e) => e.bucket === bucket && e.mealId === meal.mealId);
                return (
                  <div key={`${bucket}-${meal.mealId}`} className="border-t border-steel/15 pt-3 first:border-t-0 first:pt-0">
                    <p className="font-body text-xs text-steel uppercase tracking-wide">{meal.title}</p>
                    <p className="font-body text-xs text-steel mb-2">
                      Target {meal.proteinTarget}p / {meal.carbsTarget}c / {meal.fatTarget}f
                    </p>

                    {logged ? (
                      <p className="font-body text-xs flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${logged.status === "skipped" ? "bg-steel" : "bg-moss"}`} />
                        {logged.status === "ate_it" && `Logged: ${logged.description ?? "eaten"}`}
                        {logged.status === "modified" && `Logged (changed): ${logged.description ?? ""}`}
                        {logged.status === "skipped" && "Skipped"}
                        {logged.status === "ate_it" && (
                          <span className="ml-2">
                            <FavoriteStar profileId={athleteId} entry={logged} fallbackLabel={logged.description ?? meal.title} />
                          </span>
                        )}
                      </p>
                    ) : choices.length === 0 ? (
                      <p className="font-body text-sm text-steel">{empty ? "Your coach is updating this meal." : meal.title}</p>
                    ) : (
                      <div className="space-y-2">
                        {choices.map((choice, i) => (
                          <OptionCard
                            key={`${choice.recipeId ?? choice.recipeName ?? i}-${i}`}
                            choice={choice}
                            featured={i === 0}
                            busy={busy}
                            onAte={() => log(meal, choice, "ate_it")}
                          />
                        ))}
                        {modifying === `${bucket}-${meal.mealId}` ? (
                          <FreeTextFoodLog
                            athleteId={athleteId}
                            groupId={groupId}
                            logDate={logDate}
                            mealSlot={meal.mealId}
                            status="modified"
                            placeholder="What did you actually have instead?"
                            onLogged={(entry) => {
                              onEntryLogged(entry);
                              setModifying(null);
                            }}
                            onCancel={() => setModifying(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setModifying(`${bucket}-${meal.mealId}`)}
                              disabled={busy}
                              className="h-11 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
                            >
                              Ate something else
                            </button>
                            <button type="button" onClick={() => log(meal, null, "skipped")} disabled={busy} className="h-11 px-3 font-body text-xs text-steel disabled:opacity-40">
                              Skip
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Which kind of day it is, remembered for the day on this device only (a convenience: the choice never leaves the browser).
const dayTypeKey = (athleteId: string, logDate: string) => `meal-daytype-${athleteId}-${logDate}`;
function readDayType(athleteId: string, logDate: string): "train" | "rest" | null {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(dayTypeKey(athleteId, logDate));
    return v === "train" || v === "rest" ? v : null;
  } catch {
    return null;
  }
}
function writeDayType(athleteId: string, logDate: string, v: "train" | "rest") {
  try {
    window.localStorage.setItem(dayTypeKey(athleteId, logDate), v);
  } catch {
    // Not remembered; the client is simply asked again next time.
  }
}

function OptionCard({ choice, featured, busy, onAte }: { choice: MealRecipeChoice; featured: boolean; busy: boolean; onAte: () => void }) {
  const [open, setOpen] = useState(featured);
  const m = choice.macros;
  return (
    <div className={`border p-3 ${featured ? "border-rust/50" : "border-steel/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {featured && <p className="font-body text-[11px] uppercase tracking-wide text-rust mb-0.5">Today&apos;s pick</p>}
          <p className="font-body text-sm font-medium text-chalk">{choice.recipeName ?? "Meal"}</p>
          {m && (
            <p className="font-body text-xs text-steel mt-0.5">
              {m.calories} kcal · {m.proteinG}p / {m.carbsG}c / {m.fatG}f
            </p>
          )}
        </div>
        {!featured && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="font-body text-xs text-steel shrink-0 h-11 px-2" aria-expanded={open}>
            {open ? "Hide" : "See it"}
          </button>
        )}
      </div>
      {open && choice.ingredients.length > 0 && (
        <ul className="mt-2 space-y-0.5 pl-3">
          {
            // Always text (only an exact <strong> shows bold): a coach can write any text into a plan a client opens, so a line is never HTML.
            choice.ingredients.map((ing, j) => (
              <li key={j} className="font-body text-xs text-steel">
                <IngredientLine text={ing} />
              </li>
            ))
          }
        </ul>
      )}
      <button type="button" onClick={onAte} disabled={busy} className="mt-2 h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
        I ate this
      </button>
    </div>
  );
}
