import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveAnchor } from "@/lib/active-anchor";
import { groupsInOrgOf } from "@/lib/coach-groups";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { loadSessionsToCheck } from "@/components/coach/session-check-section";
import { loadNextClientToday, loadOpenClientWorkout } from "@/components/coach/next-client-workout-section";
import { loadCoachInbox } from "@/lib/coach-inbox-data";
import { noticeHref } from "@/lib/notice-links";
import { newestOf, spotCount, type SpotNeeds } from "@/lib/spot-needs";

// The top of the Spotlight drop-down on a coach's phone, and its dot (lib/spot-needs.ts): for the organization the coach is working in (the active one), the sessions waiting for
// "did it happen", the next client's workout (or one left open), unread notices and how many messages are unread. Reads only; nothing is marked read here.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // The coach's time zone is read at the same time as the organization (they don't depend on each other).
  const [active, { data: me }] = await Promise.all([getActiveAnchor(supabase, user.id), supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle()]);
  const empty: SpotNeeds = { needsChoice: false, groupIds: [], timezone: DEFAULT_COACH_TIMEZONE, sessionsToCheck: [], next: null, open: null, notices: [], unreadMessages: 0, count: 0, newestAt: null };
  if (!active) return NextResponse.json(empty);
  if (active.needsChoice) return NextResponse.json({ ...empty, needsChoice: true });

  const groupIds = groupsInOrgOf(active.groups, active.anchor.id).map((g) => g.id);
  const timezone = (me as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const now = new Date();
  const [sessionsToCheck, next, open, { data: noticeRows }, inbox] = await Promise.all([
    loadSessionsToCheck(supabase, user.id, groupIds),
    loadNextClientToday(supabase, user.id, groupIds, timezone, now),
    loadOpenClientWorkout(supabase, groupIds, now),
    // The same notices as the bell, for this organization (its groups, or none), unread only.
    supabase
      .from("notifications")
      .select("id, type, body, link_path, created_at")
      .eq("profile_id", user.id)
      .is("read_at", null)
      .or(groupIds.length > 0 ? `group_id.is.null,group_id.in.(${groupIds.join(",")})` : "group_id.is.null")
      .order("created_at", { ascending: false })
      .limit(10),
    loadCoachInbox(supabase, { coachId: user.id, groupId: active.anchor.id }).catch(() => ({ conversations: [] as { unreadCount: number; lastAt: string | null }[] })),
  ]);
  const notices = ((noticeRows ?? []) as { id: string; type: string; body: string; link_path: string | null; created_at: string }[]).map((n) => ({
    id: n.id,
    type: n.type,
    body: n.body,
    linkPath: noticeHref(n.type, n.link_path ?? "/"),
    createdAt: n.created_at,
  }));
  const unreadConversations = inbox.conversations.filter((c) => c.unreadCount > 0);
  const unreadMessages = unreadConversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const result: SpotNeeds = {
    needsChoice: false,
    groupIds,
    timezone,
    sessionsToCheck,
    next,
    open,
    notices,
    unreadMessages,
    count: 0,
    newestAt: newestOf([...notices.map((n) => n.createdAt), ...unreadConversations.map((c) => c.lastAt), ...sessionsToCheck.map((s) => s.startIso)]),
  };
  result.count = spotCount(result);
  return NextResponse.json(result);
}
