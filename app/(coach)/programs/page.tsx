import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { programDayShape } from "@/lib/program-completeness";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { computeProgramCardVisuals } from "@/lib/program-card-data";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { pickCoachAnchor } from "@/lib/coach-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { ALL_PROGRAMS_HREF, clientFromSearch, groupFromSearch, scopePrograms } from "@/lib/programs-scope";

// The coach's Programs page: ALL of their programs, whichever group or client each one belongs to, wherever the coach is standing. It is scoped to one client only when the address says so
// (?client=, which a client's own Programs tab uses), with a plain label and a one-click way back to everything. Nothing about the scope is stored, so it never sticks.
export default async function CoachProgramsPage(props: { searchParams: Promise<{ client?: string | string[]; group?: string | string[] }> }) {
  const search = await props.searchParams;
  const clientId = clientFromSearch(search.client);
  const requestedGroupId = groupFromSearch(search.group);
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
        Only coaches can manage <SwappableTerm termKey="program" form="plural" />.
      </NoAccess>
    );
  }
  // Phones keep their own pages.
  if (await prefersAthleteStyleView()) redirect(`/groups/${anchor.id}/programs`);

  const inOrg = groupsInOrgOf(groups, anchor.id);
  const groupIds = inOrg.map((g) => g.id);
  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select("id, group_id, name, is_active, cover_image_path, athlete_id, profiles!programs_athlete_id_fkey ( full_name ), workouts(id, group_workout_exercises(count))")
    .in("group_id", groupIds.length > 0 ? groupIds : [""])
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  const all: ProgramCardData[] = (programs ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    isActive: p.is_active,
    ...programDayShape(p.workouts),
    coverImagePath: p.cover_image_path ?? null,
    athleteId: p.athlete_id,
    athleteName: p.profiles?.full_name ?? null,
    groupId: p.group_id,
  }));

  // The scoped client's name (for the label) and the place a new program for them goes.
  let scopedName: string | null = null;
  let newProgramGroupId = anchor.id;
  let newProgramQuery = "";
  // The group the client was being looked at in (the profile's own group, else their one-on-one space), whose shared programs are part of their list.
  let clientGroupId: string | null = null;
  if (clientId) {
    const clients = await getCoachClients(supabase, user.id, anchor.id);
    const client = clients.find((c) => c.id === clientId);
    clientGroupId = requestedGroupId && groupIds.includes(requestedGroupId) ? requestedGroupId : (client?.groupId ?? null);
    scopedName = client?.fullName ?? all.find((p) => p.athleteId === clientId)?.athleteName ?? "this client";
    if (client) {
      newProgramGroupId = client.groupId;
      newProgramQuery = `?athleteId=${encodeURIComponent(client.id)}`;
    }
  }

  const cards = scopePrograms(all, clientId, clientGroupId);
  const uncoveredProgramIds = cards.filter((c) => !c.coverImagePath).map((c) => c.id);
  const visualsMap = await computeProgramCardVisuals(supabase, uncoveredProgramIds, user.id);
  const visualsByProgramId = Object.fromEntries(visualsMap);

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="programs" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="program" form="plural" className="capitalize" />
        </h1>
        {clientId ? (
          <p className="font-body text-sm text-chalk mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
            <span>
              Showing <span className="font-medium">{scopedName}</span>&apos;s programs only
            </span>
            <Link href={ALL_PROGRAMS_HREF} className="font-body text-sm text-rust underline underline-offset-2 min-h-11 sm:min-h-0 inline-flex items-center">
              Show all programs
            </Link>
          </p>
        ) : null}
        <p className="font-body text-sm text-steel mt-2">
          {cards.length} {cards.length === 1 ? "program" : "programs"}
        </p>
        <div className="flex items-center gap-4 mt-4">
          <Link href={`/groups/${newProgramGroupId}/programs/import`} className="font-body text-xs text-rust">
            Import or build with AI →
          </Link>
          <Link href={`/groups/${newProgramGroupId}/programs/new${newProgramQuery}`} className="font-body text-xs text-rust">
            + New program
          </Link>
        </div>
      </div>

      {programsError ? <UnavailableState what="your programs" /> : <ProgramCardGrid groupId={anchor.id} programs={cards} visualsByProgramId={visualsByProgramId} />}
    </CoachDesktopShell>
  );
}
