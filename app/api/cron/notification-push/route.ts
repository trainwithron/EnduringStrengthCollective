import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { withCronRun } from "@/lib/cron-monitor";
import { runPool } from "@/lib/run-pool";
import { PUSHED_BY_JOB, pushBodyFor, pushTitleFor, STALE_PUSH_HOURS } from "@/lib/notification-push";
import { isQuietNow, readPushPrefs } from "@/lib/push-prefs";

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
  await runPool([...new Set(candidates.map((c) => c.profile_id))], AT_ONCE, async (profileId) => {
    if (isQuietNow(await readPushPrefs(db, profileId))) quietNow.add(profileId);
  }, { deadlineMs: 30_000 });
  const ids = candidates.filter((c) => !quietNow.has(c.profile_id)).map((c) => c.id);
  if (ids.length === 0) return NextResponse.json({ claimed: 0, sent: 0, deferred: candidates.length });

  // Claim them: only the rows this call marks are sent by it, so two overlapping runs never send the same notice.
  const { data: claimed, error: claimError } = await db.from("notifications").update({ pushed_at: now }).in("id", ids).is("pushed_at", null).select("id, profile_id, type, body, link_path");
  if (claimError) return NextResponse.json({ error: "Could not claim the notices." }, { status: 500 });

  let sent = 0;
  type Claimed = { id: string; profile_id: string; type: string; body: string; link_path: string };
  const run = await runPool((claimed ?? []) as Claimed[], AT_ONCE, async (n) => {
    sent += await sendPushToProfile(db, n.profile_id, pushTitleFor(n.type), pushBodyFor(n.type), n.link_path || "/dashboard");
  }, { deadlineMs: 90_000 });
  if (run.failed.length > 0) console.error(`notification-push: ${run.failed.length} pushes failed`);

  // A notice that was claimed but never sent (out of time, or the send threw) is given back, so the next run sends it instead of it being lost.
  const unsent = [...run.notStarted.map((n) => n.id), ...run.failed.map((f) => f.item.id)];
  if (unsent.length > 0) {
    const { error: giveBackError } = await db.from("notifications").update({ pushed_at: null }).in("id", unsent);
    if (giveBackError) console.error("notification-push: could not give back unsent notices:", giveBackError.message);
  }

  return NextResponse.json({ claimed: (claimed ?? []).length, sent, failed: run.failed.length, givenBack: unsent.length, deferred: candidates.length - ids.length });
}

export const GET = withCronRun("notification-push", handler);
