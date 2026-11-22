import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveAnchor } from "@/lib/active-anchor";
import { groupsInOrgOf } from "@/lib/coach-groups";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { loadSessionsToCheck } from "@/components/coach/session-check-section";
import { loadNextClientToday, loadOpenClientWorkout } from "@/components/coach/next-client-workout-section";
import { pendingCheckinCount } from "@/lib/weekly-checkin-coach";
import { getActivePrograms } from "@/lib/active-programs";
import { getTodaysSessions } from "@/lib/todays-workout";
import { buildLogChoices } from "@/lib/coach-log-choice";
import { requestsWaitingCount } from "@/lib/requests-center-server";
import { ACTION_NOTICE_TYPES, newestOf, soleStartWorkoutId, spotCount, type SpotNeeds } from "@/lib/spot-needs";

// PH24: the workout "Start <name>'s workout" opens straight into, when the client's Log page would offer exactly one "Start" (the same choices that page builds); otherwise null.
async function soleStartHref(supabase: Awaited<ReturnType<typeof createServerClient>>, groupId: string, athleteId: string): Promise<string | null> {
  try {
    const [programs, today] = await Promise.all([getActivePrograms(supabase, groupId, athleteId), getTodaysSessions(supabase, { groupId, athleteId })]);
    const choices = buildLogChoices(
      programs.map((p) => ({ programId: p.id, name: p.name, label: p.label })),
      today.cards,
      {}
    );
    const workoutId = soleStartWorkoutId(choices);
    return workoutId ? `/groups/${groupId}/athletes/${athleteId}/log/${workoutId}` : null;
  } catch {
    return null;
  }
}

// The top of the Spotlight drop-down on a coach's phone, its dot and the app icon's badge (lib/spot-needs.ts): for the organization the coach is working in (the active one), the requests
// waiting, the check-ins to review, the sessions waiting for "did it happen" and the next client's workout (or one left open). Notices are the bell's alone (PH14). Reads only.
// ?full=1 (opening Spotlight): also where "Start <name>'s workout" goes. The dot and the app icon's badge ask without it and need only the count.
export async function GET(request: Request) {
  const full = new URL(request.url).searchParams.get("full") === "1";
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // The coach's time zone is read at the same time as the organization (they don't depend on each other).
  const [active, { data: me }] = await Promise.all([getActiveAnchor(supabase, user.id), supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle()]);
  const empty: SpotNeeds = {
    needsChoice: false,
    groupIds: [],
    timezone: DEFAULT_COACH_TIMEZONE,
    sessionsToCheck: [],
    next: null,
    open: null,
    requestsWaiting: 0,
    checkinsToReview: 0,
    count: 0,
    newestAt: null,
  };
  if (!active) return NextResponse.json(empty);
  if (active.needsChoice) return NextResponse.json({ ...empty, needsChoice: true });

  const groupIds = groupsInOrgOf(active.groups, active.anchor.id).map((g) => g.id);
  const timezone = (me as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const now = new Date();
  const [sessionsToCheck, nextClient, open, { data: newestNotice }, requestsWaiting, checkins] = await Promise.all([
    loadSessionsToCheck(supabase, user.id, groupIds),
    loadNextClientToday(supabase, user.id, groupIds, timezone, now),
    loadOpenClientWorkout(supabase, groupIds, now),
    // Only the time of the newest unread notice about a request or a check-in in this organization (its groups, or none): it tells the button something new arrived (the fade).
    // The notices themselves are the bell's (PH14).
    supabase
      .from("notifications")
      .select("created_at")
      .eq("profile_id", user.id)
      .is("read_at", null)
      .in("type", [...ACTION_NOTICE_TYPES])
      .or(groupIds.length > 0 ? `group_id.is.null,group_id.in.(${groupIds.join(",")})` : "group_id.is.null")
      .order("created_at", { ascending: false })
      .limit(1),
    requestsWaitingCount(supabase, user.id, groupIds, now).catch(() => 0),
    pendingCheckinCount(supabase, groupIds, user.id).catch(() => null),
  ]);
  const newestNoticeAt = ((newestNotice ?? []) as { created_at: string }[])[0]?.created_at ?? null;
  // Only on a full read, and only for the client the button names (not the one left open, which says Resume instead).
  const next =
    full && nextClient && nextClient.hasProgram && nextClient.athleteId !== open?.athleteId
      ? { ...nextClient, startHref: await soleStartHref(supabase, nextClient.groupId, nextClient.athleteId) }
      : nextClient;
  const result: SpotNeeds = {
    needsChoice: false,
    groupIds,
    timezone,
    sessionsToCheck,
    next,
    open,
    requestsWaiting,
    checkinsToReview: checkins ?? 0,
    count: 0,
    newestAt: newestOf([newestNoticeAt, ...sessionsToCheck.map((s) => s.startIso)]),
  };
  result.count = spotCount(result);
  return NextResponse.json(result);
}
