import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToKey, dateKeyInZone, getGroupCoachTimezone, zonedTimeToUtc } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { loadAssignedWorkouts, loadProgramDayContexts } from "@/lib/program-day-contexts";
import { dateKeyOf } from "@/lib/athlete-day-schedule";
import { rowToBodyProfile } from "@/lib/client-body-profile";
import { averageWeight, checkinWeekStart, weekKeys, type CheckinSnapshot } from "@/lib/weekly-checkin";

// The reads behind the weekly check-in (lib/weekly-checkin.ts has the rules). Every read is the signed-in person's own (row security decides what they see).

const MISSING = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);
/** A database without step 215 yet answers "no such table/column": read as nothing, not as a failure. */
export function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING.has(error.code);
}

// The client's own time zone when they set one, else their coach's (the week starts on Monday there).
export async function checkinTimezone(supabase: SupabaseClient, athleteId: string, groupId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", athleteId).maybeSingle();
  const own = (data as { timezone?: string | null } | null)?.timezone;
  if (isValidTimeZone(own)) return own;
  return getGroupCoachTimezone(supabase, groupId);
}

export function currentCheckinWeek(timeZone: string, now: Date = new Date()): string {
  return checkinWeekStart(dateKeyInZone(timeZone, now));
}

// The space's coach a check-in goes to: the first coach of the space who is not the client.
export async function checkinCoach(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", groupId).eq("role", "coach");
  const row = ((data ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).find((r) => r.profile_id !== athleteId);
  if (!row) return null;
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return { id: row.profile_id, name: (p?.full_name ?? "").trim() };
}

// The card filled in from the week's logs: workouts done of those planned on the calendar (a day the coach assigned a workout counts once, as Today does), the average
// weigh-in that week and the week before, and the days with food logged. A read that fails leaves its number at nothing, never the form.
export async function loadCheckinSnapshot(
  supabase: SupabaseClient,
  { athleteId, groupId, weekStart, timeZone }: { athleteId: string; groupId: string; weekStart: string; timeZone: string }
): Promise<CheckinSnapshot> {
  const days = weekKeys(weekStart);
  const weekEnd = days[6];
  const prevStart = addDaysToKey(weekStart, -7);
  const fromIso = zonedTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = zonedTimeToUtc(addDaysToKey(weekStart, 7), "00:00", timeZone).toISOString();

  const [done, planned, weights, prevWeights, food, unit] = await Promise.all([
    supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .then((r) => r.count ?? 0, () => 0),
    (async () => {
      try {
        const [contexts, assigned] = await Promise.all([loadProgramDayContexts(supabase, groupId, athleteId), loadAssignedWorkouts(supabase, athleteId, groupId, weekStart, weekEnd)]);
        let n = 0;
        for (const day of days) {
          if (assigned.has(day)) {
            n += 1;
            continue;
          }
          for (const c of contexts) if (!c.unscheduled) n += c.scheduled.filter((e) => dateKeyOf(e.date) === day).length;
        }
        return n;
      } catch {
        return 0;
      }
    })(),
    supabase.from("body_weight_logs").select("weight").eq("athlete_id", athleteId).eq("group_id", groupId).gte("logged_date", weekStart).lte("logged_date", weekEnd).then((r) => (r.data ?? []) as { weight: number | string }[], () => []),
    supabase.from("body_weight_logs").select("weight").eq("athlete_id", athleteId).eq("group_id", groupId).gte("logged_date", prevStart).lt("logged_date", weekStart).then((r) => (r.data ?? []) as { weight: number | string }[], () => []),
    supabase.from("food_log_entries").select("log_date, status").eq("athlete_id", athleteId).eq("group_id", groupId).gte("log_date", weekStart).lte("log_date", weekEnd).then((r) => (r.data ?? []) as { log_date: string; status: string }[], () => []),
    supabase.from("athlete_profile_details").select("weight_unit").eq("athlete_id", athleteId).maybeSingle().then((r) => rowToBodyProfile(r.data as Record<string, unknown> | null, null).weightUnit, () => "lb" as const),
  ]);

  return {
    workouts_done: done,
    workouts_planned: planned,
    avg_weight: averageWeight(weights.map((w) => w.weight)),
    prev_avg_weight: averageWeight(prevWeights.map((w) => w.weight)),
    weight_unit: unit === "kg" ? "kg" : "lb",
    food_days: new Set(food.filter((f) => f.status !== "skipped").map((f) => f.log_date)).size,
  };
}

export interface CheckinRow {
  id: string;
  group_id: string;
  athlete_id: string;
  coach_id: string | null;
  week_start: string;
  energy: number;
  eating: number;
  win: string | null;
  hard: string | null;
  photo_ids: string[] | null;
  auto_snapshot: unknown;
  submitted_at: string;
  reviewed_at: string | null;
}
export const CHECKIN_COLUMNS = "id, group_id, athlete_id, coach_id, week_start, energy, eating, win, hard, photo_ids, auto_snapshot, submitted_at, reviewed_at";

// This client's check-in for one week in one space (null: none yet, or a database without step 215).
export async function loadOwnCheckin(supabase: SupabaseClient, athleteId: string, groupId: string, weekStart: string): Promise<{ row: CheckinRow | null; available: boolean }> {
  const { data, error } = await supabase.from("weekly_checkins").select(CHECKIN_COLUMNS).eq("athlete_id", athleteId).eq("group_id", groupId).eq("week_start", weekStart).maybeSingle();
  if (error) return { row: null, available: !isMissingSchema(error) };
  return { row: (data as CheckinRow | null) ?? null, available: true };
}

// Short-lived links to the client's own progress photos sent with a check-in (only the ones the reader may see come back).
// Only the sender's own photos (Code Chat review, Nov 20): a check-in that lists another client's photo id never shows it.
export async function signedPhotoUrls(supabase: SupabaseClient, photoIds: string[], athleteId: string): Promise<{ id: string; url: string }[]> {
  if (photoIds.length === 0) return [];
  const { data } = await supabase.from("progress_photos").select("id, storage_path").in("id", photoIds).eq("athlete_id", athleteId);
  const rows = (data ?? []) as { id: string; storage_path: string }[];
  if (rows.length === 0) return [];
  const { data: signed } = await supabase.storage.from("progress-photos").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const byPath = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl as string]));
  return photoIds.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    const url = r ? byPath.get(r.storage_path) : undefined;
    return url ? [{ id, url }] : [];
  });
}
