import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { runPool } from "@/lib/run-pool";
import { PUSHED_BY_JOB, pushBodyFor, pushTitleFor, REQUEST_PUSH_TYPES, requestPushLine, STALE_PUSH_HOURS, waitingRequestFor } from "@/lib/notification-push";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isQuietNow, readPushPrefs } from "@/lib/push-prefs";
import { noticeHref } from "@/lib/notice-links";
import { emailNoticeBackup } from "@/lib/notice-email-backup";

// Every five minutes: pushes the notices the DATABASE writes (a client's booking request, a late change, a schedule request, the decision on a request), which no other code path sends. Each notice is claimed
// (marked pushed) before it is sent, so it goes out once; a notice older than a few hours is marked and not sent (it would only be noise). The person's quiet hours and private lock screen apply (sendPushToProfile).
// Notices that other code already pushes (comments, messages, mentions, invitations, announcements, payments, reminders) are not touched here, so nothing is pushed twice.
export const maxDuration = 120;
const AT_ONCE = 8;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();
  const staleBefore = new Date(Date.now() - STALE_PUSH_HOURS * 3600000).toISOString();
  const now = new Date().toISOString();

  // Too old to be news: closed without a push.
  const { error: staleError } = await db.from("notifications").update({ pushed_at: now }).is("pushed_at", null).in("type", [...PUSHED_BY_JOB]).lt("created_at", staleBefore);
  if (staleError) console.error("notification-push: could not close old notices:", staleError.message);

  const { data: waiting, error: readError } = await db
    .from("notifications")
    .select("id, profile_id")
    .is("pushed_at", null)
    .in("type", [...PUSHED_BY_JOB])
    .gte("created_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(300);
  if (readError) return NextResponse.json({ error: "Could not read the notices." }, { status: 500 });
  const candidates = (waiting ?? []) as { id: string; profile_id: string }[];
  if (candidates.length === 0) return NextResponse.json({ claimed: 0, sent: 0 });

  // Quiet hours DEFER, they do not drop: a notice for someone who is in their quiet hours right now is left unclaimed, and the first run after the window ends sends it (until it is too old to be news).
  const quietNow = new Set<string>();
  // each person's clock, for the time on a request's push
  const zoneOf = new Map<string, string>();
  await runPool([...new Set(candidates.map((c) => c.profile_id))], AT_ONCE, async (profileId) => {
    const prefs = await readPushPrefs(db, profileId);
    zoneOf.set(profileId, prefs.timeZone);
    if (isQuietNow(prefs)) quietNow.add(profileId);
  }, { deadlineMs: 30_000 });
  const ids = candidates.filter((c) => !quietNow.has(c.profile_id)).map((c) => c.id);
  if (ids.length === 0) return NextResponse.json({ claimed: 0, sent: 0, deferred: candidates.length });

  // Claim them: only the rows this call marks are sent by it, so two overlapping runs never send the same notice.
  const { data: claimed, error: claimError } = await db.from("notifications").update({ pushed_at: now }).in("id", ids).is("pushed_at", null).select("id, profile_id, group_id, type, body, link_path, created_at");
  if (claimError) return NextResponse.json({ error: "Could not claim the notices." }, { status: 500 });

  let sent = 0;
  let emailed = 0;
  type Claimed = { id: string; profile_id: string; group_id: string | null; type: string; body: string; link_path: string; created_at: string };
  const run = await runPool((claimed ?? []) as Claimed[], AT_ONCE, async (n) => {
    // A booking request carries Confirm and Decline on the notification itself (Ron, Nov 5); tapping it opens the Requests page at that request. A request to answer says who and when
    // (Ron, Nov 19: "Hewan B. asked for Thu Nov 19, 9:00 AM"); a schedule request and a request to train have no buttons (a schedule change has no decline: it takes effect on its day).
    const requestId = n.type === "booking_request" ? await waitingRequestFor(db, n).catch(() => null) : null;
    const isRequest = (REQUEST_PUSH_TYPES as readonly string[]).includes(n.type);
    const line = isRequest ? await requestPushLine(db, n, zoneOf.get(n.profile_id) ?? DEFAULT_COACH_TIMEZONE) : pushBodyFor(n.type);
    const reached = await sendPushToProfile(
      db,
      n.profile_id,
      pushTitleFor(n.type),
      line,
      noticeHref(n.type, n.link_path || "/dashboard", { id: n.id, groupId: n.group_id }),
      requestId ? { answer: { requestId } } : {}
    );
    sent += reached;
    // No phone was reached (no alerts turned on, or every phone gone): a request to answer, or the answer to a client's request, goes by email instead (wave 2 C3).
    // An answer's email carries the database's own line (what was decided); a request's, who and when.
    if (reached === 0 && (await emailNoticeBackup(db, n, isRequest ? line : n.body || line)) === "sent") emailed += 1;
  }, { deadlineMs: 90_000 });
  if (run.failed.length > 0) console.error(`notification-push: ${run.failed.length} pushes failed`);

  // A notice that was claimed but never sent (out of time, or the send threw) is given back, so the next run sends it instead of it being lost.
  const unsent = [...run.notStarted.map((n) => n.id), ...run.failed.map((f) => f.item.id)];
  if (unsent.length > 0) {
    const { error: giveBackError } = await db.from("notifications").update({ pushed_at: null }).in("id", unsent);
    if (giveBackError) console.error("notification-push: could not give back unsent notices:", giveBackError.message);
  }

  return NextResponse.json({ claimed: (claimed ?? []).length, sent, emailed, failed: run.failed.length, givenBack: unsent.length, deferred: candidates.length - ids.length });
}

export const GET = withCronRun("notification-push", handler);
