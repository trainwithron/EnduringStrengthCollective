import type { SupabaseClient } from "@supabase/supabase-js";
import { countByIds, readRowsByIds } from "@/lib/read-by-ids";
import { getCoachClients, type CoachClient } from "@/lib/coach-clients";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { dateKeyInZone } from "@/lib/timezone";
import { checkinWeekStart, readSnapshot, type CheckinSnapshot } from "@/lib/weekly-checkin";
import { CHECKIN_COLUMNS, isMissingSchema, type CheckinRow } from "@/lib/weekly-checkin-server";

// The coach's side of the weekly check-in (Ron, Nov 20: R2): what is waiting to be reviewed in the open organization, and which clients have not sent this week's.
// Every read is the coach's own (row security: a coach reads check-ins only in spaces they coach).

// How far back an unreviewed check-in is still listed.
export const REVIEW_WINDOW_DAYS = 56;

export interface ReviewItem {
  id: string;
  groupId: string;
  athleteId: string;
  name: string;
  weekStart: string;
  energy: number;
  eating: number;
  win: string | null;
  hard: string | null;
  photoIds: string[];
  snapshot: CheckinSnapshot;
  submittedAt: string;
}

export interface CoachCheckins {
  available: boolean;
  failed: boolean;
  weekStart: string;
  toReview: ReviewItem[];
  // Signed-in clients (not set aside) with no check-in this week in any of the coach's spaces here; each with the space their check-in opens in.
  notSent: { id: string; name: string; groupId: string }[];
}

// How many check-ins wait for review in these spaces (null: none can be read, for example before step 215), for the link on Clients.
export async function pendingCheckinCount(supabase: SupabaseClient, groupIds: string[], coachId: string): Promise<number | null> {
  if (groupIds.length === 0) return 0;
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86_400_000).toISOString();
  const r = await countByIds(groupIds, (g) =>
    supabase.from("weekly_checkins").select("id", { count: "exact", head: true }).in("group_id", g).is("reviewed_at", null).neq("athlete_id", coachId).gte("submitted_at", since)
  );
  return r.failed ? null : r.count;
}

export async function loadCoachCheckins(
  supabase: SupabaseClient,
  { coachId, anchorGroupId, groupIds, timeZone, now = new Date() }: { coachId: string; anchorGroupId: string; groupIds: string[]; timeZone: string; now?: Date }
): Promise<CoachCheckins> {
  const weekStart = checkinWeekStart(dateKeyInZone(timeZone, now));
  const empty: CoachCheckins = { available: true, failed: false, weekStart, toReview: [], notSent: [] };
  if (groupIds.length === 0) return empty;
  // A database without step 215: nothing to show, and the page says check-ins are not switched on yet.
  const probe = await supabase.from("weekly_checkins").select("id").limit(1);
  if (probe.error) return { ...empty, available: !isMissingSchema(probe.error), failed: !isMissingSchema(probe.error) };

  const since = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000).toISOString();
  const [waiting, thisWeek, clients, setAside] = await Promise.all([
    readRowsByIds(groupIds, (g) => (from, to) =>
      supabase.from("weekly_checkins").select(CHECKIN_COLUMNS).in("group_id", g).is("reviewed_at", null).gte("submitted_at", since).order("submitted_at", { ascending: false }).order("id").range(from, to)
    ),
    readRowsByIds(groupIds, (g) => (from, to) => supabase.from("weekly_checkins").select("athlete_id, group_id").in("group_id", g).eq("week_start", weekStart).order("id").range(from, to)),
    getCoachClients(supabase, coachId, anchorGroupId).catch(() => [] as CoachClient[]),
    fetchInactiveKeys(supabase, groupIds),
  ]);
  const rows = ((waiting.data ?? []) as CheckinRow[]).filter((r) => r.athlete_id !== coachId).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

  const sentIds = new Set(((thisWeek.data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id));
  const inOrg = new Set(groupIds);
  const candidates = clients.filter((c) => inOrg.has(c.groupId) && !setAside.has(inactiveKey(c.groupId, c.id)) && !sentIds.has(c.id));

  // names for the check-ins, and who has signed in (only they can send one)
  const ids = [...new Set([...rows.map((r) => r.athlete_id), ...candidates.map((c) => c.id)])];
  const people = ids.length
    ? await readRowsByIds(ids, (g) => (from, to) => supabase.from("profiles").select("id, full_name, claimed_at").in("id", g).order("id").range(from, to))
    : { data: [], error: null };
  const byId = new Map(((people.data ?? []) as { id: string; full_name: string | null; claimed_at: string | null }[]).map((p) => [p.id, p]));

  return {
    available: true,
    failed: !!(waiting.error || thisWeek.error),
    weekStart,
    toReview: rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      athleteId: r.athlete_id,
      name: byId.get(r.athlete_id)?.full_name?.trim() || "A client",
      weekStart: r.week_start,
      energy: r.energy,
      eating: r.eating,
      win: r.win,
      hard: r.hard,
      photoIds: Array.isArray(r.photo_ids) ? (r.photo_ids as string[]) : [],
      snapshot: readSnapshot(r.auto_snapshot),
      submittedAt: r.submitted_at,
    })),
    // a read that failed leaves nobody counted, rather than reminding people who did send theirs
    notSent: thisWeek.error ? [] : candidates.filter((c) => !!byId.get(c.id)?.claimed_at).map((c) => ({ id: c.id, name: byId.get(c.id)?.full_name?.trim() || c.fullName, groupId: c.groupId })),
  };
}
