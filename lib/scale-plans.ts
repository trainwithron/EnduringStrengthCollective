import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";
import { addReports, describeScaleReport, emptyReport, plannedCalories, scalePlanRow, type MacroTargetsLike, type ScaleReport } from "@/lib/plan-scaling";

// "Scale my plan to the new target" (nutrition phase 6): every saved day from today on is scaled to the client's new calories, in one pass the coach starts with one tap.
// This file is the batch: which saved days are scaled, what is written back, and how the result is told. The scaling of a single day is lib/plan-scaling.ts.

export interface SavedPlanDay {
  log_date: string;
  macros: unknown;
  meals: unknown;
}

export interface PlanUpdate {
  log_date: string;
  macros: Record<string, unknown>;
  meals: Record<string, MealEntryPayload[]>;
}

export interface ProteinShort {
  date: string;
  // What the featured options of the day's meals add up to, and the day's protein target.
  deliveredG: number;
  targetG: number;
}

export interface ScalePlansResult {
  updates: PlanUpdate[];
  report: ScaleReport;
  // Days that were scaled.
  days: number;
  // Days left exactly as they were, and why.
  alreadyRight: number;
  unreadable: number;
  // Days whose change was too big to scale (a typo such as 220 for 2200 would otherwise squash every saved day).
  tooBig: number;
  // Scaled days whose meals fall clearly short of the new protein target (protein is held when calories are cut, but scaling cuts every food by the same share).
  proteinShort: ProteinShort[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// A day is scaled only for a change this size or smaller; beyond it the plan should be rebuilt, not stretched.
export const MIN_SCALE_RATIO = 0.5;
export const MAX_SCALE_RATIO = 1.6;
// More than this share under the protein target counts as a shortfall.
export const PROTEIN_SHORT_SHARE = 0.1;

// The protein the day's meals deliver, counting the FEATURED option of each meal (the one the client sees first). Null when any of them has no stored macros: unknown, not zero.
function deliveredProteinG(entries: MealEntryPayload[] | undefined): number | null {
  if (!entries || entries.length === 0) return null;
  let total = 0;
  for (const e of entries) {
    const choices = e.recipes ?? [];
    const featured = choices[e.featuredIndex ?? 0] ?? choices[0];
    const p = featured?.macros?.proteinG;
    if (typeof p !== "number" || !Number.isFinite(p)) return null;
    total += p;
  }
  return total;
}

// A tolerance of half a percent: a day already planned at the new number is not rewritten for a rounding difference.
const ALREADY_RIGHT = 0.005;

export function scalePlanDays(rows: SavedPlanDay[], target: MacroTargetsLike, opts: { metric?: boolean } = {}): ScalePlansResult {
  const updates: PlanUpdate[] = [];
  let report = emptyReport();
  let alreadyRight = 0;
  let unreadable = 0;
  let tooBig = 0;
  const proteinShort: ProteinShort[] = [];
  for (const row of rows) {
    if (!isRecord(row.macros) || !isRecord(row.meals)) {
      unreadable++;
      continue;
    }
    const planned = plannedCalories(row.macros);
    if (planned == null || !(planned > 0)) {
      unreadable++;
      continue;
    }
    const ratio = target.calories / planned;
    if (Math.abs(ratio - 1) < ALREADY_RIGHT) {
      alreadyRight++;
      continue;
    }
    if (ratio < MIN_SCALE_RATIO || ratio > MAX_SCALE_RATIO) {
      tooBig++;
      continue;
    }
    const input = { macros: row.macros, meals: row.meals as Record<string, MealEntryPayload[]> };
    let scaled = scalePlanRow(input, ratio, { metric: opts.metric, exactDaily: target });
    // The day's header must not promise protein the meals do not deliver: when they fall clearly short of the exact new target, the day keeps the scaled numbers (which match the meals) and the coach is told.
    const delivered = deliveredProteinG(scaled.meals.daily);
    if (delivered != null && target.protein > 0 && delivered < target.protein * (1 - PROTEIN_SHORT_SHARE)) {
      scaled = scalePlanRow(input, ratio, { metric: opts.metric });
      proteinShort.push({ date: row.log_date, deliveredG: Math.round(delivered), targetG: Math.round(target.protein) });
    }
    report = addReports(report, scaled.report);
    updates.push({ log_date: row.log_date, macros: scaled.macros, meals: scaled.meals });
  }
  return { updates, report, days: updates.length, alreadyRight, unreadable, tooBig, proteinShort };
}

// The one line the coach reads afterwards.
export function describeScalePlans(r: ScalePlansResult): string {
  const big =
    r.tooBig > 0
      ? `${r.tooBig} ${r.tooBig === 1 ? "day was" : "days were"} not scaled because the change is too big (more than about 50 percent down or 60 percent up). That is a big change: rebuild the plan instead of scaling it, and check the new target is what you meant.`
      : "";
  if (r.days === 0) {
    if (r.tooBig > 0) return `Nothing was scaled. ${big}`;
    if (r.alreadyRight > 0 && r.unreadable === 0) return "The saved plan days already match the new target. Nothing changed.";
    if (r.alreadyRight === 0 && r.unreadable === 0) return "There are no saved plan days from today on to scale.";
    return `Nothing was scaled: ${r.unreadable} saved ${r.unreadable === 1 ? "day was" : "days were"} in a form that cannot be scaled here${r.alreadyRight > 0 ? ` and ${r.alreadyRight} already matched` : ""}.`;
  }
  const parts = [describeScaleReport(r.report, r.days)];
  if (r.alreadyRight > 0) parts.push(`${r.alreadyRight} ${r.alreadyRight === 1 ? "day" : "days"} already matched and ${r.alreadyRight === 1 ? "was" : "were"} left alone.`);
  if (r.proteinShort.length > 0) {
    const low = Math.min(...r.proteinShort.map((d) => d.deliveredG));
    const high = Math.max(...r.proteinShort.map((d) => d.deliveredG));
    const n = r.proteinShort.length;
    parts.push(
      `On ${n} ${n === 1 ? "day" : "days"} the scaled meals give about ${low === high ? low : `${low} to ${high}`} g of protein against the ${r.proteinShort[0].targetG} g target, so ${n === 1 ? "that day shows" : "those days show"} what the meals deliver instead of the target. Rebuild ${n === 1 ? "it" : "them"} instead of scaling, or add protein.`
    );
  }
  if (big) parts.push(big);
  if (r.unreadable > 0) parts.push(`${r.unreadable} ${r.unreadable === 1 ? "day" : "days"} could not be read and ${r.unreadable === 1 ? "was" : "were"} left alone.`);
  return parts.join(" ");
}

// Reads the saved days from `fromKey` on and scales them. Writes only the two columns that change, one day at a time, and stops reporting success if any write fails (the days
// already written stay scaled; the rest are untouched, so running it again finishes the job).
export async function scaleSavedPlans(
  supabase: SupabaseClient,
  args: { athleteId: string; fromKey: string; target: MacroTargetsLike; metric?: boolean }
): Promise<{ ok: true; result: ScalePlansResult } | { ok: false; error: string; written: number }> {
  const { athleteId, fromKey, target, metric } = args;
  const { data, error } = await supabase
    .from("meal_plans")
    .select("log_date, macros, meals")
    .eq("athlete_id", athleteId)
    .gte("log_date", fromKey)
    .order("log_date", { ascending: true })
    .limit(400);
  if (error) return { ok: false, error: "Couldn't read the saved plan days.", written: 0 };
  const result = scalePlanDays((data ?? []) as SavedPlanDay[], target, { metric });
  let written = 0;
  for (const u of result.updates) {
    const { error: writeError } = await supabase.from("meal_plans").update({ macros: u.macros, meals: u.meals }).eq("athlete_id", athleteId).eq("log_date", u.log_date);
    if (writeError) return { ok: false, error: `Stopped after ${written} of ${result.updates.length} days: couldn't save ${u.log_date}. Run it again to finish.`, written };
    written++;
  }
  return { ok: true, result };
}
