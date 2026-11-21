import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { rateLimitAllows } from "@/lib/rate-limit";
import { configuredAppUrl } from "@/lib/app-url";
import { emailClientNotice } from "@/lib/client-notice-email";
import { COACH_CALENDAR_PATH, countByCoach, TO_MARK_AFTER_HOURS, TO_MARK_LOOK_BACK_DAYS, toMarkMessage } from "@/lib/sessions-to-mark";

// Once a week (vercel.json): each coach with past sessions still waiting to be marked gets one line saying how many, with a link to the calendar (lib/sessions-to-mark.ts, wave 2 C6).
// A phone alert first; an email only when no phone was reached (the same rule as the requests, lib/notice-email-backup.ts). At most once in six days per coach, however often this runs.
// Reads only; nothing is marked, charged or changed.
export const maxDuration = 300;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const now = Date.now();
  // The same sessions the "Did this session happen?" cards list (components/coach/session-check-section.tsx): confirmed, still unsettled, not attended, not a no-show, over.
  const { data, error } = await db
    .from("bookings")
    .select("coach_id")
    .eq("status", "confirmed")
    .eq("credit_state", "unsettled")
    .is("attended_at", null)
    .eq("no_show", false)
    .lt("end_at", new Date(now - TO_MARK_AFTER_HOURS * 3600000).toISOString())
    .gte("end_at", new Date(now - TO_MARK_LOOK_BACK_DAYS * 86400000).toISOString())
    .limit(20000);
  if (error) return NextResponse.json({ error: "Could not read the sessions." }, { status: 500 });
  const counts = countByCoach((data ?? []) as { coach_id: string }[]);
  if (counts.size === 0) return NextResponse.json({ coaches: 0, pushed: 0, emailed: 0 });

  // A coach who turned off "Bookings and cancellations" gets none.
  const coachIds = [...counts.keys()];
  const off = new Set<string>();
  for (let i = 0; i < coachIds.length; i += 100) {
    const { data: profiles } = await db.from("profiles").select("id, notices_off").in("id", coachIds.slice(i, i + 100));
    for (const p of (profiles ?? []) as { id: string; notices_off: string[] | null }[]) if ((p.notices_off ?? []).includes("bookings")) off.add(p.id);
  }

  let pushed = 0;
  let emailed = 0;
  let skipped = 0;
  for (const [coachId, count] of counts) {
    if (off.has(coachId)) {
      skipped += 1;
      continue;
    }
    // Once in six days per coach, even if the job runs twice.
    if (!(await rateLimitAllows(`sessions-to-mark-nudge:${coachId}`, 1, 6 * 86400))) {
      skipped += 1;
      continue;
    }
    const message = toMarkMessage(count);
    const reached = await sendPushToProfile(db, coachId, message.title, message.body, COACH_CALENDAR_PATH).catch(() => 0);
    if (reached > 0) {
      pushed += 1;
      continue;
    }
    const base = configuredAppUrl();
    const text = `${message.body}\n\n${base ? `Your calendar: ${base}${COACH_CALENDAR_PATH}\n\n` : ""}Turn on alerts in Settings > Notifications to get these on your phone instead.\n`;
    if ((await emailClientNotice(db, coachId, message.title, text).catch(() => "failed")) === "sent") emailed += 1;
  }
  return NextResponse.json({ coaches: counts.size, pushed, emailed, skipped });
}

export const GET = withCronRun("sessions-to-mark", handler);
