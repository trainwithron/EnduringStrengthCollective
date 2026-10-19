import Link from "next/link";
import { after } from "next/server";
import { readRowsByIds } from "@/lib/read-by-ids";
import { redirect } from "next/navigation";
import { createServerClient, createSnapshotServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { programDayShape } from "@/lib/program-completeness";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import { ProgramsList } from "@/components/coach/desktop/programs-list";
import { defaultList, type RemovedProgram } from "@/lib/programs-filter";
import { sweepEmptyPrograms } from "@/lib/empty-sweep";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { coachedOrgs, getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { ProgramsPhoneList } from "@/components/coach/mobile/programs-phone-list";
import { LearnedSection } from "@/components/coach/learned-section";
import { ConversationInviteSection } from "@/components/coach/conversation-section";
import { ALL_PROGRAMS_HREF, clientFromSearch, groupFromSearch, scopePrograms } from "@/lib/programs-scope";

export const metadata = { title: "Programs" };

// Charts are drawn for the cards a coach sees first only (SPEED, Oct 19, measured live: charts for every card kept the page loading 10 to 12 seconds and loaded the database the whole time).
// The list is newest changed first, so these are the top cards; the rest show the plain card. A dozen programs is a few hundred rows in a handful of requests.
const CHARTED_CARDS = 12;

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
  // (A phone gets this same page, over the whole organization it is working in: it used to be sent to ONE group's programs, and the "Show all programs" link on that page sent it straight back.)
  const inOrg = groupsInOrgOf(groups, anchor.id);
  const groupIds = inOrg.map((g) => g.id);
  // His own programs with nothing in them (no exercise, no session, no copy), untouched for 24 hours, are removed quietly (AI builder leftovers). After the page is sent (SPEED, Oct 19): it never holds
  // the page up, and a program it removes is gone from the next visit.
  // Its client is made now, from a copy of this request's cookies: request APIs cannot be used once the page is sent. A failure is logged, never shown.
  const sweepClient = await createSnapshotServerClient();
  after(async () => {
    try {
      const removed = await sweepEmptyPrograms(sweepClient, user.id, groupIds);
      console.log(`programs sweep ran: removed ${removed} empty program(s)`);
    } catch (e) {
      console.error("programs sweep failed:", e instanceof Error ? e.message : e);
    }
  });
  // Everything below that does not depend on another read runs at once (SPEED, Oct 19: the page took 4.5 to 5 seconds reading one thing after another).
  // (The coach's groups can pass a request's URL limit and the 1,000-row cap, so the ids go in groups and each is read a page at a time; the newest change first after they are put together.)
  const programsRead = readRowsByIds(groupIds, (g) => (from, to) =>
    supabase
      .from("programs")
      .select("id, group_id, name, is_active, ai_draft, cover_image_path, athlete_id, source_program_id, training_intent, updated_at, profiles!programs_athlete_id_fkey ( full_name ), workouts(id, group_workout_exercises(count))")
      .in("group_id", g)
      .is("archived_at", null)
      .order("id")
      .range(from, to)
  );

  // Every program the coach removed (kept, with every log), library or one client's: found under "Removed programs" and under its client, with Put back and Delete.
  const hiddenRead = clientId
    ? Promise.resolve({ data: [] as any[] })
    : readRowsByIds(groupIds, (g) => (from, to) =>
        supabase
          .from("programs")
          .select("id, name, group_id, athlete_id, archived_at, profiles!programs_athlete_id_fkey ( full_name )")
          .in("group_id", g)
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: false })
          .order("id")
          .range(from, to)
      ).then((r) => ({ data: r.data.sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at))).slice(0, 200) }));

  // How many template slots each library program holds (the Templates filter and the card's mark).
  const slotsRead = readRowsByIds(groupIds, (g) => (from, to) =>
    supabase.from("group_workout_exercises").select("id, workouts!inner ( program_id )").eq("is_slot", true).in("group_id", g).order("id").range(from, to)
  );
  // "Assigned to": the people holding a copy of a program (the copies in this organization's groups, read by group, not by a long list of program ids).
  const copiesRead = clientId
    ? Promise.resolve({ data: [] as any[] })
    : readRowsByIds(groupIds, (g) => (from, to) =>
        supabase.from("programs").select("id, source_program_id").in("group_id", g).not("source_program_id", "is", null).not("athlete_id", "is", null).is("archived_at", null).order("id").range(from, to)
      );

  const [{ data: programsUnsorted, error: programsError }, { data: hiddenRows }, { data: slotRows }, { data: copyRows }, onPhone] = await Promise.all([
    programsRead,
    hiddenRead,
    slotsRead,
    copiesRead,
    prefersAthleteStyleView(),
  ]);
  const programs = programsUnsorted.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const removed: RemovedProgram[] = ((hiddenRows ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, groupId: r.group_id, athleteId: r.athlete_id ?? null, athleteName: r.profiles?.full_name ?? null }));
  const assignedCounts = new Map<string, number>();
  for (const r of (copyRows ?? []) as { source_program_id: string }[]) assignedCounts.set(r.source_program_id, (assignedCounts.get(r.source_program_id) ?? 0) + 1);
  const slotCountByProgram = new Map<string, number>();
  for (const r of (slotRows ?? []) as any[]) {
    const pid = r.workouts?.program_id as string | undefined;
    if (pid) slotCountByProgram.set(pid, (slotCountByProgram.get(pid) ?? 0) + 1);
  }

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
    slotCount: slotCountByProgram.get(p.id) ?? 0,
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
  // "Assigned to (n)": the people holding copies, plus the person holding the program itself (the first person a program is assigned to gets the original).
  for (const c of scoped) if (!c.sourceProgramId) c.assignedCount = (assignedCounts.get(c.id) ?? 0) + (c.athleteId ? 1 : 0);
  // A phone gets simple cards in the mobile shell (not this desktop page squeezed): name, Active, days, tap to open.
  if (onPhone) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        {/* Programs lives under More on the phone, so More is lit here (not Home). */}
        <CoachMobileShell groupId={anchor.id} groupName={anchor.name} activeOverride="more">
          <header className="px-5 pt-16 pb-3">
            <h1 className="font-display font-bold text-3xl leading-none uppercase">
              <SwappableTerm termKey="program" form="plural" className="capitalize" />
            </h1>
            {clientId ? (
              <p className="font-body text-sm text-chalk mt-2" role="status">
                {scopedName}&apos;s programs.{" "}
                <Link href={ALL_PROGRAMS_HREF} className="text-rust underline underline-offset-2">
                  Show all programs
                </Link>
              </p>
            ) : null}
            {coachedOrgs(groups).length > 1 && (
              <p className="font-body text-sm text-steel mt-2">
                Programs of <span className="text-chalk">{anchor.orgName}</span>.{" "}
                <Link href={`${CHOOSE_ORGANIZATION_PATH}?next=/programs`} className="text-rust underline underline-offset-2">
                  Change organization
                </Link>
              </p>
            )}
          </header>
          {programsError ? <UnavailableState what="your programs" /> : <ProgramsPhoneList programs={cards} groupIdFor={(p) => p.groupId ?? anchor.id} newProgramGroupId={newProgramGroupId} />}
        </CoachMobileShell>
      </main>
    );
  }

  // Charts only for the first CHARTED_CARDS cards without a cover (the ones on screen; newest changed first): the rest show the plain card.
  const uncoveredProgramIds = cards.filter((c) => !c.coverImagePath).slice(0, CHARTED_CARDS).map((c) => c.id);

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
        {coachedOrgs(groups).length > 1 && (
          <p className="font-body text-sm text-steel mt-2">
            Programs of <span className="text-chalk">{anchor.orgName}</span>.{" "}
            <Link href={`${CHOOSE_ORGANIZATION_PATH}?next=/programs`} className="text-rust underline underline-offset-2">
              Change organization
            </Link>
          </p>
        )}
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
      ) : (
        // The page finishes with the list; the browser asks for the charts after it has shown (SPEED, Oct 19, measured live: streaming them kept the tab loading 5 more seconds).
        clientId ? (
          <ProgramCardGrid groupId={anchor.id} programs={cards} visualsByProgramId={{}} chartProgramIds={uncoveredProgramIds} />
        ) : (
          <ProgramsList groupId={anchor.id} programs={scoped} removed={removed} visualsByProgramId={{}} chartProgramIds={uncoveredProgramIds} />
        )
      )}

      {!clientId && <LearnedSection supabase={supabase} coachId={user.id} />}
    </CoachDesktopShell>
  );
}
