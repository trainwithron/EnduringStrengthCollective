import { NUTRIENT_CATALOG, catalogNutrient, type CatalogNutrient } from "@/lib/nutrient-catalog";
import { assumptionNote, referenceFor, type Reference } from "@/lib/dri";
import type { Sex } from "@/lib/dri-data";
import { checkLines, type FoodRules } from "@/lib/allergen-check";
import { dayTotals, detailShare, topSources, windowTotals, type DayTotals, type LoggedEntry, type SourceShare } from "@/lib/nutrient-day";
import { isUsableDay, percentOfTarget, summarizeNutrient, topGaps, type NutrientWindowSummary } from "@/lib/nutrient-gaps";

// Turns a client's food log into what the nutrient screens show: today against the reference intake, the few nutrients that have been on the low side lately, and for one
// nutrient the last 7 and 30 days, where it came from, and everyday foods that could help (checked against the client's allergies and food rules). Pure: the page passes in the
// log, the age and sex, and the rules, so everything here is tested without a database. Nothing is sent to the AI.

export const GAP_WINDOW_DAYS = 14;

const KEYS = NUTRIENT_CATALOG.map((n) => n.key);

// The dates ending on `todayKey` (inclusive), oldest first.
export function datesEndingOn(todayKey: string, n: number): string[] {
  const [y, m, d] = todayKey.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(base - (n - 1 - i) * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  });
}

export interface NutrientRow {
  nutrient: CatalogNutrient;
  ref: Reference | null;
  // Today's total from the foods that report it, or null (never 0) when nothing logged does.
  total: number | null;
  // Today's total as a percent of the reference intake; null when either is unknown.
  pct: number | null;
  // Share of today's calories from foods that report this nutrient.
  coveragePct: number;
  summary: NutrientWindowSummary;
  // True when any food logged in the last 30 days reported it.
  seenRecently: boolean;
}

export interface Overview {
  rows: NutrientRow[];
  gaps: NutrientRow[];
  todayCalories: number;
  todayEntries: number;
  // How many of today's logged foods carry nutrient detail beyond the macros.
  detail: { detailed: number; total: number };
  assumption: string | null;
}

export function buildOverview(args: { entries: LoggedEntry[]; todayKey: string; age: number | null; sex: Sex | null }): Overview {
  const { entries, todayKey, age, sex } = args;
  const today = dayTotals(todayKey, entries, KEYS);
  const window = windowTotals(datesEndingOn(todayKey, GAP_WINDOW_DAYS), entries, KEYS);
  const month = windowTotals(datesEndingOn(todayKey, 30), entries, KEYS);
  const rows: NutrientRow[] = NUTRIENT_CATALOG.map((nutrient) => {
    const ref = referenceFor(nutrient.key, age, sex);
    const t = today.byKey[nutrient.key];
    const target = nutrient.role === "target" ? ref?.target ?? null : null;
    return {
      nutrient,
      ref,
      total: t.total,
      pct: t.total != null && target != null ? Math.round(percentOfTarget(t.total, target)) : null,
      coveragePct: t.coveragePct,
      summary: summarizeNutrient(window, nutrient.key, target),
      seenRecently: month.some((d) => d.byKey[nutrient.key].total != null),
    };
  });
  const firstRef = rows.find((r) => r.ref)?.ref ?? referenceFor("calcium_mg", age, sex);
  return {
    rows,
    gaps: topGaps(rows.map((r) => r.summary), 3).map((s) => rows.find((r) => r.nutrient.key === s.key) as NutrientRow),
    todayCalories: today.calories,
    todayEntries: today.entries,
    detail: detailShare(entries, todayKey),
    assumption: firstRef ? assumptionNote(firstRef) : null,
  };
}

export interface DayBar {
  date: string;
  total: number | null;
  pct: number | null;
  coveragePct: number;
  // Whether the day has enough logged and enough detail to count (see lib/nutrient-gaps.ts).
  counts: boolean;
}

const bars = (days: DayTotals[], key: string, target: number | null): DayBar[] =>
  days.map((d) => {
    const n = d.byKey[key];
    return { date: d.date, total: n.total, pct: n.total != null && target != null ? Math.round(percentOfTarget(n.total, target)) : null, coveragePct: n.coveragePct, counts: isUsableDay(d, key) };
  });

export interface Detail {
  nutrient: CatalogNutrient;
  ref: Reference | null;
  target: number | null;
  today: DayBar;
  last7: DayBar[];
  last30: DayBar[];
  // Average % of the reference over the days that count, for each window; null when none count.
  avg7: number | null;
  avg30: number | null;
  summary: NutrientWindowSummary;
  sources: SourceShare[];
  // Everyday foods that could help, safe for this person; empty with a reason when none can be shown.
  ideas: { foods: string[]; hiddenReason: "no-rules" | "diet" | null };
  assumption: string | null;
}

// Diets the idea lists are not written for.
const IDEAS_NOT_FOR = new Set(["keto", "carnivore", "paleo"]);

// Foods from the nutrient's list that break none of the person's allergies, intolerances, dislikes or diet. With no rules to check against (the preferences could not be read) nothing
// is suggested: it fails closed, like the meal plans do.
export function safeIdeas(nutrient: CatalogNutrient, rules: FoodRules | null): { foods: string[]; hiddenReason: "no-rules" | "diet" | null } {
  if (nutrient.goodSources.length === 0) return { foods: [], hiddenReason: null };
  if (!rules) return { foods: [], hiddenReason: "no-rules" };
  if (rules.dietType && IDEAS_NOT_FOR.has(rules.dietType)) return { foods: [], hiddenReason: "diet" };
  const blocked = new Set(checkLines(nutrient.goodSources, rules).map((h) => h.line));
  return { foods: nutrient.goodSources.filter((f) => !blocked.has(f)), hiddenReason: null };
}

export function buildDetail(args: { key: string; entries: LoggedEntry[]; todayKey: string; age: number | null; sex: Sex | null; rules: FoodRules | null }): Detail | null {
  const nutrient = catalogNutrient(args.key);
  if (!nutrient) return null;
  const ref = referenceFor(nutrient.key, args.age, args.sex);
  const target = nutrient.role === "target" ? ref?.target ?? null : null;
  const d7 = windowTotals(datesEndingOn(args.todayKey, 7), args.entries, [nutrient.key]);
  const d30 = windowTotals(datesEndingOn(args.todayKey, 30), args.entries, [nutrient.key]);
  const d14 = windowTotals(datesEndingOn(args.todayKey, GAP_WINDOW_DAYS), args.entries, [nutrient.key]);
  const last7 = bars(d7, nutrient.key, target);
  const last30 = bars(d30, nutrient.key, target);
  const avg = (b: DayBar[]): number | null => {
    const used = b.filter((x) => x.counts && x.pct != null);
    return used.length === 0 ? null : Math.round(used.reduce((s, x) => s + (x.pct as number), 0) / used.length);
  };
  const since30 = new Set(d30.map((d) => d.date));
  return {
    nutrient,
    ref,
    target,
    today: last7[last7.length - 1],
    last7,
    last30,
    avg7: avg(last7),
    avg30: avg(last30),
    summary: summarizeNutrient(d14, nutrient.key, target),
    sources: topSources(args.entries.filter((e) => since30.has(e.logDate)), nutrient.key, 5),
    ideas: safeIdeas(nutrient, args.rules),
    assumption: ref ? assumptionNote(ref) : null,
  };
}

// "Reported for 62% of today's food": the completeness line, so a low figure from a mostly-unreported day is visibly partial.
export function completenessLine(coveragePct: number, entries: number): string | null {
  if (entries === 0) return null;
  if (coveragePct >= 99.5) return "Reported by everything you logged today.";
  if (coveragePct <= 0) return "None of the foods you logged today report this.";
  return `Reported by foods making up about ${Math.round(coveragePct)}% of today's calories.`;
}
