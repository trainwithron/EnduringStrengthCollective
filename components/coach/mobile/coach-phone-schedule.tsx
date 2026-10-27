import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRowsByIds } from "@/lib/read-by-ids";
import { chunk } from "@/lib/chunk";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import type { ClientTierLite } from "@/lib/session-type-default";
import { getCoachClients } from "@/lib/coach-clients";
import { fetchBookingCounts } from "@/lib/credit-picture";
import { dateFromKey } from "@/lib/date-key";
import { dateKeyInZone } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { SessionCountLine } from "@/components/coach/session-count-line";
import { SessionCheckSection } from "@/components/coach/session-check-section";
import { ScheduleClientPicker } from "@/components/coach/schedule-client-picker";
import { UpcomingSessionsList } from "@/components/coach/upcoming-sessions-list";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
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
  const sessionsByDay = new Map<string, { time: string; name: string }[]>();
  for (const b of [...monthRows].sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at))) as any[]) {
    const k = dateKeyInZone(timezone, new Date(b.start_at));
    const list = sessionsByDay.get(k) ?? [];
    list.push({ time: formatInTimezone(new Date(b.start_at), timezone, "time"), name: String(b.profiles?.full_name ?? "Client").split(" ")[0] });
    sessionsByDay.set(k, list);
  }
  const leading = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, i) => new Date(year, monthIndex, i + 1))];
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // Their own workouts ahead first (by day), then client sessions (by time).
  const upcomingRows = [...(own?.upcoming ?? []), ...upcoming.map((b) => ({ id: b.id, name: b.name, when: formatInTimezone(new Date(b.startAt), timezone, "dateTime") }))];

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
          const lines = [
            ...(own?.byDay.get(dayKey(date)) ?? []).map((w) => ({ key: w.key, text: `You: ${w.title}`, className: w.done ? "text-positive" : "text-rust" })),
            ...(sessionsByDay.get(dayKey(date)) ?? []).map((s, idx) => ({ key: `s${idx}`, text: `${s.time} ${s.name}`, className: "text-chalk" })),
          ];
          // A day page loads when it is tapped. Prefetched, every day in view was drawn on the server at once (31 per month open, Oct 27), slowing the phone.
          return (
            <Link key={i} href={`/groups/${anchorGroupId}/calendar/${dayKey(date)}`} prefetch={false} className={`bg-graphite min-h-[56px] p-1.5 flex flex-col ${isToday ? "ring-1 ring-inset ring-rust" : ""}`}>
              <span className={`font-body text-xs ${isToday ? "text-rust font-bold" : "text-steel"}`}>{date.getDate()}</span>
              {lines.slice(0, 2).map((l) => (
                <span key={l.key} className={`font-body text-[10px] leading-tight mt-0.5 truncate ${l.className}`}>
                  {l.text}
                </span>
              ))}
              {lines.length > 2 && <span className="font-body text-[10px] leading-tight text-rust mt-0.5">+{lines.length - 2}</span>}
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
