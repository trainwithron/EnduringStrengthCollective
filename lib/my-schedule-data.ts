import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimezone } from "@/lib/format-in-timezone";
import type { RequestForUi, SeriesForUi } from "@/lib/schedule-request-ui";

// What "My schedule" and the Home card read for one client in one group. Everything is read with the client's own session (row security shows them only their own
// schedules and requests). Before the database update that adds schedule requests is applied, the new columns and table are simply missing: the page then shows the
// schedule without any buttons, never an error.
export interface ScheduleItemData {
  series: SeriesForUi;
  nextSessionLabel: string | null;
  requests: RequestForUi[];
}

export interface MyScheduleData {
  items: ScheduleItemData[];
  requestsAvailable: boolean;
}

export async function loadMySchedule(supabase: SupabaseClient, groupId: string, athleteId: string, now: Date = new Date()): Promise<MyScheduleData> {
  const columns = "id, weekday, start_time, duration_minutes, status, timezone, ends_on";
  let seriesResult = await supabase
    .from("recurring_booking_series")
    .select(`${columns}, frozen_until`)
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .in("status", ["active", "paused", "ended"])
    .order("created_at", { ascending: false });
  if (seriesResult.error) {
    seriesResult = (await supabase
      .from("recurring_booking_series")
      .select(columns)
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .in("status", ["active", "paused", "ended"])
      .order("created_at", { ascending: false })) as typeof seriesResult;
  }
  const rows = ((seriesResult.data ?? []) as any[]).map(
    (r): SeriesForUi => ({
      id: r.id,
      weekday: r.weekday,
      startTime: String(r.start_time ?? "").slice(0, 5),
      durationMinutes: r.duration_minutes,
      status: r.status,
      timezone: r.timezone ?? null,
      frozenUntil: r.frozen_until ?? null,
      endsOn: r.ends_on ?? null,
    })
  );
  // Running and paused schedules; an ended one only when nothing else is left (then it reads "Ended <date>").
  const running = rows.filter((s) => s.status !== "ended");
  const shown = running.length > 0 ? running : rows.slice(0, 1);
  if (shown.length === 0) return { items: [], requestsAvailable: true };

  const requestResult = await supabase
    .from("schedule_requests")
    .select("id, series_id, kind, effective_on, resume_on, status, created_at, applied_at, applied_early")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(30);
  const requestsAvailable = !requestResult.error;
  const requests = ((requestResult.data ?? []) as any[]).map(
    (r): RequestForUi => ({
      id: r.id,
      seriesId: r.series_id,
      kind: r.kind,
      effectiveOn: r.effective_on,
      resumeOn: r.resume_on ?? null,
      status: r.status,
      createdAt: r.created_at,
      appliedAt: r.applied_at ?? null,
      appliedEarly: !!r.applied_early,
    })
  );

  const items: ScheduleItemData[] = [];
  for (const series of shown) {
    let nextSessionLabel: string | null = null;
    if (series.status === "active") {
      const { data: next } = await supabase
        .from("bookings")
        .select("start_at")
        .eq("recurring_series_id", series.id)
        .eq("status", "confirmed")
        .gt("start_at", now.toISOString())
        .order("start_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next?.start_at) nextSessionLabel = formatInTimezone(next.start_at as string, series.timezone ?? "America/New_York", "dateTime");
    }
    items.push({ series, nextSessionLabel, requests: requests.filter((r) => r.seriesId === series.id) });
  }
  return { items, requestsAvailable };
}
