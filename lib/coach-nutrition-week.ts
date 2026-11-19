import type { SupabaseClient } from "@supabase/supabase-js";
import { readByIds } from "@/lib/read-by-ids";
import { resolveDayMacros, standingForDate, type StandingHistory, type StandingRow } from "@/lib/macro-resolution";
import { loadNameProtectedIds, type ProtectIds } from "@/lib/minor-names";
import { addDaysToKey } from "@/lib/date-key";
import { NOT_IMPORTED } from "@/lib/imported-food";

// The coach's Clients list on Nutrition (Ron, Nov 19 revamp: "This week" folds into the Clients list). Each client gets three plain facts about the last seven days: how many days they
// logged ("4 of 7"), on how many of those days their logged protein reached that day's protein target, and the date of their last log. Clients with no logs this week come first;
// there is no status, no "under" or "over". Read only.
// A client whose automatic suggestions are switched off (the safety switch), and anyone who is not a confirmed adult, is not compared with a target at all: only the days logged and
// the last log are shown. A client whose food tracking is off says so.
// "Today" is the coach's own calendar day for every client (the same day the rest of the Nutrition page uses).
export const WEEK_DAYS = 7;
export const MAX_ROWS = 300;

export interface WeekClient {
  id: string;
  groupId: string;
  fullName: string;
}

export interface WeekRow extends WeekClient {
  daysLogged: number;
  // Days this week whose logged protein reached that day's protein target. Null when no day this week had a protein target, or the client is not compared with one.
  proteinHitDays: number | null;
  lastLogDate: string | null;
  trackingOff: boolean;
}

export interface FoodRow {
  athlete_id: string;
  log_date: string;
  status?: string | null;
  protein_g: number | null;
}

const dayKey = (clientId: string, groupId: string, date: string) => `${clientId}|${groupId}|${date}`;

// Pure: put the week's reads together. A day with only skipped meals does not count as logged. A day's protein target is the day's own target, else its meal plan's, else the
// standing target in force that day (the order the client sees).
export function summarizeWeek(args: {
  clients: WeekClient[];
  food: FoodRow[];
  todayKey: string;
  // Keyed "clientId|groupId|date": a day's own protein target, else its meal plan's (only days that have one).
  dayProteinTargets?: Map<string, number | null>;
  // Keyed "clientId|groupId": a client in two groups has a target in each.
  histories?: Map<string, StandingHistory>;
  trackingOff?: Set<string>;
  // People not compared with a target: the safety switch, anyone who is not a confirmed adult, or "*" when that could not be told (then everyone: never the other way round).
  neutral?: Set<string>;
  // The last day logged BEFORE this week, for a client with nothing logged this week.
  lastLogBefore?: Map<string, string>;
}): WeekRow[] {
  const from = addDaysToKey(args.todayKey, -(WEEK_DAYS - 1));
  const protein = new Map<string, Map<string, number>>();
  for (const f of args.food) {
    if (f.status === "skipped" || f.log_date < from || f.log_date > args.todayKey) continue;
    const perDay = protein.get(f.athlete_id) ?? new Map<string, number>();
    perDay.set(f.log_date, (perDay.get(f.log_date) ?? 0) + (f.protein_g ?? 0));
    protein.set(f.athlete_id, perDay);
  }
  return args.clients.map((c): WeekRow => {
    const perDay = protein.get(c.id) ?? new Map<string, number>();
    const days = [...perDay.keys()].sort();
    const trackingOff = !!args.trackingOff?.has(`${c.id}|${c.groupId}`);
    const neutral = !!args.neutral?.has("*") || !!args.neutral?.has(c.id) || !!args.neutral?.has(`${c.id}|${c.groupId}`);
    let proteinHitDays: number | null = null;
    if (!neutral) {
      const history = args.histories?.get(`${c.id}|${c.groupId}`) ?? [];
      let anyTarget = false;
      let hit = 0;
      for (let i = 0; i < WEEK_DAYS; i++) {
        const d = addDaysToKey(from, i);
        const own = args.dayProteinTargets?.get(dayKey(c.id, c.groupId, d));
        const target = own != null ? own : standingForDate(history, d)?.protein_g ?? null;
        if (target == null || target <= 0) continue;
        anyTarget = true;
        const eaten = perDay.get(d);
        if (eaten != null && eaten >= target) hit += 1;
      }
      proteinHitDays = anyTarget ? hit : null;
    }
    return {
      ...c,
      daysLogged: days.length,
      proteinHitDays,
      lastLogDate: days.length > 0 ? days[days.length - 1] : args.lastLogBefore?.get(c.id) ?? null,
      trackingOff,
    };
  });
}

// The list order: clients with no logs this week first, then everyone by name.
export function orderForList(rows: WeekRow[]): WeekRow[] {
  return [...rows].sort((a, b) => Number(a.daysLogged > 0) - Number(b.daysLogged > 0) || a.fullName.localeCompare(b.fullName));
}

// "4 of 7 days logged" · "Protein target 3 of 7" · "Last log Nov 17": the three facts as the list shows them.
export function weekFacts(r: WeekRow, dateLabel: (key: string) => string): string[] {
  if (r.trackingOff) return ["Food tracking off", r.lastLogDate ? `Last log ${dateLabel(r.lastLogDate)}` : "No logs yet"];
  return [
    `${r.daysLogged} of ${WEEK_DAYS} days logged`,
    ...(r.proteinHitDays != null ? [`Protein target ${r.proteinHitDays} of ${WEEK_DAYS}`] : []),
    r.lastLogDate ? `Last log ${dateLabel(r.lastLogDate)}` : "No logs yet",
  ];
}

export interface LoadedWeek {
  rows: WeekRow[];
  total: number;
  failed: boolean;
}

// Only a database that does not have the flags table yet may be read as "nobody has switched it off"; any other failure to read it must not leave a flagged client compared.
const TABLE_MISSING = new Set(["42P01", "PGRST205"]);

interface HistoryDbRow {
  athlete_id: string;
  group_id: string;
  effective_from: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

// The reads, each over groups of 100 clients a page at a time (a coach may have hundreds). If any read the facts depend on fails, or is cut short, the list says so rather than
// showing clients wrongly as "no logs". Standing targets are read per client AND group, every dated row in order, so a client's other group never lends them its target.
export async function loadNutritionWeek(supabase: SupabaseClient, clients: WeekClient[], todayKey: string, protect: ProtectIds = loadNameProtectedIds): Promise<LoadedWeek> {
  if (clients.length === 0) return { rows: [], total: 0, failed: false };
  const ids = [...new Set(clients.map((c) => c.id))];
  const from = addDaysToKey(todayKey, -(WEEK_DAYS - 1));

  const probe = await supabase.from("client_nutrition_flags").select("profile_id").limit(1);
  const flagsMissing = !!probe.error && TABLE_MISSING.has((probe.error as { code?: string }).code ?? "");
  let flagsUnreadable = !!probe.error && !flagsMissing;

  // The food read is the client logging in the app: history a coach brought in from another app is left out (lib/imported-food.ts).
  const [food, memberships, flags, histories, legacy, dayRows, planRows, protectedIds] = await Promise.all([
    readByIds(ids, (g) => (a, b) => supabase.from("food_log_entries").select("id, athlete_id, log_date, status, protein_g").in("athlete_id", g).gte("log_date", from).lte("log_date", todayKey).or(NOT_IMPORTED).order("id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("group_memberships").select("id, profile_id, group_id, food_tracking_enabled, coach_sets_macros").in("profile_id", g).eq("role", "athlete").order("id").range(a, b)),
    flagsMissing || flagsUnreadable
      ? Promise.resolve({ rows: [], failed: false, truncated: false })
      : readByIds(ids, (g) => (a, b) => supabase.from("client_nutrition_flags").select("profile_id, group_id").eq("auto_off", true).in("profile_id", g).order("profile_id").order("group_id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("client_macro_target_history").select("athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g").in("athlete_id", g).order("athlete_id").order("group_id").order("effective_from").range(a, b)),
    // The single row that stood in before the history existed: used only for a client with no history row.
    readByIds(ids, (g) => (a, b) => supabase.from("client_macro_targets").select("athlete_id, group_id, calories, protein_g, carbs_g, fat_g, updated_at").in("athlete_id", g).order("athlete_id").order("group_id").range(a, b)),
    // A day's own target, and a day's meal plan target, this week.
    readByIds(ids, (g) => (a, b) => supabase.from("daily_macros").select("id, athlete_id, group_id, log_date, calories, protein_g, carbs_g, fat_g").in("athlete_id", g).gte("log_date", from).lte("log_date", todayKey).order("id").range(a, b)),
    readByIds(ids, (g) => (a, b) => supabase.from("meal_plans").select("id, athlete_id, group_id, log_date, macros").in("athlete_id", g).gte("log_date", from).lte("log_date", todayKey).order("id").range(a, b)),
    protect(ids),
  ]);
  if ([food, memberships, histories, legacy, dayRows, planRows].some((r) => r.failed || r.truncated)) return { rows: [], total: clients.length, failed: true };
  if (flags.failed || flags.truncated) flagsUnreadable = true;

  const byKey = new Map<string, StandingHistory>();
  for (const r of histories.rows as HistoryDbRow[]) {
    const key = `${r.athlete_id}|${r.group_id}`;
    const row: StandingRow = { effective_from: r.effective_from, calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g };
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  for (const r of legacy.rows as { athlete_id: string; group_id: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; updated_at: string | null }[]) {
    const key = `${r.athlete_id}|${r.group_id}`;
    if (!byKey.has(key)) byKey.set(key, [{ effective_from: r.updated_at ? r.updated_at.slice(0, 10) : "1970-01-01", calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g }]);
  }

  // A day's protein target from its own row, else from its meal plan (the standing target is worked out per day in summarizeWeek).
  const dayProteinTargets = new Map<string, number | null>();
  const plans = new Map<string, unknown>();
  for (const p of planRows.rows as { athlete_id: string; group_id: string; log_date: string; macros: unknown }[]) plans.set(dayKey(p.athlete_id, p.group_id, p.log_date), p.macros);
  const own = new Map<string, { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }>();
  for (const d of dayRows.rows as { athlete_id: string; group_id: string; log_date: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }[]) own.set(dayKey(d.athlete_id, d.group_id, d.log_date), d);
  for (const key of new Set([...plans.keys(), ...own.keys()])) {
    const resolved = resolveDayMacros(own.get(key) ?? null, (plans.get(key) ?? null) as Parameters<typeof resolveDayMacros>[1], null, null);
    if (resolved.target?.proteinG != null) dayProteinTargets.set(key, resolved.target.proteinG);
  }

  const trackingOff = new Set<string>();
  const neutral = new Set<string>(flagsUnreadable ? ["*"] : []);
  for (const m of memberships.rows as { profile_id: string; group_id: string; food_tracking_enabled: boolean | null; coach_sets_macros: boolean | null }[]) {
    if (m.food_tracking_enabled === false) trackingOff.add(`${m.profile_id}|${m.group_id}`);
    if (m.coach_sets_macros === false) neutral.add(`${m.profile_id}|${m.group_id}`);
  }
  for (const f of (flagsUnreadable ? [] : flags.rows) as { profile_id: string }[]) neutral.add(f.profile_id);
  for (const id of protectedIds) neutral.add(id);

  // The last log before this week, read only for a client who logged nothing this week (one row each).
  const logged = new Set((food.rows as FoodRow[]).filter((f) => f.status !== "skipped" && f.log_date >= from && f.log_date <= todayKey).map((f) => f.athlete_id));
  const idle = ids.filter((id) => !logged.has(id));
  const lastLogBefore = new Map<string, string>();
  let idleFailed = false;
  for (let i = 0; i < idle.length; i += 20) {
    const batch = idle.slice(i, i + 20);
    const results = await Promise.all(
      batch.map((id) => supabase.from("food_log_entries").select("log_date").eq("athlete_id", id).neq("status", "skipped").lt("log_date", from).or(NOT_IMPORTED).order("log_date", { ascending: false }).limit(1).maybeSingle())
    );
    results.forEach((r, j) => {
      if (r.error) idleFailed = true;
      else if (r.data?.log_date) lastLogBefore.set(batch[j], r.data.log_date as string);
    });
  }
  // A last-log date that could not be read is never shown as "No logs yet".
  if (idleFailed) return { rows: [], total: clients.length, failed: true };

  const all = orderForList(summarizeWeek({ clients, food: food.rows as FoodRow[], todayKey, dayProteinTargets, histories: byKey, trackingOff, neutral, lastLogBefore }));
  return { rows: all.slice(0, MAX_ROWS), total: all.length, failed: false };
}
