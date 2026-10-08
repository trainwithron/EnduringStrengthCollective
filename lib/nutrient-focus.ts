import { HEADLINE_KEYS } from "@/lib/nutrient-catalog";
import type { NutrientRow, Overview } from "@/lib/nutrient-view";

// Which vitamins and minerals the food log shows first. Few by default (a short list reads at a glance on a phone), all of them one tap away, grouped.
// Order of the short list: the nutrients that have been on the low side lately ("worth a look") first; then, from the usual ones people fall short of, the ones logged food reports
// that are furthest from the reference today; then the remaining usual ones in their normal order (shown as "not reported" when no logged food has them). Pure.

export const FOCUS_COUNT = 5;

const HEADLINE = new Set<string>(HEADLINE_KEYS);

export function focusRows(o: Overview, max: number = FOCUS_COUNT): NutrientRow[] {
  const targets = o.rows.filter((r) => r.nutrient.role === "target");
  const picked: NutrientRow[] = [];
  const has = (r: NutrientRow) => picked.some((p) => p.nutrient.key === r.nutrient.key);
  const add = (r: NutrientRow) => {
    if (picked.length < max && !has(r)) picked.push(r);
  };
  for (const g of o.gaps) add(g);
  const reportedHeadline = targets
    .filter((r) => HEADLINE.has(r.nutrient.key) && r.total != null && r.pct != null)
    .sort((a, b) => (a.pct as number) - (b.pct as number));
  for (const r of reportedHeadline) add(r);
  for (const key of HEADLINE_KEYS) {
    const r = targets.find((x) => x.nutrient.key === key);
    if (r) add(r);
  }
  return picked;
}

export interface RowGroup {
  key: "vitamin" | "mineral" | "other";
  label: string;
  rows: NutrientRow[];
}

// Every nutrient, in groups, in the catalog's own order. "other" is fiber, choline and saturated fat.
export function groupRows(o: Overview): RowGroup[] {
  const groups: RowGroup[] = [
    { key: "vitamin", label: "Vitamins", rows: [] },
    { key: "mineral", label: "Minerals", rows: [] },
    { key: "other", label: "Fiber, fats and other", rows: [] },
  ];
  for (const r of o.rows) groups.find((g) => g.key === r.nutrient.group)!.rows.push(r);
  return groups.filter((g) => g.rows.length > 0);
}
