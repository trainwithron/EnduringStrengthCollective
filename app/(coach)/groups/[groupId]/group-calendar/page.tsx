import { readRowsByIds } from "@/lib/read-by-ids";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import type { EventPerson } from "@/components/coach/group-event-admin";
import { GroupCalendarBoard, type BoardItem, type BoardShow } from "@/components/coach/desktop/group-calendar-board";
import type { ClassRow, ClientOption } from "@/components/coach/desktop/group-sessions-manager";
import { groupsInOrgOfOpened } from "@/lib/coach-groups";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { SwappableTerm } from "@/components/coach/swappable-term";

export const metadata = { title: "Group calendar" };

type SearchParams = Record<string, string | undefined>;

// One group's calendar: its events (free; members answer In or Out) and the coach's group sessions (one session each, spots and a waiting list) on ONE page
// (layout audit, Oct 31: Group sessions now opens here). ?scope=all shows every group the coach coaches in this organization; ?show=events|sessions picks one
// kind; ?id= opens one card. A one-on-one client's sessions never appear here; they are on the coach's Calendar.
export default async function GroupCalendarPage(props: { params: Promise<{ groupId: string }>; searchParams: Promise<SearchParams> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") return <NoAccess>Only coaches can manage group events.</NoAccess>;

  const allGroups = searchParams.scope === "all";
  const show: BoardShow = searchParams.show === "events" || searchParams.show === "sessions" ? searchParams.show : "all";
  const orgGroups = await groupsInOrgOfOpened(supabase, user.id, params.groupId);
  const groupNameById = new Map(orgGroups.map((g) => [g.id, g.name]));
  const orgIds = orgGroups.some((g) => g.id === params.groupId) ? orgGroups.map((g) => g.id) : [params.groupId, ...orgGroups.map((g) => g.id)];
  const scopeIds = allGroups ? orgIds : [params.groupId];

  const earliest = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: group }, timezone, eventsResult, sessionsResult] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    getGroupCoachTimezone(supabase, params.groupId),
    allGroups
      ? readRowsByIds(
          scopeIds,
          (g) => (from, to) =>
            supabase.from("group_sessions").select("id, group_id, title, start_at, status, location_note, note, capacity").eq("kind", "event").in("group_id", g).gte("start_at", earliest).order("start_at").order("id").range(from, to),
          { pageSize: 100, maxPages: 1 }
        )
      : supabase
          .from("group_sessions")
          .select("id, group_id, title, start_at, status, location_note, note, capacity")
          .eq("kind", "event")
          .eq("group_id", params.groupId)
          .gte("start_at", earliest)
          .order("start_at", { ascending: true })
          .limit(100),
    readRowsByIds(
      scopeIds,
      (g) => (from, to) =>
        supabase
          .from("group_sessions")
          .select("id, group_id, title, start_at, end_at, capacity, location_note, status")
          .eq("kind", "class")
          .eq("coach_id", user.id)
          .in("group_id", g)
          .gte("start_at", earliest)
          .order("start_at", { ascending: true })
          .order("id")
          .range(from, to),
      { pageSize: 100, maxPages: 1 }
    ),
  ]);
  if (eventsResult.error || sessionsResult.error) return <LoadFailedPage />;

  const events = (eventsResult.data ?? []) as { id: string; group_id: string; title: string; start_at: string; status: string; location_note: string | null; note: string | null; capacity: number | null }[];
  const sessions = (sessionsResult.data ?? []) as { id: string; group_id: string; title: string; start_at: string; end_at: string; capacity: number; location_note: string | null; status: "scheduled" | "cancelled" }[];
  const eventIds = events.map((e) => e.id);
  const sessionIds = sessions.map((s) => s.id);

  const [eventPeople, sessionPeople, clientRows] = await Promise.all([
    eventIds.length
      ? supabase.from("group_session_attendees").select("group_session_id, athlete_id, status, profiles!group_session_attendees_athlete_id_fkey ( full_name )").in("group_session_id", eventIds)
      : Promise.resolve({ data: [] as any[] }),
    sessionIds.length
      ? supabase
          .from("group_session_attendees")
          .select("group_session_id, athlete_id, status, credit_taken, added_by_coach, created_at, profiles!group_session_attendees_athlete_id_fkey ( full_name )")
          .in("group_session_id", sessionIds)
          .in("status", ["joined", "waitlisted", "attended"])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    // Everyone this coach can add to a group session: the clients in this organization's groups.
    readRowsByIds(
      orgIds,
      (g) => (from, to) =>
        supabase.from("group_memberships").select("profile_id, profiles ( full_name )").in("group_id", g).eq("role", "athlete").eq("membership_type", "training").order("id").range(from, to),
      { pageSize: 600, maxPages: 1 }
    ),
  ]);

  const peopleByEvent = new Map<string, EventPerson[]>();
  for (const a of (eventPeople.data ?? []) as any[]) {
    const list = peopleByEvent.get(a.group_session_id) ?? [];
    list.push({ athleteId: a.athlete_id, name: a.profiles?.full_name ?? "A member", status: a.status });
    peopleByEvent.set(a.group_session_id, list);
  }
  const attendeesBySession = new Map<string, ClassRow["attendees"]>();
  for (const a of (sessionPeople.data ?? []) as any[]) {
    const list = attendeesBySession.get(a.group_session_id) ?? [];
    list.push({ athleteId: a.athlete_id, name: a.profiles?.full_name ?? "Client", status: a.status, creditTaken: !!a.credit_taken, addedByCoach: !!a.added_by_coach });
    attendeesBySession.set(a.group_session_id, list);
  }

  const items: BoardItem[] = [
    ...events.map(
      (r): BoardItem => ({
        kind: "event",
        id: r.id,
        groupName: groupNameById.get(r.group_id) ?? group?.name ?? "Group",
        event: { id: r.id, title: r.title, startAt: r.start_at, status: r.status, place: r.location_note, note: r.note, capacity: r.capacity },
        people: peopleByEvent.get(r.id) ?? [],
      })
    ),
    ...sessions.map(
      (s): BoardItem => ({
        kind: "session",
        id: s.id,
        groupName: groupNameById.get(s.group_id) ?? group?.name ?? "Group",
        cls: { id: s.id, title: s.title, startIso: s.start_at, endIso: s.end_at, capacity: s.capacity, locationNote: s.location_note ?? null, status: s.status, attendees: attendeesBySession.get(s.id) ?? [] },
      })
    ),
  ];

  const seen = new Set<string>();
  const clients: ClientOption[] = [];
  for (const r of (clientRows.data ?? []) as any[]) {
    if (seen.has(r.profile_id)) continue;
    seen.add(r.profile_id);
    clients.push({ athleteId: r.profile_id, name: r.profiles?.full_name ?? "Client" });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));

  const base = `/groups/${params.groupId}/group-calendar`;
  const keep = show === "all" ? "" : `show=${show}`;
  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Group"} active="group-calendar">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="group" form="singular" className="capitalize" /> calendar
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[80ch]">
          Events and group sessions for {allGroups ? "all your groups" : (group?.name ?? "this group")}. An event costs no session and members answer In or Out. A group session has spots, uses one session for each person who joins, and fills a waiting list when it is full.
        </p>
      </div>
      <GroupCalendarBoard
        items={items}
        clients={clients}
        groupId={params.groupId}
        groupName={group?.name ?? "Group"}
        timezone={timezone}
        nowIso={new Date().toISOString()}
        initialShow={show}
        initialId={searchParams.id ?? null}
        allGroups={allGroups}
        scopeHref={{ group: keep ? `${base}?${keep}` : base, all: `${base}?scope=all${keep ? `&${keep}` : ""}` }}
      />
    </CoachDesktopShell>
  );
}
