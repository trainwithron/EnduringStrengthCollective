import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/chunk";
import { getCoachClients, type CoachClient } from "@/lib/coach-clients";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { readRowsByIds } from "@/lib/read-by-ids";
import { NEXT_SESSION_LOOKAHEAD_DAYS, STAYS_ON_TOP_MS, nextSessionStart } from "@/lib/next-session-order";
import type { ClientTierLite } from "@/lib/session-type-default";

// The coach's clients as the calendar lists them, for the Spotlight overlay's Clients panel: the SAME clients (every client in the organization once, under their one-on-one space when they
// have one: getCoachClients), each with their type (In person / Online / Group: the tier), whether the coach set them aside, and the start of their next confirmed session (the panel orders
// by it: lib/next-session-order.ts). The filter is lib/client-type.ts offeredForBooking.
export interface ListedClient extends CoachClient {
  tier: ClientTierLite;
  setAside: boolean;
  // Start of the confirmed session still ahead (or begun in the last 30 minutes), soonest; null when none within 45 days.
  nextStartIso: string | null;
}

export async function loadCoachClientList(supabase: SupabaseClient, coachId: string, anchorGroupId: string, now: Date = new Date()): Promise<ListedClient[]> {
  const clients = await getCoachClients(supabase, coachId, anchorGroupId);
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const groupIds = Array.from(new Set(clients.map((c) => c.groupId)));
  const from = new Date(now.getTime() - STAYS_ON_TOP_MS).toISOString();
  const to = new Date(now.getTime() + NEXT_SESSION_LOOKAHEAD_DAYS * 86400000).toISOString();
  const [tierBatches, asideKeys, sessions] = await Promise.all([
    Promise.all(chunk(ids, 100).map((part) => supabase.from("group_memberships").select("profile_id, group_id, client_tier").in("profile_id", part).eq("role", "athlete"))),
    fetchInactiveKeys(supabase, groupIds),
    // Confirmed sessions of this coach in the listed groups only (one organization), not yet marked, from half an hour ago to six weeks ahead.
    readRowsByIds(groupIds, (g) => (rangeFrom, rangeTo) =>
      supabase
        .from("bookings")
        .select("athlete_id, group_id, start_at")
        .in("group_id", g)
        .eq("coach_id", coachId)
        .eq("status", "confirmed")
        .is("attended_at", null)
        .eq("no_show", false)
        .gte("start_at", from)
        .lt("start_at", to)
        .order("start_at")
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
  ]);
  const tier = new Map(tierBatches.flatMap((r) => r.data ?? []).map((m: any) => [`${m.profile_id}:${m.group_id}`, (m.client_tier as ClientTierLite) ?? null]));
  const startsByClient = new Map<string, string[]>();
  for (const r of (sessions.error ? [] : sessions.data) as { athlete_id: string; group_id: string; start_at: string }[]) {
    const key = r.athlete_id;
    const list = startsByClient.get(key);
    if (list) list.push(r.start_at);
    else startsByClient.set(key, [r.start_at]);
  }
  return clients.map((c) => ({
    ...c,
    tier: tier.get(`${c.id}:${c.groupId}`) ?? null,
    setAside: asideKeys.has(inactiveKey(c.groupId, c.id)),
    nextStartIso: nextSessionStart(startsByClient.get(c.id) ?? [], now),
  }));
}
