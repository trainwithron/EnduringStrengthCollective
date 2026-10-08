import { checkTolerance, missScore } from "@/lib/meal-templates/tolerance";
import { caloriesOf, type Macros } from "@/lib/meal-templates/macros";
import { UNIT_WEIGHT_G, PER_UNIT_KEYS } from "@/lib/meal-templates";
import { isStructuredLine, type MealLine } from "@/lib/meal-line";
import { lineMacros, printLine } from "@/lib/meal-swap";
import type { MealRecipeChoice, MealEntryPayload } from "@/lib/meal-plan-assignment";

// "Just scale it" (nutrition phase 6): when the client is happy with their meal plan and only the calories changed, the saved plan is scaled to the new target instead of rebuilt.
// Every line's amount is multiplied by the same ratio (grams to the nearest 5, whole foods such as eggs and slices to the nearest whole one and never fewer than one), the meal's macros
// are recomputed from the new amounts and checked against the new slot target with the SAME tolerance as a freshly built meal. A meal that no longer lands inside it is dropped when the
// slot still has others; a slot where none lands keeps its best one and is reported so the coach can rebuild it. Options whose lines carry no amounts (a coach's own recipe, an AI option,
// an older plan) cannot be scaled here: they are left exactly as they were and reported. Pure: no database, no AI, no credit.

export interface MacroTargetsLike {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface PlanRowLike {
  macros: Record<string, unknown>;
  meals: Record<string, MealEntryPayload[]>;
}

export interface ScaleReport {
  optionsScaled: number;
  // Options that cannot be scaled here (no stored amounts) and were left as they were.
  optionsLeftAlone: number;
  // Scaled options that no longer fit the new slot target, removed because the slot had others that do.
  optionsDropped: number;
  // Slots where nothing scaled fits: the best one was kept and the coach should rebuild the slot.
  slotsToRebuild: number;
}

export const emptyReport = (): ScaleReport => ({ optionsScaled: 0, optionsLeftAlone: 0, optionsDropped: 0, slotsToRebuild: 0 });
export const addReports = (a: ScaleReport, b: ScaleReport): ScaleReport => ({
  optionsScaled: a.optionsScaled + b.optionsScaled,
  optionsLeftAlone: a.optionsLeftAlone + b.optionsLeftAlone,
  optionsDropped: a.optionsDropped + b.optionsDropped,
  slotsToRebuild: a.slotsToRebuild + b.slotsToRebuild,
});

const round5 = (g: number) => Math.max(5, Math.round(g / 5) * 5);

// The amount of one line after scaling by `ratio`.
export function scaledQty(line: { foodKey: string; qty: number; unit: string }, ratio: number): number {
  const raw = line.qty * ratio;
  const wholeUnit = line.unit !== "g" || PER_UNIT_KEYS.has(line.foodKey as never);
  return wholeUnit ? Math.max(1, Math.round(raw)) : round5(raw);
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// One saved option scaled by `ratio`, or null when it cannot be (a line without stored amounts).
export function scaleChoice(choice: MealRecipeChoice, ratio: number, metric = false): { choice: MealRecipeChoice; macros: Macros } | null {
  const lines = choice.lines ?? [];
  if (lines.length === 0 || !lines.every((l) => isStructuredLine(l))) return null;
  const ingredients = [...choice.ingredients];
  const newLines: MealLine[] = [];
  const taken = new Set<number>();
  for (const line of lines) {
    if (!isStructuredLine(line)) return null;
    const qty = scaledQty(line, ratio);
    const text = printLine(line.name, qty, line.unit, metric);
    let at = ingredients.findIndex((s, i) => s === line.text && !taken.has(i));
    if (at < 0) at = ingredients.findIndex((s, i) => !taken.has(i) && plain(s).toLowerCase().startsWith(line.label.toLowerCase()));
    if (at < 0) return null;
    taken.add(at);
    ingredients[at] = text;
    const grams = PER_UNIT_KEYS.has(line.foodKey as never) ? null : line.unit === "g" ? qty : line.unit === "pieces" ? qty * UNIT_WEIGHT_G.pieces : null;
    newLines.push({ ...line, qty, text, grams });
  }
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const l of newLines) {
    const m = lineMacros(l);
    if (!m) return null;
    proteinG += m.proteinG;
    carbsG += m.carbsG;
    fatG += m.fatG;
  }
  const macros: Macros = { proteinG, carbsG, fatG, calories: caloriesOf(proteinG, carbsG, fatG) };
  const rounded = { proteinG: Math.round(proteinG), carbsG: Math.round(carbsG), fatG: Math.round(fatG), calories: Math.round(caloriesOf(proteinG, carbsG, fatG)) };
  return { choice: { ...choice, ingredients, lines: newLines, macros: rounded }, macros };
}

// One meal slot scaled: its targets by `ratio`, each option scaled and checked, the failing ones dropped when others remain.
export function scaleEntry(entry: MealEntryPayload, ratio: number, metric = false): { entry: MealEntryPayload; report: ScaleReport } {
  const report = emptyReport();
  const choices = entry.recipes ?? [];
  const target = { proteinG: entry.proteinTarget * ratio, carbsG: entry.carbsTarget * ratio, fatG: entry.fatTarget * ratio };
  type Item = { choice: MealRecipeChoice; scaled: boolean; ok: boolean; score: number; wasFeatured: boolean };
  const featuredAt = entry.featuredIndex ?? 0;
  const items: Item[] = choices.map((c, i) => {
    const s = scaleChoice(c, ratio, metric);
    if (!s) return { choice: c, scaled: false, ok: true, score: 0, wasFeatured: i === featuredAt };
    const ok = checkTolerance(s.macros, target).ok;
    return { choice: s.choice, scaled: true, ok, score: missScore(s.macros, target), wasFeatured: i === featuredAt };
  });
  report.optionsLeftAlone = items.filter((i) => !i.scaled).length;
  const passing = items.filter((i) => i.scaled && i.ok);
  const failing = items.filter((i) => i.scaled && !i.ok);
  let kept: Item[];
  if (passing.length > 0 || items.some((i) => !i.scaled)) {
    kept = items.filter((i) => !i.scaled || i.ok);
    report.optionsDropped = failing.length;
    report.optionsScaled = passing.length;
  } else if (failing.length > 0) {
    // Nothing scaled fits: keep the single best so the slot is not empty, and say the slot needs rebuilding.
    const best = [...failing].sort((a, b) => a.score - b.score)[0];
    kept = [best];
    report.optionsDropped = failing.length - 1;
    report.optionsScaled = 1;
    report.slotsToRebuild = 1;
  } else kept = items;
  const featured = kept.findIndex((i) => i.wasFeatured);
  const { featuredIndex: _drop, ...rest } = entry;
  void _drop;
  return {
    entry: {
      ...rest,
      proteinTarget: Math.round(target.proteinG),
      carbsTarget: Math.round(target.carbsG),
      fatTarget: Math.round(target.fatG),
      recipes: kept.map((i) => i.choice),
      ...(featured > 0 ? { featuredIndex: featured } : {}),
    },
    report,
  };
}

// The calories a saved day was planned for (its daily menu, or the average of its training and rest menus).
export function plannedCalories(macros: Record<string, unknown>): number | null {
  const cal = (k: string) => {
    const m = macros?.[k] as { calories?: unknown } | undefined;
    return typeof m?.calories === "number" && m.calories > 0 ? m.calories : null;
  };
  const daily = cal("daily");
  if (daily != null) return daily;
  const t = cal("train");
  const r = cal("rest");
  if (t != null && r != null) return (t + r) / 2;
  return t ?? r;
}

// A whole saved day scaled by `ratio`: every menu in it, and the day's macro targets. exactDaily (the new standing target) replaces a daily day's macros exactly instead of by the ratio.
export function scalePlanRow(row: PlanRowLike, ratio: number, opts: { metric?: boolean; exactDaily?: MacroTargetsLike } = {}): { macros: Record<string, unknown>; meals: Record<string, MealEntryPayload[]>; report: ScaleReport } {
  let report = emptyReport();
  const meals: Record<string, MealEntryPayload[]> = {};
  for (const [bucket, entries] of Object.entries(row.meals)) {
    meals[bucket] = (entries ?? []).map((e) => {
      const r = scaleEntry(e, ratio, opts.metric);
      report = addReports(report, r.report);
      return r.entry;
    });
  }
  const macros: Record<string, unknown> = { ...row.macros };
  for (const [k, v] of Object.entries(row.macros)) {
    const m = v as Partial<MacroTargetsLike> | undefined;
    if (!m || typeof m.calories !== "number") continue;
    macros[k] = k === "daily" && opts.exactDaily ? { ...m, ...opts.exactDaily } : { ...m, calories: Math.round(m.calories * ratio), protein: Math.round((m.protein ?? 0) * ratio), carbs: Math.round((m.carbs ?? 0) * ratio), fats: Math.round((m.fats ?? 0) * ratio) };
  }
  return { macros, meals, report };
}

export function describeScaleReport(r: ScaleReport, days: number): string {
  const parts = [`Scaled ${r.optionsScaled} ${r.optionsScaled === 1 ? "meal" : "meals"} across ${days} ${days === 1 ? "day" : "days"} to the new target.`];
  if (r.optionsDropped > 0) parts.push(`${r.optionsDropped} ${r.optionsDropped === 1 ? "option" : "options"} no longer fit and ${r.optionsDropped === 1 ? "was" : "were"} removed.`);
  if (r.slotsToRebuild > 0) parts.push(`${r.slotsToRebuild} ${r.slotsToRebuild === 1 ? "meal slot has" : "meal slots have"} no option that fits any more: rebuild ${r.slotsToRebuild === 1 ? "it" : "them"} from the Meal plan.`);
  if (r.optionsLeftAlone > 0) parts.push(`${r.optionsLeftAlone} ${r.optionsLeftAlone === 1 ? "option" : "options"} (your own recipes or AI meals saved without amounts) could not be scaled here and ${r.optionsLeftAlone === 1 ? "was" : "were"} left as they were.`);
  return parts.join(" ");
}
