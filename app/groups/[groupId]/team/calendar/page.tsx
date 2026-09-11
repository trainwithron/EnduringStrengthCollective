import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { TeamPracticeScheduleForm, type PracticeScheduleRow } from "@/components/coach/desktop/team-practice-schedule-form";
import { TeamGameForm } from "@/components/coach/desktop/team-game-form";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TeamCalendarPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ month?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: group }, { data: membership }] = await Promise.all([
    supabase.from("groups").select("name, team_mode").eq("id", params.groupId).single(),
    supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle(),
  ]);

  if (!membership) redirect("/");
  const isCoach = membership.role === "coach";

  if (!group?.team_mode) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Team mode isn&apos;t enabled for this group yet.
        </p>
      </main>
    );
  }

  const [{ data: scheduleRows }, { data: gameRows }] = await Promise.all([
    supabase
      .from("team_practice_schedules")
      .select("id, title, weekday, start_time, end_time")
      .eq("group_id", params.groupId)
      .order("weekday", { ascending: true }),
    supabase
      .from("team_games")
      .select("id, event_date, start_time, opponent, is_home, our_score, opponent_score")
      .eq("group_id", params.groupId)
      .order("event_date", { ascending: true }),
  ]);

  const schedules: PracticeScheduleRow[] = (scheduleRows ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    weekday: s.weekday,
    startTime: s.start_time,
    endTime: s.end_time,
  }));
  const games = gameRows ?? [];

  const today = new Date();
  const monthParam = searchParams.month;
  let year = today.getFullYear();
  let monthIndex = today.getMonth();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    monthIndex = m - 1;
  }
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ];

  const basePath = `/groups/${params.groupId}/team/calendar`;
  const prevMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const prevHref = `${basePath}?month=${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const nextHref = `${basePath}?month=${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayKey = dateKey(today);

  const gamesByDate = new Map<string, typeof games>();
  for (const g of games) {
    gamesByDate.set(g.event_date, [...(gamesByDate.get(g.event_date) ?? []), g]);
  }

  const upcomingGames = games.filter((g) => g.event_date >= todayKey).slice(0, 5);

  const content = (
    <div className="max-w-3xl">
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Team Calendar</h1>
          <p className="font-body text-sm text-steel mt-2">
            Practices and games for the whole roster.
          </p>
        </div>
        {isCoach && <TeamGameForm groupId={params.groupId} createdBy={user.id} />}
      </div>

      {isCoach && (
        <div className="mb-8">
          <TeamPracticeScheduleForm groupId={params.groupId} createdBy={user.id} initialSchedules={schedules} />
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <Link href={prevHref} className="font-body text-xs text-steel">
          &larr; Prev
        </Link>
        <p className="font-display uppercase text-sm tracking-wide">{monthLabel}</p>
        <Link href={nextHref} className="font-body text-xs text-steel">
          Next &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15 mb-8">
        {WEEKDAYS.map((label) => (
          <div key={label} className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5">
            {label}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="bg-graphite" style={{ minHeight: 72 }} />;
          const key = dateKey(date);
          const isToday = key === todayKey;
          const dayPractices = schedules.filter((s) => s.weekday === date.getDay());
          const dayGames = gamesByDate.get(key) ?? [];
          return (
            <div
              key={i}
              className={`bg-graphite p-1.5 flex flex-col gap-0.5 ${isToday ? "ring-1 ring-inset ring-rust" : ""}`}
              style={{ minHeight: 72 }}
            >
              <span className={`font-body text-[10px] ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                {date.getDate()}
              </span>
              {dayPractices.map((p) => (
                <span key={p.id} className="font-body text-[9px] text-steel leading-tight truncate">
                  {p.title} {p.startTime.slice(0, 5)}
                </span>
              ))}
              {dayGames.map((g) => (
                <Link
                  key={g.id}
                  href={`${basePath}/games/${g.id}`}
                  className="font-body text-[9px] text-rust leading-tight truncate"
                >
                  vs {g.opponent} {g.our_score != null ? `(${g.our_score}-${g.opponent_score})` : ""}
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Upcoming games</h2>
        {upcomingGames.length === 0 ? (
          <p className="font-body text-sm text-steel">No upcoming games scheduled.</p>
        ) : (
          <div className="divide-y divide-steel/15">
            {upcomingGames.map((g) => (
              <Link
                key={g.id}
                href={`${basePath}/games/${g.id}`}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <span className="font-body text-sm">
                  {g.is_home ? "vs" : "@"} {g.opponent}
                </span>
                <span className="font-body text-xs text-steel">
                  {new Date(`${g.event_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (isCoach) {
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group.name} active="team-calendar">
        {content}
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-8 pb-24">
      {content}
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
