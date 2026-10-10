import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { GroupEventForm } from "@/components/coach/group-event-form";
import { GroupEventAdmin, type EventPerson } from "@/components/coach/group-event-admin";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { SwappableTerm } from "@/components/coach/swappable-term";

// One group's calendar: only this group's events (the group's name and GROUP tag are in the bar), who is In and Out, and a way to add the next one. A one-on-one
// client's sessions never appear here; they are on the coach's Calendar.
export default async function GroupCalendarPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return <NoAccess>Only coaches can manage group events.</NoAccess>;

  const earliest = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: group }, timezone, { data: events }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    getGroupCoachTimezone(supabase, params.groupId),
    supabase
      .from("group_sessions")
      .select("id, title, start_at, status, location_note, note, capacity")
      .eq("kind", "event")
      .eq("group_id", params.groupId)
      .gte("start_at", earliest)
      .order("start_at", { ascending: true })
      .limit(100),
  ]);
  const rows = (events ?? []) as { id: string; title: string; start_at: string; status: string; location_note: string | null; note: string | null; capacity: number | null }[];
  const ids = rows.map((r) => r.id);
  const { data: attendeeRows } = ids.length
    ? await supabase.from("group_session_attendees").select("group_session_id, athlete_id, status, profiles!group_session_attendees_athlete_id_fkey ( full_name )").in("group_session_id", ids)
    : { data: [] as any[] };
  const byEvent = new Map<string, EventPerson[]>();
  for (const a of (attendeeRows ?? []) as any[]) {
    const list = byEvent.get(a.group_session_id) ?? [];
    list.push({ athleteId: a.athlete_id, name: a.profiles?.full_name ?? "A member", status: a.status });
    byEvent.set(a.group_session_id, list);
  }
  const now = Date.now();
  const upcoming = rows.filter((r) => new Date(r.start_at).getTime() >= now);
  const past = rows.filter((r) => new Date(r.start_at).getTime() < now).reverse();
  const toAdmin = (r: (typeof rows)[number]) => (
    <GroupEventAdmin
      key={r.id}
      event={{ id: r.id, title: r.title, startAt: r.start_at, status: r.status, place: r.location_note, note: r.note, capacity: r.capacity }}
      people={byEvent.get(r.id) ?? []}
      timezone={timezone}
    />
  );

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Group"} active="group-calendar">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="group" form="singular" className="capitalize" /> calendar
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Events for {group?.name ?? "this group"} only. Members answer In or Out, and an event costs no session.
        </p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-8 items-start">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Coming up</h2>
            {upcoming.length === 0 ? <p className="font-body text-sm text-steel">Nothing scheduled. Add the next one.</p> : <ul className="space-y-3">{upcoming.map(toAdmin)}</ul>}
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Recent</h2>
              <ul className="space-y-3">{past.map(toAdmin)}</ul>
            </section>
          )}
        </div>
        <div className="min-w-0">
          <GroupEventForm groups={[{ id: params.groupId, name: group?.name ?? "Group" }]} fixedGroupId={params.groupId} timezone={timezone} />
        </div>
      </div>
    </CoachDesktopShell>
  );
}
