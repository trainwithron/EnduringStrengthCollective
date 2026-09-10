import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { HomeClientCard, type HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import { HomeGroupCard, type HomeGroupCardData } from "@/components/coach/desktop/home-group-card";

interface GroupRow {
  id: string;
  name: string;
  focus_tag: string | null;
  group_kind: string | null;
}

export default async function CoachHomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: isCoachAnywhere } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  if (!isCoachAnywhere) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches have a home dashboard.</p>
      </main>
    );
  }

  const { data: orgMembership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .maybeSingle();

  const { data: org } = orgMembership
    ? await supabase
        .from("organizations")
        .select("name, display_name")
        .eq("id", orgMembership.organization_id)
        .maybeSingle()
    : { data: null };

  // Same merge shape GroupSwitcher already uses: every group this coach
  // coaches, plus every group in the org if they're an owner/admin.
  const byId = new Map<string, GroupRow>();

  const { data: coachedRows } = await supabase
    .from("group_memberships")
    .select("groups ( id, name, focus_tag, group_kind )")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  for (const row of coachedRows ?? []) {
    const g = (row as any).groups as GroupRow | null;
    if (g) byId.set(g.id, g);
  }

  if (orgMembership && (orgMembership.role === "owner" || orgMembership.role === "admin")) {
    const { data: allGroups } = await supabase
      .from("groups")
      .select("id, name, focus_tag, group_kind")
      .eq("organization_id", orgMembership.organization_id)
      .order("name");
    for (const g of allGroups ?? []) byId.set(g.id, g as GroupRow);
  }

  const allGroups = [...byId.values()];
  const soloGroups = allGroups.filter((g) => g.group_kind === "one_on_one");
  const socialGroups = allGroups.filter((g) => g.group_kind === "social").sort((a, b) => a.name.localeCompare(b.name));
  const teamGroups = allGroups
    .filter((g) => g.group_kind === "team" || !g.group_kind)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Member counts for team/social group cards.
  const teamAndSocialIds = [...teamGroups, ...socialGroups].map((g) => g.id);
  const memberCountByGroup = new Map<string, number>();
  if (teamAndSocialIds.length > 0) {
    const { data: memberRows } = await supabase
      .from("group_memberships")
      .select("group_id")
      .in("group_id", teamAndSocialIds);
    for (const row of memberRows ?? []) {
      memberCountByGroup.set(row.group_id, (memberCountByGroup.get(row.group_id) ?? 0) + 1);
    }
  }

  // A 1-on-1 client's group has exactly one athlete member — fetch that
  // member's profile plus their most recent workout_logs entry, same
  // lastLogByAthlete pattern already used on the Clients roster page.
  const soloGroupIds = soloGroups.map((g) => g.id);
  let clientCards: HomeClientCardData[] = [];
  if (soloGroupIds.length > 0) {
    const { data: athleteRows } = await supabase
      .from("group_memberships")
      .select("group_id, profile_id, profiles ( full_name, avatar_url )")
      .in("group_id", soloGroupIds)
      .eq("role", "athlete");

    const { data: recentLogs } = await supabase
      .from("workout_logs")
      .select("athlete_id, created_at")
      .in("group_id", soloGroupIds)
      .order("created_at", { ascending: false });
    const lastLogByAthlete = new Map<string, string>();
    for (const log of recentLogs ?? []) {
      if (!lastLogByAthlete.has(log.athlete_id)) {
        lastLogByAthlete.set(log.athlete_id, log.created_at);
      }
    }

    clientCards = (athleteRows ?? []).map((row) => {
      const profile = (row as any).profiles;
      return {
        groupId: row.group_id,
        athleteId: row.profile_id,
        fullName: profile?.full_name ?? "Client",
        avatarUrl: profile?.avatar_url ?? null,
        lastWorkoutAt: lastLogByAthlete.get(row.profile_id) ?? null,
      };
    });

    // Needs-attention first — same comparator ClientCardGrid already uses.
    clientCards.sort((a, b) => {
      const daysSince = (at: string | null) =>
        at ? Math.floor((Date.now() - new Date(at).getTime()) / (1000 * 60 * 60 * 24)) : Infinity;
      return daysSince(b.lastWorkoutAt) - daysSince(a.lastWorkoutAt);
    });
  }

  const teamCards: HomeGroupCardData[] = teamGroups.map((g) => ({
    id: g.id,
    name: g.name,
    focusTag: g.focus_tag,
    memberCount: memberCountByGroup.get(g.id) ?? 0,
  }));
  const socialCards: HomeGroupCardData[] = socialGroups.map((g) => ({
    id: g.id,
    name: g.name,
    focusTag: g.focus_tag,
    memberCount: memberCountByGroup.get(g.id) ?? 0,
  }));

  const orgName = org?.display_name || org?.name || "Your Coaching Business";

  return (
    <CoachHomeShell orgName={orgName}>
      <h1 className="font-display font-bold text-2xl uppercase mb-6">Home</h1>

      <section className="mb-10">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">1-on-1 Clients</h2>
        {clientCards.length === 0 ? (
          <p className="font-body text-sm text-steel">No 1-on-1 clients yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clientCards.map((c) => (
              <HomeClientCard key={c.athleteId} client={c} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Groups</h2>
        {teamCards.length === 0 ? (
          <p className="font-body text-sm text-steel">No groups yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamCards.map((g) => (
              <HomeGroupCard key={g.id} group={g} />
            ))}
          </div>
        )}
      </section>

      {socialCards.length > 0 && (
        <section>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Social Groups</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {socialCards.map((g) => (
              <HomeGroupCard key={g.id} group={g} />
            ))}
          </div>
        </section>
      )}
    </CoachHomeShell>
  );
}
