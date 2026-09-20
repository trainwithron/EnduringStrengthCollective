// Calendar Spotter Phase 2 — data-orchestration layer (real Supabase
// queries, no unit tests of its own, same convention as
// lib/programming-spotter-gather.ts). Org/coach-scoped, distinct from
// lib/calendar-spotter-gather.ts's per-athlete attendance focus.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectRecurringScheduleGaps,
  detectUnevenTrainerLoad,
  detectBookedVsActualMismatch,
  type AvailabilityWindow,
} from "./calendar-spotter-phase2";

export interface SchedulingSpotterFlag {
  checkKind: "recurring_gap" | "uneven_load" | "duration_mismatch";
  patternKey: string;
  headline: string;
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LOOKBACK_DAYS_FOR_GAPS = 45; // covers the 6-week default lookback with room to spare
const LOOKBACK_DAYS_FOR_LOAD = 30;

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export async function gatherSchedulingSpotterFlags(
  supabase: SupabaseClient,
  params: { coachId: string; organizationId: string | null }
): Promise<SchedulingSpotterFlag[]> {
  const { coachId, organizationId } = params;
  const flags: SchedulingSpotterFlag[] = [];
  const now = new Date();

  const [{ data: windowRows }, { data: recentBookingRows }, { data: dismissalRows }] = await Promise.all([
    supabase
      .from("coach_availability_windows")
      .select("weekday, start_time, end_time")
      .eq("coach_id", coachId),
    supabase
      .from("bookings")
      .select("start_at, status")
      .eq("coach_id", coachId)
      .eq("status", "confirmed")
      .gte("start_at", new Date(now.getTime() - LOOKBACK_DAYS_FOR_GAPS * 86400000).toISOString())
      .lte("start_at", now.toISOString()),
    supabase.from("spotter_recommendation_feedback").select("dismissal_key, action, created_at").eq("coach_id", coachId).eq("spotter_kind", "calendar").order("created_at", { ascending: false }),
  ]);

  const dismissedKeys = new Set<string>();
  const feedbackByKey = new Map<string, { action: string }[]>();
  for (const row of dismissalRows ?? []) {
    const list = feedbackByKey.get(row.dismissal_key) ?? [];
    list.push({ action: row.action });
    feedbackByKey.set(row.dismissal_key, list);
  }
  // A pattern denied/edited 2+ of its last 3 times is suppressed here —
  // same escalating-suppress spirit as Programming Spotter's own
  // dismissal table, expressed inline since this Spotter's findings are
  // recomputed fresh every load rather than persisted rows to match
  // against.
  for (const [key, events] of feedbackByKey) {
    const recent = events.slice(0, 3);
    const negative = recent.filter((e) => e.action === "denied" || e.action === "edited").length;
    if (recent.length >= 3 && negative >= 2) dismissedKeys.add(key);
  }

  // --- Pattern 1: recurring schedule gaps ---
  const windows: AvailabilityWindow[] = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
  }));
  const gapBookings = (recentBookingRows ?? []).map((b) => ({ startAt: new Date(b.start_at) }));
  const gaps = detectRecurringScheduleGaps(windows, gapBookings, now, 6);
  for (const gap of gaps) {
    const patternKey = `${gap.weekday}-${gap.startTime}-${gap.endTime}`;
    if (dismissedKeys.has(`recurring_gap::${patternKey}`)) continue;
    flags.push({
      checkKind: "recurring_gap",
      patternKey,
      headline: `Your ${WEEKDAY_LABELS[gap.weekday]} ${formatTime(gap.startTime)}–${formatTime(gap.endTime)} slot has gone unbooked for ${gap.weeksChecked} straight weeks — real open capacity, or worth closing?`,
    });
  }

  // --- Pattern 2: uneven load across a multi-trainer org ---
  if (organizationId) {
    const { data: orgCoachRows } = await supabase
      .from("organization_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("organization_id", organizationId);
    const coachIds = (orgCoachRows ?? []).map((r) => r.profile_id);
    if (coachIds.length >= 2) {
      const since = new Date(now.getTime() - LOOKBACK_DAYS_FOR_LOAD * 86400000).toISOString();
      const { data: orgBookingRows } = await supabase
        .from("bookings")
        .select("coach_id, start_at, end_at")
        .in("coach_id", coachIds)
        .eq("status", "confirmed")
        .gte("start_at", since);

      const minutesByCoach = new Map<string, number>();
      for (const b of orgBookingRows ?? []) {
        const minutes = (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000;
        minutesByCoach.set(b.coach_id, (minutesByCoach.get(b.coach_id) ?? 0) + minutes);
      }
      const nameById = new Map((orgCoachRows ?? []).map((r) => [r.profile_id, (r.profiles as any)?.full_name ?? "A trainer"]));
      const loads = coachIds.map((id) => ({
        trainerId: id,
        trainerName: nameById.get(id) ?? "A trainer",
        bookedMinutes: minutesByCoach.get(id) ?? 0,
      }));
      const uneven = detectUnevenTrainerLoad(loads);
      if (uneven) {
        const patternKey = `${uneven.overloadedTrainerId}-${uneven.underloadedTrainerId}`;
        if (!dismissedKeys.has(`uneven_load::${patternKey}`)) {
          flags.push({
            checkKind: "uneven_load",
            patternKey,
            headline: `${uneven.overloadedTrainerName} has booked ${Math.round(uneven.overloadedMinutes / 60)}hrs over the last ${LOOKBACK_DAYS_FOR_LOAD} days — ${uneven.underloadedTrainerName} has ${Math.round(uneven.underloadedMinutes / 60)}hrs. Worth rebalancing new leads?`,
          });
        }
      }
    }
  }

  // --- Pattern 3: booked-vs-actual duration mismatch ---
  const { data: linkedSessionRows } = await supabase
    .from("athlete_sessions")
    .select("duration_seconds, bookings!inner ( start_at, end_at, coach_id )")
    .eq("bookings.coach_id", coachId)
    .not("duration_seconds", "is", null);

  const pairs = (linkedSessionRows ?? [])
    .map((row) => {
      const booking = (row as any).bookings;
      if (!booking) return null;
      const bookedMinutes = (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60000;
      const actualMinutes = (row.duration_seconds ?? 0) / 60;
      return { bookedMinutes, actualMinutes };
    })
    .filter((p): p is { bookedMinutes: number; actualMinutes: number } => p !== null);

  const mismatch = detectBookedVsActualMismatch(pairs);
  if (mismatch && !dismissedKeys.has("duration_mismatch::self")) {
    const roundedBooked = Math.round(mismatch.avgBookedMinutes);
    const roundedActual = Math.round(mismatch.avgActualMinutes);
    flags.push({
      checkKind: "duration_mismatch",
      patternKey: "self",
      headline: `Across your last ${mismatch.sampleSize} booked sessions, real sessions run ${mismatch.direction} than booked on average (${roundedActual} min actual vs. ${roundedBooked} min booked, real slots) — worth adjusting your default slot length?`,
    });
  }

  return flags;
}
