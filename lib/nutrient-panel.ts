import { KEY_12_NUTRIENTS } from "@/lib/nutrient-keys";
import type { NutrientMap } from "@/lib/food-serving";

// The rows of the nutrient panel shown before a food is added: the four macros, then every nutrient we track, each with the amount for the serving or "not reported" when
// the food's record does not carry that nutrient (never a zero, which would claim the food has none).

export interface PanelRow {
  key: string;
  label: string;
  unit: string;
  // Null means the food does not report it.
  amount: number | null;
}

const MACRO_ROWS: { key: string; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carbs_g", label: "Carbohydrate", unit: "g" },
  { key: "fat_g", label: "Fat", unit: "g" },
];

export function panelRows(nutrients: NutrientMap): PanelRow[] {
  const defs = [...MACRO_ROWS, ...KEY_12_NUTRIENTS.map((n) => ({ key: n.key, label: n.label, unit: n.unit }))];
  return defs.map((d) => ({ ...d, amount: typeof nutrients[d.key] === "number" ? nutrients[d.key] : null }));
}

// Amounts as people read them: no decimals for hundreds, one for tens, two below that.
export function formatNutrientAmount(amount: number): string {
  if (amount >= 100) return Math.round(amount).toString();
  if (amount >= 10) return (Math.round(amount * 10) / 10).toString();
  return (Math.round(amount * 100) / 100).toString();
}

// "12 of the 16 nutrients are reported for this food": how complete the record is, so a low number is visible rather than silently looking like a low-nutrient food.
export function completeness(rows: PanelRow[]): { reported: number; total: number } {
  return { reported: rows.filter((r) => r.amount != null).length, total: rows.length };
}
