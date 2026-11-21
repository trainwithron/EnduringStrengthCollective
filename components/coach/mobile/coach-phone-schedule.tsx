import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRowsByIds } from "@/lib/read-by-ids";
import { chunk } from "@/lib/chunk";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import type { ClientTierLite } from "@/lib/session-type-default";
import { getCoachClients } from "@/lib/coach-clients";
import { fetchBookingCounts } from "@/lib/credit-picture";
import { dateFromKey } from "@/lib/date-key";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { SessionCountLine } from "@/components/coach/session-count-line";
import { SessionCheckSection } from "@/components/coach/session-check-section";
import { ScheduleClientPicker } from "@/components/coach/schedule-client-picker";
import { UpcomingSessionsList } from "@/components/coach/upcoming-sessions-list";
import { readCanceledSessions } from "@/lib/canceled-sessions";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// The same dots as the computer's month (components/coach/desktop/calendar-grid.tsx): an event the coach put on the calendar glows rust, a suggestion is yellow.
const DOT_EVENT = "bg-rust shadow-[0_0_5px_rgb(var(--rust)/0.7)]";
const DOT_SUGGESTION = "bg-yellow-500";
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthLabel = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export interface ScheduleClient {
  id: string;
  fullName: string;
  groupId: string;
  balance: number;
  booked: number;
  tier: ClientTierLite | null;
  setAside: boolean;
}

// Every client of the organization (a one-on-one client lives in their own group), each with their own group, balance, type and whether they are set aside: the list the coach picks from to book.
export async function loadScheduleClients(supabase: SupabaseClient, userId: string, anchorGroupId: string): Promise<ScheduleClient[]> {
  const coachClients = await getCoachClients(supabase, userId, anchorGroupId);
  const clientIds = coachClients.map((c) => c.id);
  const creditRows = (await Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids)))).flatMap((r) => r.data ?? []);
  const balanceByClientGroup = new Map(creditRows.map((r) => [`${r.athlete_id}:${r.group_id}`, r.balance as number]));
  const phoneCounts = await fetchBookingCounts(supabase, { coachId: userId });
  const [tierBatches, asideKeys] = await Promise.all([
    Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("group_memberships").select("profile_id, group_id, client_tier").in("profile_id", ids).eq("role", "athlete"))),
    fetchInactiveKeys(supabase, Array.from(new Set(coachClients.map((c) => c.groupId)))),
  ]);
  const tierByKey = new Map(tierBatches.flatMap((r) => r.data ?? []).map((m: any) => [`${m.group_id}:${m.profile_id}`, (m.client_tier as ClientTierLite) ?? null]));
  return coachClients.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    groupId: c.groupId,
    balance: balanceByClientGroup.get(`${c.id}:${c.groupId}`) ?? 0,
    booked: phoneCounts.get(`${c.id}:${c.groupId}`)?.booked ?? 0,
    tier: tierByKey.get(`${c.groupId}:${c.id}`) ?? null,
    setAside: asideKeys.has(inactiveKey(c.groupId, c.id)),
  }));
}

export interface OwnScheduleDays {
  // The coach's own workouts by day (their personal space's dated programs), shown on the same grid as "You".
  byDay: Map<string, { key: string; title: string; done: boolean }[]>;
  // Their own workouts still ahead in the next 5 days, for the upcoming list.
  upcoming: { id: string; name: string; when: string }[];
}

// The coach's schedule on a phone (Release 2: the coach's own Calendar): this month, every client session of the ORGANIZATION they are working in (one organization at a time, switched in
// Spotlight; Ron decided), the did-it-happen cards, the client picker to book someone, and the next five days. With `own`, their own workouts sit on the same days ("You").
// `monthBase` is where the month arrows go (their own Calendar); a day opens the organization's day page (sessions and open times).
export async function CoachPhoneSchedule({
  supabase,
  userId,
  anchorGroupId,
  orgGroupIds,
  timezone,
  month,
  monthBase,
  own,
}: {
  supabase: SupabaseClient;
  userId: string;
  anchorGroupId: string;
  orgGroupIds: string[];
  timezone: string;
  month?: string;
  monthBase: string;
  own?: OwnScheduleDays;
}) {
  const scheduleClients = await loadScheduleClients(supabase, userId, anchorGroupId);
  const upcomingRangeEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const { data: upcomingAll } = await readRowsByIds(
    orgGroupIds,
    (g) => (from, to) =>
      supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", userId)
        .in("group_id", g)
        .eq("status", "confirmed")
        .gte("start_at", new Date().toISOString())
        .lt("start_at", upcomingRangeEnd.toISOString())
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { pageSize: 10, maxPages: 1 }
  );
  const upcoming = upcomingAll
    .sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at)))
    .slice(0, 10)
    .map((b: any) => ({ id: b.id as string, startAt: b.start_at as string, name: (b.profiles?.full_name ?? "Client") as string }));

  const today = dateFromKey(dateKeyInZone(timezone));
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const year = m ? Number(m[1]) : today.getFullYear();
  const monthIndex = m ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : today.getMonth();
  const prev = new Date(year, monthIndex - 1, 1);
  const next = new Date(year, monthIndex + 1, 1);
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 1);
  // Sessions the client cancelled stay on the month, struck through (Ron, Nov 21); read on their own, never counted or in Upcoming (lib/canceled-sessions.ts).
  const canceledRead = readCanceledSessions(supabase, userId, orgGroupIds, new Date(monthStart.getTime() - 86400000).toISOString(), new Date(monthEnd.getTime() + 86400000).toISOString());
  const { data: monthRows } = await readRowsByIds(orgGroupIds, (g) => (from, to) =>
    supabase
      .from("bookings")
      .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
      .eq("coach_id", userId)
      .in("group_id", g)
      .eq("status", "confirmed")
      .gte("start_at", new Date(monthStart.getTime() - 86400000).toISOString())
      .lt("start_at", new Date(monthEnd.getTime() + 86400000).toISOString())
      .order("start_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const sessionsByDay = new Map<string, { time: string; name: string; at: string }[]>();
  for (const b of [...monthRows].sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at))) as any[]) {
    const k = dateKeyInZone(timezone, new Date(b.start_at));
    const list = sessionsByDay.get(k) ?? [];
    list.push({ time: formatInTimezone(new Date(b.start_at), timezone, "time"), name: String(b.profiles?.full_name ?? "Client").split(" ")[0], at: b.start_at as string });
    sessionsByDay.set(k, list);
  }
  const canceledByDay = new Map<string, { time: string; name: string; at: string; line: string }[]>();
  for (const c of await canceledRead) {
    const k = dateKeyInZone(timezone, new Date(c.startAt));
    canceledByDay.set(k, [...(canceledByDay.get(k) ?? []), { time: formatInTimezone(new Date(c.startAt), timezone, "time"), name: c.name.split(" ")[0], at: c.startAt, line: c.label }]);
  }
  // The coach's own calendar events (a consult they put on their calendar, a suggestion; Ron, Nov 19: "needs to show up on my calendar ... i almost missed it"): on the month's days
  // with a dot, in time order among the sessions (one with no time after them), and in the upcoming list. Only the coach's own rows.
  const todayKey = dateKeyInZone(timezone);
  const soonEndKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5));
  const eventCols = "id, title, event_date, event_time, event_type";
  const [{ data: monthEventRows }, { data: soonEventRows }] = await Promise.all([
    supabase.from("calendar_events").select(eventCols).eq("coach_id", userId).neq("status", "dismissed").gte("event_date", dayKey(monthStart)).lt("event_date", dayKey(monthEnd)),
    supabase.from("calendar_events").select(eventCols).eq("coach_id", userId).neq("status", "dismissed").gte("event_date", todayKey).lt("event_date", soonEndKey),
  ]);
  type EventRow = { id: string; title: string; event_date: string; event_time: string | null; event_type: string };
  const eventAt = (e: EventRow) => zonedTimeToUtc(e.event_date, e.event_time ? e.event_time.slice(0, 5) : "00:00", timezone).toISOString();
  const eventsByDay = new Map<string, EventRow[]>();
  for (const e of (monthEventRows ?? []) as EventRow[]) eventsByDay.set(e.event_date, [...(eventsByDay.get(e.event_date) ?? []), e]);
  const nowIso = new Date().toISOString();
  const soonEvents = ((soonEventRows ?? []) as EventRow[])
    .filter((e) => !e.event_time || eventAt(e) >= nowIso)
    .map((e) => ({
      id: `event-${e.id}`,
      name: `${e.event_type === "suggestion" ? "Suggested" : "Event"}: ${e.title}`,
      at: eventAt(e),
      when: e.event_time ? formatInTimezone(new Date(eventAt(e)), timezone, "dateTime") : `${dateFromKey(e.event_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, all day`,
    }));
  const leading = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, i) => new Date(year, monthIndex, i + 1))];
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // Their own workouts ahead first (by day), then client sessions and calendar events (by time).
  const upcomingRows = [
    ...(own?.upcoming ?? []),
    // each session and event opens its day (Nov 21)
    ...[
      ...upcoming.map((b) => ({ id: b.id, name: b.name, at: b.startAt, when: formatInTimezone(new Date(b.startAt), timezone, "dateTime"), href: `/groups/${anchorGroupId}/calendar/${dateKeyInZone(timezone, new Date(b.startAt))}` })),
      ...soonEvents.map((e) => ({ ...e, href: `/groups/${anchorGroupId}/calendar/${dateKeyInZone(timezone, new Date(e.at))}` })),
    ]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ id, name, when, href }) => ({ id, name, when, href })),
  ];

  return (
    <div data-coach-phone-schedule>
      <SessionCountLine coachId={userId} groupIds={orgGroupIds} timezone={timezone} view="month" year={year} monthIndex={monthIndex} weekStartKey={null} />
      <SessionCheckSection coachId={userId} groupIds={orgGroupIds} />
      <ScheduleClientPicker groupId={anchorGroupId} clients={scheduleClients} />
      <div className="flex items-center justify-between mt-3">
        <Link href={`${monthBase}?month=${monthKey(prev)}`} className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2">
          &larr; {prev.toLocaleDateString("en-US", { month: "short" })}
        </Link>
        <span className="font-display font-bold uppercase text-base">{monthLabel(year, monthIndex)}</span>
        <Link href={`${monthBase}?month=${monthKey(next)}`} className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2">
          {next.toLocaleDateString("en-US", { month: "short" })} &rarr;
        </Link>
      </div>
      <p className="font-body text-xs text-steel mt-1">{own ? "Your clients' sessions and your own workouts. Tap a day to see its sessions and open times." : "All clients. Tap a day to see its sessions and open times."}</p>
      <div className="grid grid-cols-7 gap-px bg-steel/15 mt-3 border border-steel/15">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5">
            {label}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="bg-graphite min-h-[56px]" />;
          const isToday = sameDay(date, today);
          const dayEvents = eventsByDay.get(dayKey(date)) ?? [];
          const timed = [
            ...(sessionsByDay.get(dayKey(date)) ?? []).map((s, idx) => ({ key: `s${idx}`, at: s.at, text: `${s.time} ${s.name}`, className: "text-chalk", dot: null as string | null })),
            ...(canceledByDay.get(dayKey(date)) ?? []).map((s, idx) => ({ key: `c${idx}`, at: s.at, text: `${s.time} ${s.name}`, className: "text-steel line-through", dot: null as string | null, title: `${s.name}: ${s.line}` })),
            ...dayEvents
              .filter((e) => e.event_time)
              .map((e) => ({ key: `e${e.id}`, at: eventAt(e), text: `${formatInTimezone(new Date(eventAt(e)), timezone, "time")} ${e.title}`, className: "text-chalk", dot: e.event_type === "suggestion" ? DOT_SUGGESTION : DOT_EVENT })),
          ].sort((a, b) => a.at.localeCompare(b.at));
          const lines = [
            ...(own?.byDay.get(dayKey(date)) ?? []).map((w) => ({ key: w.key, text: `You: ${w.title}`, className: w.done ? "text-positive" : "text-rust-ink", dot: null as string | null })),
            ...timed,
            ...dayEvents.filter((e) => !e.event_time).map((e) => ({ key: `e${e.id}`, text: e.title, className: "text-chalk", dot: e.event_type === "suggestion" ? DOT_SUGGESTION : DOT_EVENT })),
          ];
          // A day page loads when it is tapped. Prefetched, every day in view was drawn on the server at once (31 per month open, Oct 27), slowing the phone.
          return (
            <Link key={i} href={`/groups/${anchorGroupId}/calendar/${dayKey(date)}`} prefetch={false} className={`bg-graphite min-h-[56px] p-1.5 flex flex-col ${isToday ? "ring-1 ring-inset ring-rust" : ""}`}>
              <span className={`font-body text-xs ${isToday ? "text-rust-ink font-bold" : "text-steel"}`}>{date.getDate()}</span>
              {lines.slice(0, 2).map((l) => (
                <span
                  key={l.key}
                  className={`font-body text-[10px] leading-tight mt-0.5 truncate ${l.className}`}
                  {...(l.dot ? { "data-calendar-event": "" } : {})}
                  {...("title" in l && l.title ? { title: l.title as string, "aria-label": l.title as string, "data-canceled-session": "" } : {})}
                >
                  {l.dot && <span aria-hidden="true" className={`inline-block w-[5px] h-[5px] rounded-full mr-0.5 align-middle ${l.dot}`} />}
                  {l.text}
                  {"title" in l && l.title ? <span className="sr-only"> (canceled)</span> : null}
                </span>
              ))}
              {lines.length > 2 && <span className="font-body text-[10px] leading-tight text-rust-ink mt-0.5">+{lines.length - 2}</span>}
            </Link>
          );
        })}
      </div>

      <h2 className="font-body text-xs text-steel uppercase tracking-wide mt-8 mb-2">Upcoming</h2>
      {upcomingRows.length === 0 ? (
        <p className="font-body text-sm text-steel">Nothing booked in the next 5 days.</p>
      ) : (
        <UpcomingSessionsList rows={upcomingRows} />
      )}
    </div>
  );
}
