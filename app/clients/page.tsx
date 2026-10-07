import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachClientsList } from "@/components/coach/desktop/coach-clients-list";
import { AddClientButton } from "@/components/coach/desktop/add-client-button";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { pickCoachAnchor } from "@/lib/coach-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { buildCreditPicture, fetchBookingCounts } from "@/lib/credit-picture";
import { chunk } from "@/lib/chunk";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import type { CoachClientRow } from "@/lib/coach-client-filter";

// The coach's full client list: every client across all the groups they coach (a one-on-one client and a group member each appear once), wherever the coach
// is standing. This is what "Clients" always means; a team or social group's own roster is "Members" (a different view).
export default async function CoachClientsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const groups = await getCoachedGroups(supabase, user.id);
  const anchor = pickCoachAnchor(groups);
  if (!anchor) {
    return (
      <NoAccess>
        Only coaches have a <SwappableTerm termKey="client" /> list.
      </NoAccess>
    );
  }

  // Phones keep their own coach roster (the group page already shows the coach-level list there).
  if (await prefersAthleteStyleView()) redirect(`/groups/${anchor.id}/clients`);

  const inOrg = groupsInOrgOf(groups, anchor.id);
  const groupById = new Map(inOrg.map((g) => [g.id, g]));
  const clients = await getCoachClients(supabase, user.id, anchor.id);
  const clientIds = clients.map((c) => c.id);
  const groupIds = Array.from(new Set(clients.map((c) => c.groupId)));

  const [setAside, counts, creditRows, tierRows] = await Promise.all([
    fetchInactiveKeys(supabase, groupIds),
    fetchBookingCounts(supabase, { coachId: user.id }),
    Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids))).then((rs) => rs.flatMap((r) => r.data ?? [])),
    Promise.all(
      chunk(clientIds, 100).map((ids) => supabase.from("group_memberships").select("profile_id, group_id, client_tier").in("profile_id", ids).in("group_id", groupIds.length > 0 ? groupIds : [""]).eq("role", "athlete"))
    ).then((rs) => rs.flatMap((r) => r.data ?? [])),
  ]);
  const balance = new Map((creditRows as { athlete_id: string; group_id: string; balance: number }[]).map((r) => [`${r.athlete_id}:${r.group_id}`, r.balance]));
  const tier = new Map((tierRows as { profile_id: string; group_id: string; client_tier: CoachClientRow["tier"] }[]).map((r) => [`${r.profile_id}:${r.group_id}`, r.client_tier ?? null]));

  const rows: CoachClientRow[] = clients.map((c) => {
    const key = `${c.id}:${c.groupId}`;
    const picture = buildCreditPicture({ balance: balance.get(key) ?? 0, booked: counts.get(key)?.booked ?? 0, toMark: 0 });
    return {
      id: c.id,
      fullName: c.fullName,
      groupId: c.groupId,
      groupName: groupById.get(c.groupId)?.name ?? "",
      groupKind: c.groupKind,
      tier: tier.get(key) ?? null,
      setAside: setAside.has(inactiveKey(c.groupId, c.id)),
      toBook: picture.toBook,
      owed: picture.owed,
    };
  });

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="client" form="plural" className="capitalize" />
        </h1>
        <AddClientButton groupId={anchor.id} groupName={anchor.name} createdBy={user.id} />
      </div>
      <CoachClientsList rows={rows} />
    </CoachDesktopShell>
  );
}
