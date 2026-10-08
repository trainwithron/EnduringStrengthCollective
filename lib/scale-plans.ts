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

export interface ScalePlansResult {
  updates: PlanUpdate[];
  report: ScaleReport;
  // Days that were scaled.
  days: number;
  // Days left exactly as they were, and why.
  alreadyRight: number;
  unreadable: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// A tolerance of half a percent: a day already planned at the new number is not rewritten for a rounding difference.
const ALREADY_RIGHT = 0.005;

export function scalePlanDays(rows: SavedPlanDay[], target: MacroTargetsLike, opts: { metric?: boolean } = {}): ScalePlansResult {
  const updates: PlanUpdate[] = [];
  let report = emptyReport();
  let alreadyRight = 0;
  let unreadable = 0;
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
    const scaled = scalePlanRow({ macros: row.macros, meals: row.meals as Record<string, MealEntryPayload[]> }, ratio, { metric: opts.metric, exactDaily: target });
    report = addReports(report, scaled.report);
    updates.push({ log_date: row.log_date, macros: scaled.macros, meals: scaled.meals });
  }
  return { updates, report, days: updates.length, alreadyRight, unreadable };
}

// The one line the coach reads afterwards.
export function describeScalePlans(r: ScalePlansResult): string {
  if (r.days === 0) {
    if (r.alreadyRight > 0 && r.unreadable === 0) return "The saved plan days already match the new target. Nothing changed.";
    if (r.alreadyRight === 0 && r.unreadable === 0) return "There are no saved plan days from today on to scale.";
    return `Nothing was scaled: ${r.unreadable} saved ${r.unreadable === 1 ? "day was" : "days were"} in a form that cannot be scaled here${r.alreadyRight > 0 ? ` and ${r.alreadyRight} already matched` : ""}.`;
  }
  const parts = [describeScaleReport(r.report, r.days)];
  if (r.alreadyRight > 0) parts.push(`${r.alreadyRight} ${r.alreadyRight === 1 ? "day" : "days"} already matched and ${r.alreadyRight === 1 ? "was" : "were"} left alone.`);
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
