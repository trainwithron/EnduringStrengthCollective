import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { configuredAppUrl } from "@/lib/app-url";
import { emailClientNotice } from "@/lib/client-notice-email";
import { readPushPrefs } from "@/lib/push-prefs";
import { nowInZone } from "@/lib/timezone";
import { REQUESTS_PATH } from "@/lib/requests-center";
import { countWaitingByCoach, inDigestMorning, REQUESTS_DIGEST_KIND, requestsWaitingLine } from "@/lib/requests-waiting";

// Every hour (vercel.json): a coach with requests waiting gets one line a day at their morning, "3 requests are waiting for your answer." (Ron, Nov 20, wave 3 C10). Only when
// there are any. A phone alert first; an email when no phone was reached (the C3 rule). At most once in about a day per coach, and only a delivered line counts
// (coach_nudges), so a coach who could not be reached at 8 is tried again at 9, up to noon. A coach who turned off "Bookings and cancellations" gets none.
export const maxDuration = 300;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const now = new Date();
  const counts = await countWaitingByCoach(db, now);
  if (!counts) return NextResponse.json({ error: "Could not count the waiting requests." }, { status: 500 });
  if (counts.size === 0) return NextResponse.json({ coaches: 0, sent: 0 });

  const coachIds = [...counts.keys()];
  const off = new Set<string>();
  const recent = new Set<string>();
  // about a day: a line at 8 one day and 8 the next is fine; twice in one morning is not
  const since = new Date(now.getTime() - 20 * 3600000).toISOString();
  for (let i = 0; i < coachIds.length; i += 100) {
    const ids = coachIds.slice(i, i + 100);
    const [{ data: profiles }, { data: nudges, error: nudgeError }] = await Promise.all([
      db.from("profiles").select("id, notices_off").in("id", ids),
      db.from("coach_nudges").select("coach_id").eq("kind", REQUESTS_DIGEST_KIND).gte("sent_at", since).in("coach_id", ids),
    ]);
    // Without the record of who was told, nobody is told rather than someone twice.
    if (nudgeError) return NextResponse.json({ error: "Could not read who was told." }, { status: 500 });
    for (const p of (profiles ?? []) as { id: string; notices_off: string[] | null }[]) if ((p.notices_off ?? []).includes("bookings")) off.add(p.id);
    for (const n of (nudges ?? []) as { coach_id: string }[]) recent.add(n.coach_id);
  }

  let sent = 0;
  let notMorning = 0;
  let skipped = 0;
  let recordFailures = 0;
  for (const [coachId, count] of counts) {
    if (count <= 0 || off.has(coachId) || recent.has(coachId)) {
      skipped += 1;
      continue;
    }
    const prefs = await readPushPrefs(db, coachId);
    if (!inDigestMorning(nowInZone(prefs.timeZone, now).getUTCHours())) {
      notMorning += 1;
      continue;
    }
    const line = requestsWaitingLine(count);
    let delivered = (await sendPushToProfile(db, coachId, line.title, line.body, REQUESTS_PATH).catch(() => 0)) > 0;
    if (!delivered) {
      const base = configuredAppUrl();
      const text = `${line.body}\n\n${base ? `Your requests: ${base}${REQUESTS_PATH}\n\n` : ""}Turn on alerts in Settings > Notifications to get these on your phone instead.\n`;
      delivered = (await emailClientNotice(db, coachId, line.title, text).catch(() => "failed")) === "sent";
    }
    if (!delivered) continue;
    sent += 1;
    const { error } = await db.from("coach_nudges").upsert({ coach_id: coachId, kind: REQUESTS_DIGEST_KIND, sent_at: new Date().toISOString() }, { onConflict: "coach_id,kind" });
    if (error) {
      recordFailures += 1;
      console.error(`requests-digest: could not record the line for a coach: ${error.message}`);
    }
  }
  return NextResponse.json({ coaches: counts.size, sent, notMorning, skipped, recordFailures });
}

export const GET = withCronRun("requests-digest", handler);
