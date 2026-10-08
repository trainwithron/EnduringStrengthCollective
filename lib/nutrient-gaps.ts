import type { DayTotals } from "@/lib/nutrient-day";

// A kind look at which nutrients have been on the low side lately, from what the person logged. It is information, never a diagnosis: it can only say "from the foods logged and
// reported, this has been low on most days we can see", and it says nothing at all when there is not enough to go on.
//
// A day counts for a nutrient only when it is a real day of eating (enough calories logged) AND at least 80 percent of that day's calories come from foods that report the nutrient (so
// the percent of the reference, which counts only the reporting foods, is close to the whole day and not a long way under it). A nutrient is "on the low side" when
// at least MIN_USABLE_DAYS days count and MORE THAN HALF of them are under GAP_BELOW_PCT of the reference intake.

export const GAP_BELOW_PCT = 67;
export const MIN_DAY_KCAL = 800;
export const MIN_DAY_COVERAGE_PCT = 80;
export const MIN_USABLE_DAYS = 4;

export type GapStatus = "gap" | "ok" | "not-enough-data";

export interface NutrientWindowSummary {
  key: string;
  status: GapStatus;
  usableDays: number;
  belowDays: number;
  // Average % of the reference intake over the days that count; null when none count.
  avgPct: number | null;
  // Days in the window with any food logged.
  loggedDays: number;
}

export const isUsableDay = (day: DayTotals, key: string): boolean => day.calories >= MIN_DAY_KCAL && (day.byKey[key]?.coveragePct ?? 0) >= MIN_DAY_COVERAGE_PCT && day.byKey[key]?.total != null;

export function percentOfTarget(total: number, target: number): number {
  return target > 0 ? (total / target) * 100 : 0;
}

export function summarizeNutrient(days: DayTotals[], key: string, target: number | null): NutrientWindowSummary {
  const loggedDays = days.filter((d) => d.entries > 0).length;
  if (target == null || !(target > 0)) return { key, status: "not-enough-data", usableDays: 0, belowDays: 0, avgPct: null, loggedDays };
  const pcts = days.filter((d) => isUsableDay(d, key)).map((d) => percentOfTarget(d.byKey[key].total as number, target));
  const below = pcts.filter((p) => p < GAP_BELOW_PCT).length;
  const avg = pcts.length === 0 ? null : Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  let status: GapStatus = "not-enough-data";
  if (pcts.length >= MIN_USABLE_DAYS) status = below > pcts.length / 2 ? "gap" : "ok";
  return { key, status, usableDays: pcts.length, belowDays: below, avgPct: avg, loggedDays };
}

// The gentle sentence for a nutrient that has been low. Never "deficient", never advice to supplement.
export function gapMessage(label: string, windowDays: number): string {
  return `${label} has looked on the low side on most of the days we can count in the last ${windowDays} days. This only reflects the foods you logged that report it, so it may be higher than it looks. A few of the foods below could help.`;
}

// For a coach: the same finding, worded about the client.
export function gapMessageForCoach(label: string, clientName: string, windowDays: number): string {
  return `${label} looks low for ${clientName} on most of the days we can count in the last ${windowDays} days. It reflects only the foods they logged that report it, so it is a prompt to ask, not a finding.`;
}

export const NOT_ENOUGH_DATA_LINE = "Not enough logged foods that report this yet to say anything about it.";

// Ranks the nutrients that are on the low side, lowest average first, and keeps the few worth mentioning.
export function topGaps(summaries: NutrientWindowSummary[], limit = 3): NutrientWindowSummary[] {
  return summaries
    .filter((s) => s.status === "gap")
    .sort((a, b) => (a.avgPct ?? 100) - (b.avgPct ?? 100))
    .slice(0, limit);
}
