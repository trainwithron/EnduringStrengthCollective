import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClassCard } from "@/components/athlete/classes-list";
import { orgIdOfGroup } from "@/lib/org-of-group";

// The group sessions a client can join, with spots left and their own answer. Row security already limits the sessions to this person's own coach. Shared by the Group sessions page (everything coming up)
// and the client Home (the next seven days, a handful).
export async function loadClassCards(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  opts: { untilIso?: string; limit: number }
): Promise<{ classes: ClassCard[]; balance: number | null; notReady: boolean; nowIso: string }> {
  const nowIso = new Date().toISOString();
  // A class belongs to one organization: only this group's organization's classes are listed (a group with no organization, a personal space, has none).
  const organizationId = await orgIdOfGroup(supabase, groupId);
  if (!organizationId) return { classes: [], balance: null, notReady: false, nowIso };
  let query = supabase
    .from("group_sessions")
    .select("id, title, start_at, end_at, capacity, location_note, status")
    .eq("kind", "class")
    .eq("organization_id", organizationId)
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(opts.limit);
  if (opts.untilIso) query = query.lte("start_at", opts.untilIso);
  const sessionsResult = await query;
  const notReady = !!sessionsResult.error;
  const sessions = (sessionsResult.data ?? []) as any[];
  const ids = sessions.map((s) => s.id as string);

  const [countsResult, mineResult, creditsResult] = await Promise.all([
    ids.length > 0 ? supabase.rpc("group_session_counts", { p_session_ids: ids }) : Promise.resolve({ data: [] as any[] }),
    ids.length > 0
      ? supabase.from("group_session_attendees").select("group_session_id, status").eq("athlete_id", userId).in("group_session_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("session_credits").select("balance").eq("athlete_id", userId).eq("group_id", groupId).maybeSingle(),
  ]);

  const counts = new Map<string, { joined: number; waitlisted: number }>();
  for (const c of (countsResult.data ?? []) as any[]) counts.set(c.session_id, { joined: c.joined, waitlisted: c.waitlisted });
  const mine = new Map<string, string>();
  for (const m of (mineResult.data ?? []) as any[]) mine.set(m.group_session_id, m.status);

  const classes: ClassCard[] = sessions
    .filter((s) => s.status === "scheduled" || mine.has(s.id))
    .map((s) => ({
      id: s.id,
      title: s.title,
      startIso: s.start_at,
      endIso: s.end_at,
      capacity: s.capacity,
      joined: counts.get(s.id)?.joined ?? 0,
      waitlisted: counts.get(s.id)?.waitlisted ?? 0,
      locationNote: s.location_note ?? null,
      mine: (["joined", "waitlisted", "attended", "cancelled"].includes(mine.get(s.id) ?? "") ? mine.get(s.id) : null) as ClassCard["mine"],
      cancelled: s.status === "cancelled",
    }));
  return { classes, balance: (creditsResult.data as { balance?: number } | null)?.balance ?? null, notReady, nowIso };
}
