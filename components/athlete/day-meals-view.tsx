import type { MealEntryPayload, MealPlanBucket } from "@/lib/meal-plan-assignment";

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
              {meals[bucket].map((m) => (
                <div key={m.mealId} className="py-2">
                  <p className="font-body text-sm font-medium">
                    {m.recipeName ?? m.title}
                  </p>
                  <p className="font-body text-xs text-steel mt-0.5">
                    {m.proteinTarget}p / {m.carbsTarget}c / {m.fatTarget}f
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
