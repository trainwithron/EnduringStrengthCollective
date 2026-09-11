import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import {
  TeamDepthChart,
  type TeamPosition,
  type TeamPlayer,
} from "@/components/coach/desktop/team-depth-chart";
import { CoachPositionScopeList, type CoachStaffRow } from "@/components/coach/desktop/coach-position-scope-list";

export default async function TeamPage(props: { params: Promise<{ groupId: string }> }) {
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
        <p className="font-body text-steel text-center">Only coaches can manage the team.</p>
      </main>
    );
  }

  // Group (for team_mode + name), the position list, and the roster are
  // independent lookups — one round trip instead of three.
  const [{ data: group }, { data: positionRows }, { data: memberRows }, { data: coachRows }] = await Promise.all([
    supabase.from("groups").select("name, team_mode").eq("id", params.groupId).single(),
    supabase
      .from("group_positions")
      .select("id, name, sort_order")
      .eq("group_id", params.groupId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("group_memberships")
      .select("profile_id, role, position_id, depth_order, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("role", "athlete"),
    supabase
      .from("group_memberships")
      .select("profile_id, coach_position_id, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("role", "coach"),
  ]);

  const positions: TeamPosition[] = (positionRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sortOrder: p.sort_order,
  }));

  const players: TeamPlayer[] = (memberRows ?? [])
    .map((m: any) => ({
      profileId: m.profile_id,
      fullName: m.profiles?.full_name ?? "Unknown",
      positionId: m.position_id ?? null,
      depthOrder: m.depth_order ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const coaches: CoachStaffRow[] = (coachRows ?? [])
    .map((c: any) => ({
      profileId: c.profile_id,
      fullName: c.profiles?.full_name ?? "Unknown",
      coachPositionId: c.coach_position_id ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <CoachDesktopShell
      groupId={params.groupId}
      groupName={group?.name ?? "Coaching"}
      active="team"
    >
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Team</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Position groups and a depth chart for this roster. Everything else — programming,
          logging, the feed — works exactly the same; this just adds who plays where.
        </p>
      </div>

      {group?.team_mode && positions.length > 0 && (
        <CoachPositionScopeList groupId={params.groupId} positions={positions} initialCoaches={coaches} />
      )}

      <TeamDepthChart
        groupId={params.groupId}
        teamMode={group?.team_mode ?? false}
        initialPositions={positions}
        initialPlayers={players}
      />
    </CoachDesktopShell>
  );
}
