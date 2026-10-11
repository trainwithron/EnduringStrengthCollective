import type { SupabaseClient } from "@supabase/supabase-js";
import { getActivePrograms, type ActiveProgram } from "@/lib/active-programs";
import { getTodaysSessions, type TodaysSessions } from "@/lib/todays-workout";
import { computeScheduledDates } from "@/lib/program-schedule";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { getWeekRange } from "@/lib/week-range";
import { resolveDayMacros, standingForDate } from "@/lib/macro-resolution";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { fetchFoodLogDay } from "@/lib/food-entry";

// What the coach's "View as client" preview shows. READ ONLY: every function here only selects. There is no insert, update, upsert, delete or rpc anywhere in this file (a source
// test holds that), and nothing here uses the act-as cookie: the client is named in the page's address and the page first checks the viewer coaches that client's group.

export interface PreviewHome {
  todays: TodaysSessions;
  doneThisWeek: number;
  timezone: string;
}

export async function loadHome(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<PreviewHome> {
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const week = getWeekRange(new Date());
  const [todays, { count }] = await Promise.all([
    getTodaysSessions(supabase, { groupId, athleteId }),
    supabase.from("workout_logs").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("group_id", groupId).gte("created_at", week.start.toISOString()).lte("created_at", week.end.toISOString()),
  ]);
  return { todays, doneThisWeek: count ?? 0, timezone };
}

export interface PreviewProgramDay {
  id: string;
  title: string;
  weekNumber: number;
  date: Date | null;
  done: boolean;
}
export interface PreviewProgram {
  program: ActiveProgram;
  days: PreviewProgramDay[];
}

export async function loadPrograms(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<PreviewProgram[]> {
  const programs = await getActivePrograms(supabase, groupId, athleteId);
  if (programs.length === 0) return [];
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, title, week_number, day_index, scheduled_date")
    .in("program_id", programs.map((p) => p.id))
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  const rows = (workouts ?? []) as { id: string; program_id: string; title: string; week_number: number; day_index: number; scheduled_date: string | null }[];
  const { data: logs } = rows.length
    ? await supabase.from("workout_logs").select("workout_id").eq("athlete_id", athleteId).in("workout_id", rows.map((r) => r.id))
    : { data: [] as { workout_id: string | null }[] };
  const doneIds = new Set(((logs ?? []) as { workout_id: string | null }[]).map((l) => l.workout_id).filter((x): x is string => !!x));
  return programs.map((program) => {
    const mine = rows.filter((r) => r.program_id === program.id);
    const dates =
      program.startDate && program.trainingDays && program.trainingDays.length > 0
        ? computeScheduledDates(program.startDate, program.trainingDays, mine.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date })))
        : new Map<string, Date>();
    return {
      program,
      days: mine.map((w) => ({ id: w.id, title: w.title, weekNumber: w.week_number, date: dates.get(w.id) ?? null, done: doneIds.has(w.id) })),
    };
  });
}

export interface PreviewLog {
  id: string;
  createdAt: string;
  title: string;
  volume: number | null;
  sets: number | null;
  prCount: number;
  loggedByCoach: boolean;
}

export async function loadHistory(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<PreviewLog[]> {
  const { data } = await supabase
    .from("workout_logs")
    .select("id, created_at, total_volume, total_sets_completed, new_prs, logged_by_coach, workouts ( title )")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(40);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    title: r.workouts?.title ?? "Workout",
    volume: r.total_volume ?? null,
    sets: r.total_sets_completed ?? null,
    prCount: Array.isArray(r.new_prs) ? r.new_prs.length : 0,
    loggedByCoach: !!r.logged_by_coach,
  }));
}

export interface PreviewCalendarItem {
  key: string;
  date: Date;
  label: string;
  detail: string;
}

// The next 28 days: what the client's programs schedule, and their booked sessions.
export async function loadCalendar(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<PreviewCalendarItem[]> {
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const start = new Date(`${todayKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 28);
  const items: PreviewCalendarItem[] = [];
  for (const { program, days } of await loadPrograms(supabase, groupId, athleteId)) {
    for (const d of days) {
      if (d.date && !d.done && d.date >= start && d.date < end) items.push({ key: `w-${d.id}`, date: d.date, label: d.title, detail: program.label ?? program.name });
    }
  }
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, start_at")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("status", "confirmed")
    .gte("start_at", start.toISOString())
    .lt("start_at", end.toISOString());
  for (const b of (bookings ?? []) as { id: string; start_at: string }[]) {
    const at = new Date(b.start_at);
    items.push({ key: `b-${b.id}`, date: at, label: "Session booked", detail: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }) });
  }
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---- Nutrition (read only): the same numbers the client's Nutrition tab reads. No AI call, no preferences or allergy data, no meal text: only the targets and what was logged. ----

export interface PreviewNutrition {
  // Today's target and where it comes from (a day the coach edited, the saved meal plan, or the standing target); null when the coach has set none.
  target: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
  entries: { id: string; description: string | null; calories: number | null }[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  recent: { date: string; calories: number }[];
  hasAnything: boolean;
}

export async function loadNutrition(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<PreviewNutrition> {
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const weekAgo = new Date(`${todayKey}T00:00:00`);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoKey = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, "0")}-${String(weekAgo.getDate()).padStart(2, "0")}`;

  const { data: membership } = await supabase.from("group_memberships").select("client_tier").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  // A client in the group tier has no macro targets (the same rule the client's own Nutrition tab uses).
  const macrosEnabled = ((membership as { client_tier?: string | null } | null)?.client_tier ?? null) !== "group";

  const [{ data: dailyRow }, { data: planRow }, standing, todayLog, { data: recentRows }] = await Promise.all([
    macrosEnabled ? supabase.from("daily_macros").select("calories, protein_g, carbs_g, fat_g").eq("athlete_id", athleteId).eq("log_date", todayKey).maybeSingle() : Promise.resolve({ data: null }),
    macrosEnabled ? supabase.from("meal_plans").select("meals, macros").eq("athlete_id", athleteId).eq("log_date", todayKey).maybeSingle() : Promise.resolve({ data: null }),
    macrosEnabled ? fetchStandingHistory(supabase, athleteId, groupId) : Promise.resolve([]),
    fetchFoodLogDay(supabase, athleteId, todayKey),
    supabase.from("food_log_entries").select("log_date, status, calories").eq("athlete_id", athleteId).gte("log_date", weekAgoKey).order("log_date", { ascending: true }),
  ]);

  const resolved = macrosEnabled
    ? resolveDayMacros(
        dailyRow as never,
        (planRow as { macros?: unknown } | null)?.macros as never,
        (planRow as { meals?: unknown } | null)?.meals as never,
        standingForDate(standing, todayKey) as never
      )
    : null;
  const target = resolved?.target ?? null;

  const counted = todayLog.filter((e) => e.status !== "skipped");
  const totals = counted.reduce(
    (t, e) => ({ calories: t.calories + (e.calories ?? 0), proteinG: t.proteinG + (e.proteinG ?? 0), carbsG: t.carbsG + (e.carbsG ?? 0), fatG: t.fatG + (e.fatG ?? 0) }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
  const byDate = new Map<string, number>();
  for (const r of (recentRows ?? []) as { log_date: string; status: string | null; calories: number | null }[]) {
    if (r.status === "skipped") continue;
    byDate.set(r.log_date, (byDate.get(r.log_date) ?? 0) + (r.calories ?? 0));
  }
  const recent = [...byDate.entries()].map(([date, calories]) => ({ date, calories })).sort((a, b) => b.date.localeCompare(a.date));

  return {
    target,
    entries: counted.map((e) => ({ id: e.id, description: e.description, calories: e.calories })),
    totals,
    recent,
    hasAnything: !!target || counted.length > 0 || recent.length > 0,
  };
}
