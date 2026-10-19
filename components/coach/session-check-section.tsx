import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { shortClientName } from "@/lib/low-session-digest";
import { readRowsByIds } from "@/lib/read-by-ids";
import { SessionCheckCards, type SessionToCheck } from "@/components/coach/session-check-cards";

// The "Did this session happen?" cards at the top of the coach's Home and Calendar: the coach's sessions whose time has passed and that nobody has marked yet (the same ones the client panel lists as "waiting to be
// marked": confirmed, still unsettled, not attended, not a no-show). Oldest first. Reads only; a failed read shows nothing rather than a wrong card. `groupIds` is the open organization's groups.
export async function loadSessionsToCheck(supabase: any, coachId: string, groupIds: string[]): Promise<SessionToCheck[]> {
  // Only this organization's groups (a coach in several never sees another organization's sessions here); the ids go in groups and each is read a page at a time.
  const { data, error } = await readRowsByIds(groupIds, (ids) => (from, to) =>
    supabase
      .from("bookings")
      .select("id, athlete_id, group_id, start_at")
      .eq("coach_id", coachId)
      .in("group_id", ids)
      .eq("status", "confirmed")
      .eq("credit_state", "unsettled")
      .is("attended_at", null)
      .eq("no_show", false)
      .lt("end_at", new Date().toISOString())
      .order("id")
      .range(from, to)
  );
  if (error || !data) return [];
  const rows = (data as { id: string; athlete_id: string; group_id: string; start_at: string }[]).sort((x, y) => x.start_at.localeCompare(y.start_at)).slice(0, 200);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.athlete_id))].slice(0, 100);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  const names = new Map<string, string>(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, shortClientName(p.full_name)]));
  return rows.filter((r) => names.has(r.athlete_id)).map((r) => ({ bookingId: r.id, athleteId: r.athlete_id, groupId: r.group_id, name: names.get(r.athlete_id) ?? "A client", startIso: r.start_at }));
}

export async function SessionCheckSection({ coachId, groupIds }: { coachId: string; groupIds: string[] }) {
  const supabase = await createServerClient();
  const [sessions, { data: me }] = await Promise.all([loadSessionsToCheck(supabase, coachId, groupIds), supabase.from("profiles").select("timezone").eq("id", coachId).maybeSingle()]);
  if (sessions.length === 0) return null;
  return <SessionCheckCards sessions={sessions} timezone={(me as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE} />;
}
