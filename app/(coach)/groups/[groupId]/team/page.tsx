import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import {
  TeamDepthChart,
  type TeamPosition,
  type TeamPlayer,
} from "@/components/coach/desktop/team-depth-chart";
import { CoachPositionScopeList, type CoachStaffRow } from "@/components/coach/desktop/coach-position-scope-list";
import { NewSeasonPanel } from "@/components/coach/desktop/new-season-panel";
import { UnarchiveGroupButton } from "@/components/coach/desktop/unarchive-group-button";
import Link from "next/link";

export const metadata = { title: "Team" };

export default async function TeamPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can manage the team.</NoAccess>
    );
  }

  // Group (for team_mode + name), the position list, and the roster are
  // independent lookups — one round trip instead of three.
  const [{ data: group }, { data: positionRows }, { data: memberRows, error: rosterError }, { data: coachRows }] = await Promise.all([
    supabase.from("groups").select("name, team_mode, group_kind, organization_id").eq("id", params.groupId).single(),
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

  // Whether this season has been retired (a database without the column yet reads as not retired), and the retired seasons of this organization this coach coached.
  const archivedRead = await supabase.from("groups").select("archived_at, next_season_id").eq("id", params.groupId).maybeSingle();
  const archivedAt = archivedRead.error ? null : ((archivedRead.data as { archived_at?: string | null } | null)?.archived_at ?? null);
  const nextSeasonId = archivedRead.error ? null : ((archivedRead.data as { next_season_id?: string | null } | null)?.next_season_id ?? null);
  const nextSeason = nextSeasonId ? ((await supabase.from("groups").select("id, name").eq("id", nextSeasonId).maybeSingle()).data as { id: string; name: string } | null) : null;
  let pastSeasons: { id: string; name: string }[] = [];
  if (!archivedRead.error && group?.organization_id) {
    const { data: pastRows } = await supabase
      .from("group_memberships")
      .select("groups!inner ( id, name, group_kind, organization_id, archived_at )")
      .eq("profile_id", user.id)
      .eq("role", "coach")
      .eq("groups.organization_id", group.organization_id)
      .eq("groups.group_kind", "team")
      .not("groups.archived_at", "is", null);
    pastSeasons = ((pastRows ?? []) as any[]).map((r) => r.groups).filter(Boolean).map((g) => ({ id: g.id as string, name: g.name as string })).sort((a, b) => a.name.localeCompare(b.name));
  }

  const positionNameById = new Map((positionRows ?? []).map((p) => [p.id as string, p.name as string]));
  const positions: TeamPosition[] = (positionRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sortOrder: p.sort_order,
  }));

  // A failed (or cut-off) roster read must not look like an empty team: Start next season is then not offered.
  const rosterFailed = !!rosterError || (memberRows ?? []).length >= 1000;
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

      {archivedAt && (
        <p className="font-body text-sm text-steel mb-4">
          This season is retired. It and its records are kept here.{" "}
          {nextSeason ? (
            <Link href={`/groups/${nextSeason.id}/team`} className="text-rust">
              {nextSeason.name} took over from it.
            </Link>
          ) : null}{" "}
          <UnarchiveGroupButton groupId={params.groupId} />
        </p>
      )}

      {rosterFailed && (
        <p className="font-body text-sm text-rust mb-4" role="alert">
          The roster could not be read in full, so starting next season is not offered. Reload the page to try again.
        </p>
      )}

      {group?.group_kind === "team" && !archivedAt && !rosterFailed && (
        <div className="mb-8">
          <NewSeasonPanel
            groupId={params.groupId}
            groupName={group?.name ?? "Team"}
            athletes={players.map((p) => ({ profileId: p.profileId, fullName: p.fullName, positionName: p.positionId ? positionNameById.get(p.positionId) ?? null : null }))}
          />
        </div>
      )}

      {pastSeasons.length > 0 && (
        <div className="mb-8">
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Past seasons</p>
          <ul className="space-y-1">
            {pastSeasons.map((s) => (
              <li key={s.id} className="font-body text-sm">
                <Link href={`/groups/${s.id}/team`} className="text-rust">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
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
