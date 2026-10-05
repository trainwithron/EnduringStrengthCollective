import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { GroupSessionsManager, type ClassRow, type ClientOption } from "@/components/coach/desktop/group-sessions-manager";
import { getCoachedGroups } from "@/lib/coach-groups";
import { getGroupCoachTimezone } from "@/lib/timezone";

// A coach's small-group sessions: schedule one with spots, see who is in and waiting, add or remove people, mark attendance.
// Needs migration 0263; until it is applied the page says so.
export default async function GroupSessionsPage(props: { params: Promise<{ groupId: string }> }) {
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
        <p className="font-body text-steel text-center">Only coaches can manage group sessions.</p>
      </main>
    );
  }

  const earliest = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: group }, timezone, sessionsResult] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    getGroupCoachTimezone(supabase, params.groupId),
    supabase
      .from("group_sessions")
      .select("id, title, start_at, end_at, capacity, location_note, status")
      .eq("coach_id", user.id)
      .gte("start_at", earliest)
      .order("start_at", { ascending: true })
      .limit(100),
  ]);

  const notReady = !!sessionsResult.error;
  const sessions = sessionsResult.data ?? [];
  const ids = sessions.map((s: any) => s.id as string);

  const [attendeeResult, coached] = await Promise.all([
    ids.length > 0
      ? supabase
          .from("group_session_attendees")
          .select("group_session_id, athlete_id, status, credit_taken, added_by_coach, created_at, profiles ( full_name )")
          .in("group_session_id", ids)
          .in("status", ["joined", "waitlisted", "attended"])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    getCoachedGroups(supabase, user.id),
  ]);

  const attendeesBySession = new Map<string, ClassRow["attendees"]>();
  for (const a of (attendeeResult.data ?? []) as any[]) {
    const list = attendeesBySession.get(a.group_session_id) ?? [];
    list.push({
      athleteId: a.athlete_id,
      name: a.profiles?.full_name ?? "Client",
      status: a.status,
      creditTaken: !!a.credit_taken,
      addedByCoach: !!a.added_by_coach,
    });
    attendeesBySession.set(a.group_session_id, list);
  }

  const classes: ClassRow[] = sessions.map((s: any) => ({
    id: s.id,
    title: s.title,
    startIso: s.start_at,
    endIso: s.end_at,
    capacity: s.capacity,
    locationNote: s.location_note ?? null,
    status: s.status,
    attendees: attendeesBySession.get(s.id) ?? [],
  }));

  // Everyone this coach can add: the clients in the groups they coach.
  const coachedIds = coached.map((g) => g.id);
  const { data: clientRows } = coachedIds.length
    ? await supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .in("group_id", coachedIds)
        .eq("role", "athlete")
        .eq("membership_type", "training")
        .limit(600)
    : { data: [] as any[] };
  const seen = new Set<string>();
  const clients: ClientOption[] = [];
  for (const r of (clientRows ?? []) as any[]) {
    if (seen.has(r.profile_id)) continue;
    seen.add(r.profile_id);
    clients.push({ athleteId: r.profile_id, name: r.profiles?.full_name ?? "Client" });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="group-sessions">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Group Sessions</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Small classes with a number of spots. Your clients see them on their Classes page and join with one tap; when it is full, the next
          people wait and move in if someone leaves.
        </p>
      </div>
      {notReady ? (
        <p className="font-body text-sm text-steel">Group sessions aren&apos;t switched on yet. They will appear here once they are.</p>
      ) : (
        <GroupSessionsManager groupId={params.groupId} timezone={timezone} classes={classes} clients={clients} nowIso={new Date().toISOString()} />
      )}
    </CoachDesktopShell>
  );
}
