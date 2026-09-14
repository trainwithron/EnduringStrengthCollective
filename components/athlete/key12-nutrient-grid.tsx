import { KEY_12_NUTRIENTS } from "@/lib/nutrient-keys";
import type { NutrientTotals } from "@/lib/meal-nutrient-estimate";

// Real per-100g USDA data multiplied through real scaled ingredient
// grams (lib/todays-micronutrients.ts) — an estimate from today's
// planned meals, not a lab panel. Coverage is shown honestly: a meal
// with unmapped ingredients renders a lower total, never a silently
// complete-looking one.
export function Key12NutrientGrid({
  totals,
  coveredIngredientCount,
  totalIngredientCount,
}: {
  totals: NutrientTotals;
  coveredIngredientCount: number;
  totalIngredientCount: number;
}) {
  const isPartial = totalIngredientCount > 0 && coveredIngredientCount < totalIngredientCount;

  return (
    <div className="border border-steel/20 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-body text-[10px] text-steel uppercase tracking-wide">
          Key nutrients — estimated from today&apos;s meals
        </p>
        {totalIngredientCount > 0 && (
          <p className="font-body text-[10px] text-steel">
            {coveredIngredientCount}/{totalIngredientCount} ingredients mapped
          </p>
        )}
      </div>

      {totalIngredientCount === 0 ? (
        <p className="font-body text-sm text-steel">No meal plan set for today yet.</p>
      ) : (
        <>
          {isPartial && (
            <p className="font-body text-[11px] text-steel mb-3 border-l-2 border-steel/30 pl-2">
              Some ingredients in today&apos;s meals aren&apos;t mapped to real nutrition data yet —
              totals below are a partial estimate, not the full picture.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {KEY_12_NUTRIENTS.map((n) => {
              const amount = totals[n.key] ?? 0;
              const pct = Math.min(100, Math.round((amount / n.dailyValue) * 100));
              return (
                <div key={n.key}>
                  <div className="flex items-baseline justify-between">
                    <p className="font-body text-xs text-chalk">{n.label}</p>
                    <p className="font-body text-[11px] text-steel">
                      {Math.round(amount * 10) / 10}
                      {n.unit}
                    </p>
                  </div>
                  <div className="h-1 bg-steel/15 mt-1">
                    <div className="h-1 bg-rust" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="font-body text-[10px] text-steel mt-3">% of FDA general daily value (2,000 kcal reference diet)</p>
        </>
      )}
    </div>
  );
}
