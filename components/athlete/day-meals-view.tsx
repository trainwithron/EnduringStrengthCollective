import { IngredientLine } from "@/components/shared/ingredient-line";
import { choicesFeaturedFirst, type MealEntryPayload, type MealPlanBucket } from "@/lib/meal-plan-assignment";

const BUCKET_LABELS: Record<MealPlanBucket, string> = {
  daily: "Meals",
  train: "Training day",
  rest: "Rest day",
};

export function DayMealsView({
  meals,
  hiddenCount = 0,
  emptiedMeals = [],
}: {
  meals: Record<string, MealEntryPayload[]> | null;
  // Options left out because they break this client's food preferences (an allergy added after the plan was made), and the meals that now have nothing to show.
  hiddenCount?: number;
  emptiedMeals?: { bucket: string; mealId: string }[];
}) {
  if (!meals) return null;
  const buckets = (Object.keys(meals) as MealPlanBucket[]).filter(
    (b) => (meals[b] ?? []).length > 0
  );
  if (buckets.length === 0) return null;

  return (
    <div className="border border-steel/20 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
        Selected meals
      </h2>
      {hiddenCount > 0 && (
        <p role="status" className="font-body text-xs text-chalk border border-steel/30 bg-surface/40 p-2.5 mb-3">
          Your coach is updating {emptiedMeals.length > 0 ? (emptiedMeals.length === 1 ? "one meal" : `${emptiedMeals.length} meals`) : "some of your meals"} to match your food preferences. Anything that doesn&apos;t fit is hidden until then.
        </p>
      )}
      <div className="space-y-4">
        {buckets.map((bucket) => (
          <div key={bucket}>
            {buckets.length > 1 && (
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">
                {BUCKET_LABELS[bucket] ?? bucket}
              </p>
            )}
            <div className="divide-y divide-steel/15">
              {meals[bucket].map((m) => {
                const choices = choicesFeaturedFirst(m);
                return (
                  <div key={m.mealId} className="py-2">
                    <p className="font-body text-xs text-steel uppercase tracking-wide">{m.title}</p>
                    {choices.length > 0 ? (
                      choices.map((choice, i) => (
                        <div key={i} className="mt-0.5">
                          <p className="font-body text-sm font-medium">{choice.recipeName ?? m.title}</p>
                          {choice.macros && (
                            <p className="font-body text-xs text-steel">
                              {choice.macros.calories} kcal · {choice.macros.proteinG}p / {choice.macros.carbsG}c / {choice.macros.fatG}f
                            </p>
                          )}
                          {choice.ingredients.length > 0 && (
                            <ul className="mt-1 space-y-0.5 pl-3">
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
                        </div>
                      ))
                    ) : emptiedMeals.some((e) => e.bucket === bucket && e.mealId === m.mealId) ? (
                      <p className="font-body text-sm text-steel mt-0.5">Your coach is updating this meal.</p>
                    ) : (
                      <p className="font-body text-sm font-medium mt-0.5">{m.title}</p>
                    )}
                    <p className="font-body text-xs text-steel mt-0.5">
                      {m.proteinTarget}p / {m.carbsTarget}c / {m.fatTarget}f
                    </p>
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
