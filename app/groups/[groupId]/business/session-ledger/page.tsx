import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";

// gym_owner_multi_trainer_session_tracking_real_prospect.md — piece 3
// of the build spec, the real missing visibility: packages and client
// rosters are scoped per group, per coach (coach_packages/the packages
// page both filter by coach_id) — an org owner running several trainers
// under one account has no existing view that rolls up every client's
// session balance across all of them at once. Same "org-wide across
// coaches" shape as revenue-splits/page.tsx, gated the same way
// (organization_memberships.role === 'owner'), but this is about real-
// time session balances, not estimated revenue.
export default async function SessionLedgerPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view the session ledger.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  const { data: orgMembership } = group?.organization_id
    ? await supabase
        .from("organization_memberships")
        .select("organization_id, role")
        .eq("organization_id", group.organization_id)
        .eq("profile_id", user.id)
        .maybeSingle()
    : { data: null };

  if (!orgMembership || orgMembership.role !== "owner") {
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="session-ledger">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Session Ledger</h1>
        </div>
        <p className="font-body text-sm text-steel">
          Only the organization&apos;s owner can see every trainer&apos;s client session balances in one
          place. If that&apos;s you and you&apos;re seeing this, check that this group belongs to the
          organization you own.
        </p>
      </CoachDesktopShell>
    );
  }

  const { data: orgGroups } = await supabase
    .from("groups")
    .select("id, name")
    .eq("organization_id", orgMembership.organization_id);
  const orgGroupIds = (orgGroups ?? []).map((g) => g.id);
  const groupNameById = new Map((orgGroups ?? []).map((g) => [g.id, g.name]));

  if (orgGroupIds.length === 0) {
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="session-ledger">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Session Ledger</h1>
        </div>
        <p className="font-body text-sm text-steel">No groups in this organization yet.</p>
      </CoachDesktopShell>
    );
  }

  // Every athlete across every group in the org, each group's assigned
  // trainer(s), and every real session_credits balance in one batch —
  // three independent queries, not N+1 per group.
  const [{ data: athleteRows }, { data: coachRows }, { data: creditRows }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("group_id, profile_id, profiles ( full_name )")
      .in("group_id", orgGroupIds)
      .eq("role", "athlete"),
    supabase
      .from("group_memberships")
      .select("group_id, profile_id, profiles ( full_name )")
      .in("group_id", orgGroupIds)
      .eq("role", "coach"),
    supabase
      .from("session_credits")
      .select("athlete_id, group_id, balance, updated_at")
      .in("group_id", orgGroupIds),
  ]);

  const trainerNameByGroup = new Map<string, string>();
  for (const row of (coachRows ?? []) as any[]) {
    const existing = trainerNameByGroup.get(row.group_id);
    const name = row.profiles?.full_name ?? "Unknown";
    trainerNameByGroup.set(row.group_id, existing ? `${existing}, ${name}` : name);
  }

  const balanceByAthleteGroup = new Map<string, { balance: number; updatedAt: string }>();
  for (const row of creditRows ?? []) {
    balanceByAthleteGroup.set(`${row.athlete_id}::${row.group_id}`, {
      balance: row.balance,
      updatedAt: row.updated_at,
    });
  }

  const rows = ((athleteRows ?? []) as any[])
    .map((row) => {
      const credit = balanceByAthleteGroup.get(`${row.profile_id}::${row.group_id}`);
      return {
        athleteId: row.profile_id as string,
        athleteName: (row.profiles?.full_name as string) ?? "Unknown",
        groupId: row.group_id as string,
        groupName: groupNameById.get(row.group_id) ?? "Group",
        trainerName: trainerNameByGroup.get(row.group_id) ?? "Unassigned",
        // No session_credits row at all means this client was never put
        // on a package — a real, different state from "0 sessions left,"
        // shown separately rather than sorted in with genuinely urgent
        // clients.
        balance: credit?.balance ?? null,
      };
    })
    // Lowest real balance first — the most urgent renewal conversations
    // surface at the top; clients with no package at all sink to the
    // bottom since there's no renewal to catch for them.
    .sort((a, b) => {
      if (a.balance === null && b.balance === null) return a.athleteName.localeCompare(b.athleteName);
      if (a.balance === null) return 1;
      if (b.balance === null) return -1;
      return a.balance - b.balance;
    });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="session-ledger">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Session Ledger</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every client&apos;s real session balance across every trainer in your organization — sorted so
          the ones closest to running out show up first. A booked session or one logged in person both
          spend a credit the same way.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="font-body text-sm text-steel">No clients across your organization yet.</p>
      ) : (
        <div className="divide-y divide-steel/15 border-y border-steel/15">
          <div className="grid grid-cols-[1fr_180px_140px_120px] gap-3 py-2 font-body text-[10px] text-steel uppercase tracking-wide">
            <span>Client</span>
            <span>Trainer</span>
            <span>Group</span>
            <span className="text-right">Sessions left</span>
          </div>
          {rows.map((r) => (
            <Link
              key={`${r.athleteId}::${r.groupId}`}
              href={`/groups/${r.groupId}/athletes/${r.athleteId}`}
              className="grid grid-cols-[1fr_180px_140px_120px] gap-3 py-2.5 font-body text-sm hover:bg-surface/40"
            >
              <span className="truncate">{r.athleteName}</span>
              <span className="text-steel truncate">{r.trainerName}</span>
              <span className="text-steel truncate">{r.groupName}</span>
              <span
                className={`text-right font-medium ${
                  r.balance === null
                    ? "text-steel"
                    : r.balance === 0
                      ? "text-rust"
                      : r.balance <= 1
                        ? "text-rust"
                        : r.balance <= 3
                          ? "text-yellow-500"
                          : "text-chalk"
                }`}
              >
                {r.balance === null ? "No package" : r.balance}
              </span>
            </Link>
          ))}
        </div>
      )}
    </CoachDesktopShell>
  );
}
