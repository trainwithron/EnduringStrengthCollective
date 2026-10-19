import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachClientsList } from "@/components/coach/desktop/coach-clients-list";
import { orgIsTeamOnly } from "@/lib/team-sport";
import { AddClientButton } from "@/components/coach/desktop/add-client-button";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { buildCreditPicture, fetchBookingCounts } from "@/lib/credit-picture";
import { chunk } from "@/lib/chunk";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { waitingOnGuardian } from "@/lib/guardian-wait";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import type { CoachClientRow } from "@/lib/coach-client-filter";
import { CoachesSection } from "@/components/coach/coaches-section";
import { loadOrgCoaches, signInsFor } from "@/lib/pending-coaches";
import { authorizeInviteManager } from "@/lib/coach-invite-server";

export const metadata = { title: "Clients" };

// The coach's full client list: every client across all the groups they coach (a one-on-one client and a group member each appear once), wherever the coach
// is standing. This is what "Clients" always means; a team or social group's own roster is "Members" (a different view).
export default async function CoachClientsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=/clients`);
  const groups = active?.groups ?? [];
  const anchor = active?.anchor ?? null;
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

  const [setAside, counts, creditRows, tierRows, dobRows] = await Promise.all([
    fetchInactiveKeys(supabase, groupIds),
    fetchBookingCounts(supabase, { coachId: user.id }),
    Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids))).then((rs) => rs.flatMap((r) => r.data ?? [])),
    Promise.all(
      chunk(clientIds, 100).map((ids) => supabase.from("group_memberships").select("profile_id, group_id, client_tier").in("profile_id", ids).eq("role", "athlete"))
    ).then((rs) => rs.flatMap((r) => r.data ?? [])),
    // Birth dates, only to mark a client aged 13 to 17 whose parent or guardian has not signed yet.
    Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("client_intake").select("athlete_id, date_of_birth").in("athlete_id", ids))).then((rs) => rs.flatMap((r) => r.data ?? [])),
  ]);
  const dobByClient = new Map((dobRows as { athlete_id: string; date_of_birth: string | null }[]).map((r) => [r.athlete_id, r.date_of_birth]));
  const teenIds = [...dobByClient.entries()].filter(([, dob]) => waitingOnGuardian(dob, false)).map(([id]) => id);
  const signedTeens = new Set<string>();
  if (teenIds.length > 0) {
    // Read with the server's own access (the table is not readable from a browser), for this coach's own clients only.
    const admin = createServiceRoleClient();
    for (const ids of chunk(teenIds, 100)) {
      const { data } = await admin.from("guardian_consents").select("athlete_id").eq("status", "signed").in("athlete_id", ids);
      for (const r of (data ?? []) as { athlete_id: string }[]) signedTeens.add(r.athlete_id);
    }
  }
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
      waitingOnGuardian: waitingOnGuardian(dobByClient.get(c.id), signedTeens.has(c.id)),
    };
  });

  // An organization whose clients all sit in team-sport groups gets one view of its athletes (no Cards/List, no kind filters).
  const teamModeRows = groupIds.length > 0 ? await supabase.from("groups").select("id, team_mode").in("id", groupIds.slice(0, 200)) : { data: [] as { id: string; team_mode: boolean | null }[] };
  const clientsAllInTeams = groupIds.length > 0 && groupIds.length <= 200 && ((teamModeRows.data ?? []) as { id: string; team_mode: boolean | null }[]).filter((g) => g.team_mode === true).length === groupIds.length;
  // ...and by the organization's TYPE, so a team organization with no athletes yet is the same single list (not a client list with empty 1-on-1 / Online / Group filters).
  const orgGroupRows = inOrg.length > 0 ? await supabase.from("groups").select("id, team_mode").in("id", inOrg.map((g) => g.id).slice(0, 200)) : { data: [] as { id: string; team_mode: boolean | null }[], error: null };
  const orgTeamOnly = !orgGroupRows.error && orgIsTeamOnly((orgGroupRows.data ?? []) as { team_mode?: boolean | null }[]);
  const oneView = orgTeamOnly || clientsAllInTeams;

  // The coach's own row (their personal space): shown in every organization they coach in, never counted as a client.
  const { data: selfProfile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const selfName = (selfProfile?.full_name as string | null | undefined)?.trim() || "You";

  // The plain Coaches list (every coach of the organization once, who has not accepted yet, Invite a coach) sits at the top of this page for every organization: on a computer the Clients link always lands here.
  const [coachList, inviteManager] = await Promise.all([loadOrgCoaches(anchor.id), authorizeInviteManager(supabase, user.id, anchor.id)]);

  const signIns = await signInsFor(coachList.coaches, inviteManager.ok, user.id);

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="client" form="plural" className="capitalize" />
        </h1>
        <AddClientButton groupId={anchor.id} groupName={anchor.name} createdBy={user.id} />
      </div>
      <CoachesSection groupId={anchor.id} viewerId={user.id} coaches={coachList.coaches} pending={coachList.pending} canManage={inviteManager.ok} signIns={signIns} />

      <CoachClientsList rows={rows} selfName={selfName} oneView={oneView} />
    </CoachDesktopShell>
  );
}
