import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { programDayShape } from "@/lib/program-completeness";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import { ProgramsList } from "@/components/coach/desktop/programs-list";
import { defaultList, type RemovedProgram } from "@/lib/programs-filter";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { computeProgramCardVisuals } from "@/lib/program-card-data";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { LearnedSection } from "@/components/coach/learned-section";
import { ConversationInviteSection } from "@/components/coach/conversation-section";
import { countAssignedTo } from "@/lib/program-assigned";
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

  // The organization the coach chose stays chosen: this page stands on its group, never on the first group by name across every organization.
  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=/programs`);
  const groups = active?.groups ?? [];
  const anchor = active?.anchor ?? null;
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
    .select("id, group_id, name, is_active, ai_draft, cover_image_path, athlete_id, source_program_id, training_intent, updated_at, profiles!programs_athlete_id_fkey ( full_name ), workouts(id, group_workout_exercises(count))")
    .in("group_id", groupIds.length > 0 ? groupIds : [""])
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  // Every program the coach removed (kept, with every log), library or one client's: found under "Removed programs" and under its client, with Put back and Delete.
  const { data: hiddenRows } = clientId
    ? { data: [] }
    : await supabase
        .from("programs")
        .select("id, name, group_id, athlete_id, profiles!programs_athlete_id_fkey ( full_name )")
        .in("group_id", groupIds.length > 0 ? groupIds : [""])
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .limit(200);
  const removed: RemovedProgram[] = ((hiddenRows ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, groupId: r.group_id, athleteId: r.athlete_id ?? null, athleteName: r.profiles?.full_name ?? null }));

  const all: ProgramCardData[] = (programs ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    isActive: p.is_active,
    aiDraft: p.ai_draft === true,
    ...programDayShape(p.workouts),
    coverImagePath: p.cover_image_path ?? null,
    athleteId: p.athlete_id,
    athleteName: p.profiles?.full_name ?? null,
    sourceProgramId: p.source_program_id ?? null,
    trainingIntent: p.training_intent ?? null,
    updatedAt: p.updated_at ?? null,
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

  // The library page lists programs with no client on them. A client's own version of a library program (it has a source) is never a card here: it is reached from the client's profile and from
  // the program's "Assigned to". Programs built straight for one client (no source) sit in one collapsed fold. Scoped to one client (?client=), the client's own programs show as before.
  // The page is ONE flat list: the library programs and the programs built straight for one client, newest changed first. A client's own copy of a library program is not in the default list (it is under
  // the program's "Assigned to" and on the client's profile); the "One client" filter brings a client's copies in. Scoped to one client (?client=), their own programs show as before.
  const scoped = scopePrograms(all, clientId, clientGroupId);
  const cards = clientId ? scoped : defaultList(scoped);
  const assignedCounts = clientId ? new Map<string, number>() : await countAssignedTo(supabase, scoped.filter((c) => !c.athleteId).map((c) => c.id));
  for (const c of scoped) if (!c.athleteId) c.assignedCount = assignedCounts.get(c.id) ?? 0;
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
          <Link href={`/groups/${newProgramGroupId}/programs/new${newProgramQuery}`} className="font-body text-xs text-rust">
            + New program
          </Link>
        </div>
      </div>

      {!clientId && <ConversationInviteSection supabase={supabase} coachId={user.id} />}

      {programsError ? (
        <UnavailableState what="your programs" />
      ) : clientId ? (
        <ProgramCardGrid groupId={anchor.id} programs={cards} visualsByProgramId={visualsByProgramId} />
      ) : (
        <ProgramsList groupId={anchor.id} programs={scoped} removed={removed} visualsByProgramId={visualsByProgramId} />
      )}

      {!clientId && <LearnedSection supabase={supabase} coachId={user.id} />}
    </CoachDesktopShell>
  );
}
