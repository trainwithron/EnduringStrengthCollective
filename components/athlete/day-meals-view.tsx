import { mealRecipeChoices, type MealEntryPayload, type MealPlanBucket } from "@/lib/meal-plan-assignment";

const BUCKET_LABELS: Record<MealPlanBucket, string> = {
  daily: "Meals",
  train: "Training day",
  rest: "Rest day",
};

export function DayMealsView({
  meals,
}: {
  meals: Record<string, MealEntryPayload[]> | null;
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
      <div className="space-y-4">
        {buckets.map((bucket) => (
          <div key={bucket}>
            {buckets.length > 1 && (
              <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1.5">
                {BUCKET_LABELS[bucket] ?? bucket}
              </p>
            )}
            <div className="divide-y divide-steel/15">
              {meals[bucket].map((m) => {
                const choices = mealRecipeChoices(m);
                return (
                  <div key={m.mealId} className="py-2">
                    <p className="font-body text-xs text-steel uppercase tracking-wide">{m.title}</p>
                    {choices.length > 0 ? (
                      choices.map((choice, i) => (
                        <div key={i} className="mt-0.5">
                          <p className="font-body text-sm font-medium">{choice.recipeName ?? m.title}</p>
                          {choice.ingredients.length > 0 && (
                            <ul className="mt-1 space-y-0.5 pl-3">
                              {choice.isAi
                                ? // AI-generated text, not the fixed recipe database —
                                  // rendered as plain text, never dangerouslySetInnerHTML.
                                  choice.ingredients.map((ing, j) => (
                                    <li key={j} className="font-body text-xs text-steel">
                                      • {ing}
                                    </li>
                                  ))
                                : // Ingredient lines carry <strong> tags from the fixed,
                                  // coach-owned recipe database, not user input — same
                                  // trust boundary as the coach-facing builder's own
                                  // rendering of this exact data.
                                  choice.ingredients.map((ing, j) => (
                                    <li
                                      key={j}
                                      className="font-body text-xs text-steel"
                                      dangerouslySetInnerHTML={{ __html: `• ${ing}` }}
                                    />
                                  ))}
                            </ul>
                          )}
                        </div>
                      ))
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
