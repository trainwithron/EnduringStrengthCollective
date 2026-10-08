import { HEADLINE_KEYS, NUTRIENT_CATALOG } from "@/lib/nutrient-catalog";
import { formatNutrientAmount } from "@/lib/nutrient-panel";

// The vitamins and minerals in ONE logged food, right on its row in the log: the few that matter most in a line, every one a tap away. A nutrient the food does not report is
// "not reported" and never zero (the record may simply not carry it). A food with no nutrient detail at all (a quick calorie entry, a photo estimate) shows nothing here.
export type FoodNutrients = Record<string, number> | null | undefined;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function reportedCount(nutrients: FoodNutrients): { reported: number; total: number } {
  return { reported: NUTRIENT_CATALOG.filter((n) => nutrients != null && isNum(nutrients[n.key])).length, total: NUTRIENT_CATALOG.length };
}

// Up to `max` of the usual nutrients (the ones people most often fall short of) this food reports, in that order.
export function previewNutrients(nutrients: FoodNutrients, max = 4): { key: string; label: string; unit: string; amount: number }[] {
  if (!nutrients) return [];
  const out: { key: string; label: string; unit: string; amount: number }[] = [];
  for (const key of HEADLINE_KEYS) {
    const n = NUTRIENT_CATALOG.find((c) => c.key === key);
    const amount = nutrients[key];
    if (n && isNum(amount) && out.length < max) out.push({ key, label: n.label, unit: n.unit, amount });
  }
  return out;
}

export function FoodNutrientPanel({ nutrients }: { nutrients: FoodNutrients }) {
  const { reported, total } = reportedCount(nutrients);
  if (!nutrients || reported === 0) return null;
  const preview = previewNutrients(nutrients);
  return (
    <details className="mt-1" data-testid="food-nutrient-panel">
      <summary className="font-body text-xs text-steel cursor-pointer min-h-[44px] flex items-center">
        <span>
          Vitamins and minerals · {reported} of {total} reported
          {preview.length > 0 ? `: ${preview.map((p) => `${p.label} ${formatNutrientAmount(p.amount)} ${p.unit}`).join(" · ")}` : ""}
        </span>
      </summary>
      <ul className="divide-y divide-steel/15 border border-steel/15 mt-1">
        {NUTRIENT_CATALOG.map((n) => {
          const amount = nutrients[n.key];
          return (
            <li key={n.key} className="flex items-baseline justify-between gap-3 px-2 py-1.5">
              <span className="font-body text-xs text-chalk">{n.label}</span>
              <span className="font-body text-xs [font-variant-numeric:tabular-nums]">{isNum(amount) ? `${formatNutrientAmount(amount)} ${n.unit}` : <span className="text-steel">Not reported</span>}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
