import type { SupabaseClient } from "@supabase/supabase-js";
import { readByIds } from "@/lib/read-by-ids";
import { chunk } from "@/lib/chunk";
import { fetchStandingHistories } from "@/lib/standing-macros";
import { standingForDate, type StandingHistory } from "@/lib/macro-resolution";
import { addDaysToKey } from "@/lib/date-key";

// "This week" on the coach's Nutrition page (Release B3): one row per client, the last seven days at a glance. What they are meant to eat (their standing target), what they actually logged (the days they logged,
// the average calories and protein of those days), where that sits against the target, and how their weight moved. The coach sees who is on track, who is off, and who logged nothing, and opens the one that needs them.
// Read only; nothing is changed or sent. A client whose food tracking is off, or who has no target yet, says so rather than showing a blank.
export const WEEK_DAYS = 7;
// Within this share of the target counts as on track (the same 10% the meal options are held to).
export const ON_TRACK_PCT = 0.1;
export const MAX_ROWS = 300;

export type WeekStatus = "over" | "under" | "nothing_logged" | "no_target" | "tracking_off" | "on_track";

export interface WeekClient {
  id: string;
  groupId: string;
  fullName: string;
}

export interface WeekRow extends WeekClient {
  status: WeekStatus;
  targetCalories: number | null;
  targetProteinG: number | null;
  daysLogged: number;
  avgCalories: number | null;
  avgProteinG: number | null;
  // Percent of the target, signed (-18 = 18% under).
  calorieGapPct: number | null;
  weightChange: number | null;
  weightUnit: "lb" | "kg";
  suggestionsOff: boolean;
}

export interface FoodRow {
  athlete_id: string;
  log_date: string;
  status?: string | null;
  calories: number | null;
  protein_g: number | null;
}

export interface WeightRow {
  athlete_id: string;
  logged_date: string;
  weight: number | null;
}

// Lower number sorts first: the ones that need the coach come before the ones that are fine.
const ORDER: Record<WeekStatus, number> = { nothing_logged: 0, under: 1, over: 2, no_target: 3, tracking_off: 4, on_track: 5 };

export function statusFor(args: { trackingOff: boolean; targetCalories: number | null; daysLogged: number; avgCalories: number | null }): { status: WeekStatus; gapPct: number | null } {
  if (args.trackingOff) return { status: "tracking_off", gapPct: null };
  if (args.targetCalories == null || args.targetCalories <= 0) return { status: "no_target", gapPct: null };
  if (args.daysLogged === 0 || args.avgCalories == null) return { status: "nothing_logged", gapPct: null };
  const gap = (args.avgCalories - args.targetCalories) / args.targetCalories;
  const gapPct = Math.round(gap * 100);
  if (gap > ON_TRACK_PCT) return { status: "over", gapPct };
  if (gap < -ON_TRACK_PCT) return { status: "under", gapPct };
  return { status: "on_track", gapPct };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Pure: put the week's reads together. A day with only skipped meals does not count as logged.
export function summarizeWeek(args: {
  clients: WeekClient[];
  food: FoodRow[];
  weights: WeightRow[];
  targets: Map<string, { calories: number | null; proteinG: number | null }>;
  trackingOff: Set<string>;
  suggestionsOff: Set<string>;
  weightUnits: Map<string, "lb" | "kg">;
}): WeekRow[] {
  const days = new Map<string, Map<string, { calories: number; protein: number }>>();
  for (const f of args.food) {
    if (f.status === "skipped") continue;
    const perDay = days.get(f.athlete_id) ?? new Map();
    const d = perDay.get(f.log_date) ?? { calories: 0, protein: 0 };
    d.calories += f.calories ?? 0;
    d.protein += f.protein_g ?? 0;
    perDay.set(f.log_date, d);
    days.set(f.athlete_id, perDay);
  }
  const weightsBy = new Map<string, WeightRow[]>();
  for (const w of args.weights) {
    if (w.weight == null) continue;
    const list = weightsBy.get(w.athlete_id) ?? [];
    list.push(w);
    weightsBy.set(w.athlete_id, list);
  }

  const rows = args.clients.map((c): WeekRow => {
    const perDay = days.get(c.id);
    const daysLogged = perDay?.size ?? 0;
    let avgCalories: number | null = null;
    let avgProtein: number | null = null;
    if (perDay && daysLogged > 0) {
      let cal = 0;
      let pro = 0;
      for (const d of perDay.values()) {
        cal += d.calories;
        pro += d.protein;
      }
      avgCalories = Math.round(cal / daysLogged);
      avgProtein = Math.round(pro / daysLogged);
    }
    const target = args.targets.get(`${c.id}|${c.groupId}`) ?? args.targets.get(c.id) ?? null;
    const { status, gapPct } = statusFor({ trackingOff: args.trackingOff.has(`${c.id}|${c.groupId}`), targetCalories: target?.calories ?? null, daysLogged, avgCalories });
    const unit = args.weightUnits.get(c.id) ?? "lb";
    const ws = (weightsBy.get(c.id) ?? []).slice().sort((a, b) => a.logged_date.localeCompare(b.logged_date));
    // Stored in pounds; shown in the client's own unit.
    const change = ws.length >= 2 ? (ws[ws.length - 1].weight as number) - (ws[0].weight as number) : null;
    const shown = change == null ? null : round1(unit === "kg" ? change * 0.45359237 : change);
    return {
      ...c,
      status,
      targetCalories: target?.calories ?? null,
      targetProteinG: target?.proteinG ?? null,
      daysLogged,
      avgCalories,
      avgProteinG: avgProtein,
      calorieGapPct: gapPct,
      weightChange: shown,
      weightUnit: unit,
      suggestionsOff: args.suggestionsOff.has(c.id) || args.suggestionsOff.has(`${c.id}|${c.groupId}`),
    };
  });
  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.fullName.localeCompare(b.fullName));
}

export interface LoadedWeek {
  rows: WeekRow[];
  total: number;
  failed: boolean;
}

// The reads for the table, each over groups of 100 clients a page at a time (a coach may have hundreds). If ANY read fails the table is reported as failed rather than shown with clients wrongly reading "logged nothing".
export async function loadNutritionWeek(supabase: SupabaseClient, clients: WeekClient[], todayKey: string): Promise<LoadedWeek> {
  if (clients.length === 0) return { rows: [], total: 0, failed: false };
  const ids = [...new Set(clients.map((c) => c.id))];
  const from = addDaysToKey(todayKey, -(WEEK_DAYS - 1));

  const [food, weights, memberships, units, flags] = await Promise.all([
    readByIds(ids, (g) => (a, b) => supabase.from("food_log_entries").select("id, athlete_id, log_date, status, calories, protein_g").in("athlete_id", g).gte("log_date", from).lte("log_date", todayKey).order("id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("body_weight_logs").select("id, athlete_id, logged_date, weight").in("athlete_id", g).gte("logged_date", from).lte("logged_date", todayKey).order("id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("group_memberships").select("id, profile_id, group_id, food_tracking_enabled, coach_sets_macros").in("profile_id", g).eq("role", "athlete").order("id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("athlete_profile_details").select("athlete_id, weight_unit").in("athlete_id", g).order("athlete_id").range(a, b)),
    // The coach-only "no automatic suggestions" note. A database without the table yet reads as none switched on.
    readByIds(ids, (g) => (a, b) => supabase.from("client_nutrition_flags").select("profile_id, group_id").eq("auto_off", true).in("profile_id", g).order("profile_id").order("group_id").range(a, b)),
  ]);
  if (food.failed || food.truncated || weights.failed || weights.truncated || memberships.failed || memberships.truncated || units.failed || units.truncated) return { rows: [], total: clients.length, failed: true };
  const flagRows = flags.failed ? [] : flags.rows;

  // Standing targets, in groups of 100 (the helper reads them in one request).
  const history = new Map<string, StandingHistory>();
  for (const part of chunk(ids, 100)) {
    for (const [id, h] of await fetchStandingHistories(supabase, part)) history.set(id, h);
  }
  const targets = new Map<string, { calories: number | null; proteinG: number | null }>();
  for (const id of ids) {
    const row = standingForDate(history.get(id), todayKey);
    if (row) targets.set(id, { calories: row.calories, proteinG: row.protein_g });
  }

  const trackingOff = new Set<string>();
  for (const m of memberships.rows as { profile_id: string; group_id: string; food_tracking_enabled: boolean | null }[]) {
    if (m.food_tracking_enabled === false) trackingOff.add(`${m.profile_id}|${m.group_id}`);
  }
  const suggestionsOff = new Set<string>();
  for (const f of flagRows as { profile_id: string }[]) suggestionsOff.add(f.profile_id);
  for (const m of memberships.rows as { profile_id: string; group_id: string; coach_sets_macros: boolean | null }[]) {
    if (m.coach_sets_macros === false) suggestionsOff.add(`${m.profile_id}|${m.group_id}`);
  }
  const weightUnits = new Map<string, "lb" | "kg">();
  for (const u of units.rows as { athlete_id: string; weight_unit: string | null }[]) weightUnits.set(u.athlete_id, u.weight_unit === "kg" ? "kg" : "lb");

  const all = summarizeWeek({ clients, food: food.rows as FoodRow[], weights: weights.rows as WeightRow[], targets, trackingOff, suggestionsOff, weightUnits });
  return { rows: all.slice(0, MAX_ROWS), total: all.length, failed: false };
}
