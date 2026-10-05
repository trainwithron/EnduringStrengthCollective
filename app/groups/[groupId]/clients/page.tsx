import { redirect } from "next/navigation";
import { claimStatus } from "@/lib/client-claim";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { calorieSeriesWithStanding } from "@/lib/macro-resolution";
import { fetchStandingTarget } from "@/lib/standing-macros";
import { ClientCardGrid } from "@/components/coach/desktop/client-card-grid";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { GroupInvitesPanel, type GroupInviteRow } from "@/components/coach/desktop/group-invites-panel";
import { AddClientButton } from "@/components/coach/desktop/add-client-button";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { CoachRosterMobile } from "@/components/coach/mobile/coach-roster-mobile";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import type { RosterMember } from "@/lib/types";
import {
  classifyNutritionTrend,
  isTrendAligned,
  type MilestonePhaseTag,
} from "@/lib/nutrition-trend-classifier";

export default async function ClientsPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage clients.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, team_mode, group_kind")
    .eq("id", params.groupId)
    .single();

  // team_sports_expansion_scoping.md — the position picker/filter is
  // real, buildable roster-scale infrastructure only for a team-mode
  // group; every other group simply never fetches or shows it, same
  // "invisible unless team_mode" convention the position-aware
  // leaderboard already established.
  const { data: positionRows } = group?.team_mode
    ? await supabase
        .from("group_positions")
        .select("id, name")
        .eq("group_id", params.groupId)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const positions = (positionRows ?? []).map((p) => ({ id: p.id, name: p.name }));

  // Cheap, roster-wide: name/avatar/tier for every member, plus one
  // aggregate row per athlete for their most recent workout (a Postgres
  // GROUP BY via RPC, not a raw fetch-every-log-row-and-reduce-in-JS scan
  // — a stress-test pass found the old approach shipping a 1.1MB payload
  // and taking 18.5s at 500 athletes). Credits/wellness/integrity are
  // each a heavier per-athlete join (especially integrity's session/set
  // join) and are deliberately NOT computed here for the whole roster —
  // ClientCardGrid fetches those client-side, scoped to just the
  // currently-visible page of athletes, once pagination is applied.
  const [{ data: memberships, error: rosterError }, { data: lastWorkoutRows }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select(
        "role, profiles ( id, full_name, avatar_url, claimed_at ), profile_id, client_tier, position_id, group_positions!group_memberships_position_id_fkey ( name )"
      )
      .eq("group_id", params.groupId),
    supabase.rpc("get_last_workout_per_athlete", { p_group_id: params.groupId }),
  ]);

  const lastLogByAthlete = new Map<string, string>();
  for (const row of (lastWorkoutRows ?? []) as { athlete_id: string; last_logged_at: string }[]) {
    lastLogByAthlete.set(row.athlete_id, row.last_logged_at);
  }

  // Category 2 (Milestone Celebrations) — which nutrition phase (if any)
  // each athlete is tagged with. Cheap and roster-wide (just a phase
  // string per tagged athlete, not the underlying macro/weight time
  // series) so the "Goal" filter can operate on the FULL roster before
  // pagination, same as the existing Tier filter — unlike the heavier
  // per-athlete trend computation below, which stays properly scoped.
  const { data: taggedPhaseRows } = await supabase
    .from("nutrition_phases")
    .select("athlete_id, phase")
    .eq("group_id", params.groupId);
  const phaseByAthleteId = new Map<string, MilestonePhaseTag>();
  for (const row of taggedPhaseRows ?? []) {
    phaseByAthleteId.set(row.athlete_id, row.phase as MilestonePhaseTag);
  }

  // This group's invite links (live, expired and cancelled). The revoked_at column comes from a
  // later database update; without it the list simply has no "cancelled" state.
  const inviteSelect = "id, code, created_at, expires_at";
  let inviteQuery = await supabase
    .from("group_invites")
    .select(`${inviteSelect}, revoked_at`)
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (inviteQuery.error) {
    inviteQuery = (await supabase
      .from("group_invites")
      .select(inviteSelect)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(50)) as typeof inviteQuery;
  }
  const groupInvites: GroupInviteRow[] = ((inviteQuery.data ?? []) as unknown as {
    id: string;
    code: string;
    created_at: string;
    expires_at: string | null;
    revoked_at?: string | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at ?? null,
  }));

  // Clients who haven't signed in yet: which of them already has a live invite link.
  const unclaimedIds = (memberships ?? [])
    .filter((m: any) => m.role === "athlete" && !m.profiles?.claimed_at)
    .map((m: any) => m.profile_id as string);
  const latestInviteByAthlete = new Map<string, { expiresAt: string; usedAt: string | null; revokedAt: string | null }>();
  if (unclaimedIds.length > 0) {
    // revoked_at comes from a later database update; without it the query is retried without that column.
    const loadInvites = (columns: string) =>
      supabase.from("client_invites").select(columns).in("athlete_id", unclaimedIds).order("created_at", { ascending: false });
    let inviteResult = await loadInvites("athlete_id, expires_at, used_at, created_at, revoked_at");
    if (inviteResult.error) inviteResult = await loadInvites("athlete_id, expires_at, used_at, created_at");
    for (const r of (inviteResult.data ?? []) as unknown as {
      athlete_id: string;
      expires_at: string;
      used_at: string | null;
      revoked_at?: string | null;
    }[]) {
      if (!latestInviteByAthlete.has(r.athlete_id)) {
        latestInviteByAthlete.set(r.athlete_id, { expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at ?? null });
      }
    }
  }

  const roster: RosterMember[] = (memberships ?? []).map((m: any) => ({
    signInStatus: claimStatus({
      claimedAt: m.profiles?.claimed_at ?? null,
      latestInvite: latestInviteByAthlete.get(m.profile_id) ?? null,
    }),
    profileId: m.profile_id,
    fullName: m.profiles?.full_name ?? "Unknown",
    avatarUrl: m.profiles?.avatar_url ?? null,
    role: m.role,
    lastWorkoutAt: lastLogByAthlete.get(m.profile_id) ?? null,
    clientTier: m.client_tier ?? null,
    nutritionPhase: phaseByAthleteId.get(m.profile_id) ?? null,
    positionId: m.position_id ?? null,
    positionName: m.group_positions?.name ?? null,
  }));

  roster.sort((a, b) => {
    if (a.role !== b.role) return a.role === "coach" ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const coaches = roster.filter((m) => m.role === "coach");
  const athletes = roster.filter((m) => m.role === "athlete");

  // coach_mobile_v2_feature_spec.md item 1 — mobile gets the A-Z/
  // needs-attention roster instead of the desktop card grid. Short-
  // circuits before the phase-alignment summary below, which is
  // desktop-only and would otherwise cost extra per-athlete queries
  // this branch never uses — same pattern app/groups/[groupId]/page.tsx
  // already uses to skip its own desktop-only work.
  if (await prefersAthleteStyleView()) {
    return (
      <CoachMobileShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} activeOverride="roster">
        <div className="min-h-screen bg-graphite text-chalk font-body pb-24 px-5 pt-8">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="font-display font-bold text-2xl uppercase leading-none">
                <SwappableTerm termKey="client" form="plural" className="capitalize" />
              </h1>
              <p className="font-body text-sm text-steel mt-1">
                {athletes.length} {athletes.length === 1 ? "client" : "clients"}
              </p>
            </div>
            <AddClientButton groupId={params.groupId} groupName={group?.name ?? "This group"} createdBy={user.id} />
          </div>
          <CoachRosterMobile groupId={params.groupId} members={athletes} />
        </div>
      </CoachMobileShell>
    );
  }

  // Category 2 (Milestone Celebrations) — Ron's own framing: the
  // platform should be able to "intuit what you're doing by your trend
  // lines," and a coach with too many clients whose trend doesn't match
  // their tagged goal is itself a useful signal, not just each client's
  // own concern. Deliberately bounded to the small set of athletes a
  // coach has actually tagged (not a per-athlete scan of the whole
  // roster) — same cost discipline as the rest of this page, which
  // already keeps every per-athlete-heavy computation off the main
  // roster query.
  let phaseAlignmentSummary: { total: number; misaligned: number } | null = null;
  if (phaseByAthleteId.size > 0) {
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
    let judged = 0;
    let misaligned = 0;
    for (const [athleteId, phase] of phaseByAthleteId) {
      const [{ data: macroRows }, { data: weightRows }] = await Promise.all([
        supabase
          .from("daily_macros")
          .select("log_date, calories")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .gte("log_date", sixWeeksAgo.toISOString().slice(0, 10)),
        supabase
          .from("body_weight_logs")
          .select("logged_date, weight")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .gte("logged_date", sixWeeksAgo.toISOString().slice(0, 10)),
      ]);
      const calorieSeries = calorieSeriesWithStanding(
        (macroRows ?? [])
          .filter((r) => r.calories != null)
          .map((r) => ({ date: r.log_date as string, value: r.calories as number })),
        await fetchStandingTarget(supabase, athleteId),
        sixWeeksAgo.toISOString().slice(0, 10),
        new Date().toISOString().slice(0, 10)
      );
      const weightSeries = (weightRows ?? []).map((r) => ({
        date: r.logged_date as string,
        value: r.weight as number,
      }));
      const classification = classifyNutritionTrend(calorieSeries, weightSeries, new Date());
      if (!classification) continue;
      judged += 1;
      if (!isTrendAligned(classification, phase)) misaligned += 1;
    }
    if (judged > 0) phaseAlignmentSummary = { total: judged, misaligned };
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">
            <SwappableTerm termKey="client" form="plural" className="capitalize" />
          </h1>
          <p className="font-body text-sm text-steel mt-2">
            {athletes.length} {athletes.length === 1 ? "client" : "clients"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AddClientButton groupId={params.groupId} groupName={group?.name ?? "This group"} createdBy={user.id} />
        </div>
      </div>

      {phaseAlignmentSummary && phaseAlignmentSummary.misaligned > 0 && (
        <div className="mb-6 px-4 py-3 border border-rust/30 bg-rust/5">
          <p className="font-body text-sm">
            {phaseAlignmentSummary.misaligned} of {phaseAlignmentSummary.total} tagged nutrition
            phases {phaseAlignmentSummary.misaligned === 1 ? "isn't" : "aren't"} trending toward their
            goal yet — worth a look on those client profiles.
          </p>
        </div>
      )}

      {coaches.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Coaching Staff
          </h2>
          <div className="divide-y divide-steel/15">
            {coaches.map((c) => (
              <div key={c.profileId} className="flex items-center gap-3 py-2">
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-surface border border-steel/30 flex items-center justify-center">
                    <span className="font-display text-xs text-chalk">
                      {c.fullName
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="font-body text-sm">{c.fullName}</span>
                <span className="font-body text-xs text-rust">Coach</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <GroupInvitesPanel
        groupId={params.groupId}
        createdBy={user.id}
        invites={groupInvites}
        oneOnOneClientName={
          (group as { group_kind?: string } | null)?.group_kind === "one_on_one" && athletes.length > 0
            ? athletes[0].fullName
            : null
        }
      />

      {rosterError ? (
        <UnavailableState what="your clients" />
      ) : (
        <ClientCardGrid groupId={params.groupId} members={athletes} positions={positions} />
      )}
    </CoachDesktopShell>
  );
}
