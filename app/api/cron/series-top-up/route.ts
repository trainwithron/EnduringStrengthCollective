import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { supabaseSeriesStore } from "@/lib/series-store";
import { topUpSeries } from "@/lib/series-engine";
import { GOOGLE_MIRROR_WEEKS } from "@/lib/series-schedule";
import { mirrorBookingToGoogleCalendar } from "@/lib/google-calendar-mirror-server";
import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { withCronRun } from "@/lib/cron-monitor";

// Runs daily. Keeps every running "no end date" schedule booked 12 weeks ahead, and sends to Google Calendar any recurring
// session that has come inside the next 12 weeks since the last run. A date that cannot be booked because the time is now
// taken is told to the coach once and then left alone, so it never repeats every day.
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = createServiceRoleClient();
  const store = supabaseSeriesStore(db);

  const { data: running, error } = await db
    .from("recurring_booking_series")
    .select("id, coach_id, athlete_id, group_id, skipped_starts, timezone")
    .eq("status", "active")
    .eq("mode", "ongoing")
    .limit(1000);
  if (error) {
    // The columns arrive with a later database update; until then there is nothing to do.
    return NextResponse.json({ ok: true, skipped: "ongoing schedules are not set up yet" });
  }

  let booked = 0;
  let reported = 0;
  for (const s of running ?? []) {
    try {
      const r = await topUpSeries(store, s.id);
      booked += r.booked;
      const taken = r.notBooked.filter((n) => n.reason === "Time already taken");
      if (taken.length > 0) {
        const { data: athlete } = await db.from("profiles").select("full_name").eq("id", s.athlete_id).maybeSingle();
        const tz = s.timezone ?? DEFAULT_COACH_TIMEZONE;
        const when = taken.map((t) => formatInTimezone(new Date(t.startIso), tz, "dateTime")).join(", ");
        const body = `Could not book ${athlete?.full_name ?? "a client"}'s weekly session on ${when}: the time is taken. That week is left empty.`;
        await db.from("notifications").insert({
          profile_id: s.coach_id,
          group_id: s.group_id,
          type: "recurring_booking_conflict",
          body,
          link_path: `/groups/${s.group_id}/calendar`,
        });
        await sendPushToProfile(db, s.coach_id, "Recurring session conflict", body, `/groups/${s.group_id}/calendar`).catch(() => 0);
        // Remember it so tomorrow's run leaves it alone.
        await store.updateSeries(s.id, { skippedStarts: [...((s.skipped_starts ?? []) as string[]), ...taken.map((t) => t.startIso)] });
        reported += 1;
      }
    } catch (err) {
      console.error(`series top-up failed for ${s.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Google Calendar catch-up: recurring sessions that moved inside the 12-week window since they were booked.
  let mirrored = 0;
  try {
    const { data: connections } = await db.from("google_calendar_connections").select("coach_id").eq("status", "active");
    const coachIds = (connections ?? []).map((c: any) => c.coach_id as string);
    if (coachIds.length > 0) {
      const now = new Date();
      const { data: pending } = await db
        .from("bookings")
        .select("id")
        .in("coach_id", coachIds)
        .eq("status", "confirmed")
        .not("recurring_series_id", "is", null)
        .is("google_calendar_event_id", null)
        .gt("start_at", now.toISOString())
        .lte("start_at", new Date(now.getTime() + GOOGLE_MIRROR_WEEKS * 7 * 86400000).toISOString())
        .limit(300);
      for (const b of pending ?? []) {
        await mirrorBookingToGoogleCalendar(db, b.id);
        mirrored += 1;
      }
    }
  } catch (err) {
    console.error("series google catch-up failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true, schedules: (running ?? []).length, booked, reported, mirrored });
}

export const GET = withCronRun("series-top-up", handler);
