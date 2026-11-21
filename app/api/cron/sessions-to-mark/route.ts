import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { pageAll } from "@/lib/page-all";
import { configuredAppUrl } from "@/lib/app-url";
import { emailClientNotice } from "@/lib/client-notice-email";
import { COACH_CALENDAR_PATH, countByCoach, NUDGE_EVERY_DAYS, TO_MARK_AFTER_HOURS, TO_MARK_LOOK_BACK_DAYS, toMarkMessage } from "@/lib/sessions-to-mark";

// Once a week (vercel.json): each coach with past sessions still waiting to be marked gets one line saying how many, with a link to the calendar (lib/sessions-to-mark.ts, wave 2 C6).
// A phone alert first; an email only when no phone was reached (the same rule as the requests, lib/notice-email-backup.ts). At most once in six days per coach: only a line that was
// actually delivered counts (coach_nudges), so a coach who could not be reached this run is tried again on the next. Nothing is marked, charged or changed.
export const maxDuration = 300;

const NUDGE_KIND = "sessions_to_mark";

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const now = Date.now();
  // The same sessions the "Did this session happen?" cards list (components/coach/session-check-section.tsx): confirmed, still unsettled, not attended, not a no-show, over.
  // Every page of them (the database answers at most 1000 rows a request); a failed page means no line at all rather than a short count.
  const { rows, failed } = await pageAll(
    (from, to) =>
      db
        .from("bookings")
        .select("id, coach_id")
        .eq("status", "confirmed")
        .eq("credit_state", "unsettled")
        .is("attended_at", null)
        .eq("no_show", false)
        .lt("end_at", new Date(now - TO_MARK_AFTER_HOURS * 3600000).toISOString())
        .gte("end_at", new Date(now - TO_MARK_LOOK_BACK_DAYS * 86400000).toISOString())
        .order("id")
        .range(from, to),
    { maxPages: 50 }
  );
  if (failed) return NextResponse.json({ error: "Could not read the sessions." }, { status: 500 });
  const counts = countByCoach(rows as { coach_id: string }[]);
  if (counts.size === 0) return NextResponse.json({ coaches: 0, pushed: 0, emailed: 0 });

  // A coach who turned off "Bookings and cancellations" gets none; a coach whose last delivered line is under six days old gets none.
  const coachIds = [...counts.keys()];
  const off = new Set<string>();
  const recent = new Set<string>();
  const since = new Date(now - NUDGE_EVERY_DAYS * 86400000).toISOString();
  for (let i = 0; i < coachIds.length; i += 100) {
    const ids = coachIds.slice(i, i + 100);
    const [{ data: profiles }, { data: nudges, error: nudgeError }] = await Promise.all([
      db.from("profiles").select("id, notices_off").in("id", ids),
      db.from("coach_nudges").select("coach_id").eq("kind", NUDGE_KIND).gte("sent_at", since).in("coach_id", ids),
    ]);
    // Without the record of who was nudged (step 214 not applied, or a failed read), nobody is nudged rather than someone twice.
    if (nudgeError) return NextResponse.json({ error: "Could not read who was nudged." }, { status: 500 });
    for (const p of (profiles ?? []) as { id: string; notices_off: string[] | null }[]) if ((p.notices_off ?? []).includes("bookings")) off.add(p.id);
    for (const n of (nudges ?? []) as { coach_id: string }[]) recent.add(n.coach_id);
  }

  const markNudged = (coachId: string) => db.from("coach_nudges").upsert({ coach_id: coachId, kind: NUDGE_KIND, sent_at: new Date().toISOString() }, { onConflict: "coach_id,kind" });

  let pushed = 0;
  let emailed = 0;
  let skipped = 0;
  for (const [coachId, count] of counts) {
    if (off.has(coachId) || recent.has(coachId)) {
      skipped += 1;
      continue;
    }
    const message = toMarkMessage(count);
    const reached = await sendPushToProfile(db, coachId, message.title, message.body, COACH_CALENDAR_PATH).catch(() => 0);
    if (reached > 0) {
      pushed += 1;
      await markNudged(coachId);
      continue;
    }
    const base = configuredAppUrl();
    const text = `${message.body}\n\n${base ? `Your calendar: ${base}${COACH_CALENDAR_PATH}\n\n` : ""}Turn on alerts in Settings > Notifications to get these on your phone instead.\n`;
    if ((await emailClientNotice(db, coachId, message.title, text).catch(() => "failed")) === "sent") {
      emailed += 1;
      await markNudged(coachId);
    }
  }
  return NextResponse.json({ coaches: counts.size, pushed, emailed, skipped });
}

export const GET = withCronRun("sessions-to-mark", handler);
