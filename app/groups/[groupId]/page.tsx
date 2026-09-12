import { createServerClient } from "@/lib/supabase/server";
import { GroupHubHeader } from "@/components/group/group-hub-header";
import { RosterList } from "@/components/group/roster-list";
import { WellnessCheckinPopup } from "@/components/athlete/wellness-checkin-popup";
import type { WellnessCheckinValues } from "@/components/athlete/wellness-checkin-widget";
import { DayCard } from "@/components/athlete/day-card";
import { HomeWeekView, type HomeDaySummary } from "@/components/athlete/home-week-view";
import { HomeMonthView } from "@/components/athlete/home-month-view";
import {
  DayWeekMonthSwitcher,
  ViewModeRedirector,
} from "@/components/athlete/day-week-month-switcher";
import { ProgramCardList } from "@/components/athlete/program-card-list";
import { computeProgramCardVisuals } from "@/lib/program-card-data";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { ViewAsClientEntryPoint } from "@/components/athlete/view-as-client-entry-point";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { isHabitDueOn } from "@/lib/habits";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { getViewerOrgTheme } from "@/lib/org-theme-server";
import { dateKeyInZone, getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { resolveDayMacroTarget } from "@/lib/todays-macros";
import {
  getActiveProgramForAthlete,
  getScheduledWorkouts,
  resolveDayWorkout,
  dateKeyOf,
  parseDateKey,
  type ScheduledWorkoutEntry,
} from "@/lib/athlete-day-schedule";
import type { RosterMember } from "@/lib/types";
import type { TodayMacros, TodayHabit } from "@/components/athlete/today-widget";
import type { WeightLogEntry } from "@/components/athlete/weight-log-widget";

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function weekLabel(weekStart: Date, weekEnd: Date): string {
  const startStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

function isValidDateKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function GroupHubPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ view?: string; date?: string; month?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A coach standing in a client's mobile experience ("View as Client")
  // resolves to that client's id here — every query below that would
  // otherwise use the signed-in user's own id uses this instead. For
  // anyone else (an athlete, or a coach not currently acting as someone)
  // this is just their own id.
  const effective = user ? await getEffectiveAthlete(params.groupId, user.id) : null;
  const athleteId = effective?.athleteId;
  const isActingAsOther = effective?.isActingAsOther ?? false;

  // These five only need params.groupId or the viewer's own id — none
  // depends on another's result — so they fire as one round trip instead
  // of five sequential ones. This is the athlete's landing page; every
  // visit pays for this.
  const [
    { data: group, error: groupError },
    { data: memberships },
    { data: recentLogs },
    { data: programs },
    { data: notificationRows },
  ] = await Promise.all([
    supabase.from("groups").select("id, name, description").eq("id", params.groupId).single(),
    // Roster with role + most recent completed workout timestamp.
    supabase
      .from("group_memberships")
      .select(
        `
      role,
      profiles ( id, full_name, avatar_url ),
      profile_id,
      client_tier
    `
      )
      .eq("group_id", params.groupId),
    supabase
      .from("workout_logs")
      .select("athlete_id, created_at")
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false }),
    // Only programs actually assigned to this athlete right now — the
    // group's shared active program plus this viewer's own personal one
    // if active, never a different client's personal program (RLS
    // already blocks that at the database level; this filter keeps the
    // query's own intent explicit) and never an inactive/retired program
    // that isn't actually something to train from today.
    supabase
      .from("programs")
      .select("id, name, cover_image_path, workouts(count)")
      .eq("group_id", params.groupId)
      .eq("is_active", true)
      .or(`athlete_id.is.null,athlete_id.eq.${athleteId ?? ""}`)
      .order("created_at", { ascending: false }),
    user
      ? supabase
          .from("notifications")
          .select("id, type, body, link_path, read_at, created_at")
          .eq("profile_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  if (groupError || !group) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const lastLogByAthlete = new Map<string, string>();
  for (const log of recentLogs ?? []) {
    if (!lastLogByAthlete.has(log.athlete_id)) {
      lastLogByAthlete.set(log.athlete_id, log.created_at);
    }
  }

  const roster: RosterMember[] = (memberships ?? []).map((m: any) => ({
    profileId: m.profile_id,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
    avatarUrl: (m.profiles as any)?.avatar_url ?? null,
    role: m.role,
    lastWorkoutAt: lastLogByAthlete.get(m.profile_id) ?? null,
    clientTier: m.client_tier ?? null,
  }));

  // Coaches first, then athletes, alphabetical within each group.
  roster.sort((a, b) => {
    if (a.role !== b.role) return a.role === "coach" ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const isCoach = roster.some((m) => m.profileId === user?.id && m.role === "coach");
  // A coach on a phone — installed app or just a browser tab — sees the
  // same lightweight experience an athlete gets: logging their own
  // training doesn't need the dense desktop coaching tools. The same
  // coach at an actual desktop still gets the full shell (linked back to
  // from Settings). Acting as a client always wins — that's the whole
  // point of picking someone from "View as Client."
  const showMobileView = isActingAsOther || !isCoach || await prefersAthleteStyleView();
  // Coach-only UI controls (Invite Athlete, roster role/remove actions)
  // must reflect who the page is showing right now, not the real
  // signed-in identity — a coach impersonating a client via "View as
  // Client" should see exactly what that client would see, same
  // discipline already applied to Feed/Calendar/Resources/Tools.
  const renderAsCoach = isActingAsOther ? false : isCoach;

  // "Today" here means this group's coach's real wall-clock day, not the
  // server's own UTC clock — see lib/timezone.ts. Otherwise a workout's
  // lock state and every date-scoped lookup below could read a day early
  // or late for anyone not in the UTC zone.
  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const today = nowInZone(timezone);
  const todayKey = dateKeyInZone(timezone);

  const view = searchParams.view === "week" || searchParams.view === "month" ? searchParams.view : "day";
  const targetDateKey = isValidDateKey(searchParams.date) ? searchParams.date : todayKey;
  const targetDate = parseDateKey(targetDateKey);
  const isToday = targetDateKey === todayKey;

  const actingAsFullName = isActingAsOther
    ? roster.find((m) => m.profileId === athleteId)?.fullName ?? "Client"
    : null;

  const viewerTier = roster.find((m) => m.profileId === athleteId)?.clientTier ?? null;
  const macrosEnabled = viewerTier !== "group";

  // Only worth computing for this athlete's own visible programs that
  // have no manual cover photo — same "skip what won't render" guard as
  // the coach's own Programs grid.
  const coachId = roster.find((m) => m.role === "coach")?.profileId;
  const uncoveredProgramIds = (programs ?? [])
    .filter((p: any) => !p.cover_image_path)
    .map((p: any) => p.id);
  const visualsMap = coachId
    ? await computeProgramCardVisuals(supabase, uncoveredProgramIds, coachId)
    : new Map();
  const visualsByProgramId = Object.fromEntries(visualsMap);

  let dayWorkout: ReturnType<typeof resolveDayWorkout> = {
    status: "no-program",
    workoutId: null,
    title: null,
  };
  let dayMacros: TodayMacros | null = null;
  let dayHabits: TodayHabit[] = [];
  let weightLogs: WeightLogEntry[] = [];
  let wellnessCheckin: WellnessCheckinValues | null = null;
  let canBook = false;
  let weekDays: HomeDaySummary[] = [];
  let monthSummaryByDateKey = new Map<string, HomeDaySummary>();
  let weekRangeStart = targetDate;
  let weekRangeEnd = targetDate;
  const monthYear = targetDate.getFullYear();
  const monthIndex = targetDate.getMonth();

  if (showMobileView && athleteId) {
    const program = await getActiveProgramForAthlete(supabase, params.groupId, athleteId);
    const scheduledWorkouts: ScheduledWorkoutEntry[] = program
      ? await getScheduledWorkouts(supabase, program)
      : [];
    const workoutIds = scheduledWorkouts.map((w) => w.workoutId);

    const [{ data: logRows }, { data: habitRows }] = await Promise.all([
      workoutIds.length > 0
        ? supabase.from("workout_logs").select("workout_id").eq("athlete_id", athleteId).in("workout_id", workoutIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("client_habits")
        .select("id, title, weekdays")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .eq("active", true),
    ]);
    const loggedIds = new Set((logRows ?? []).map((l) => l.workout_id));
    const visibilityWindow = program?.visibilityWindow ?? "day";

    // Coach's booking availability — reused by Day view's rest-day link,
    // same "additive, only if the coach has configured hours" gate as
    // the existing per-program calendar page.
    const { data: coachMembership } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", params.groupId)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();
    if (coachMembership) {
      const { count } = await supabase
        .from("coach_availability_windows")
        .select("id", { count: "exact", head: true })
        .eq("coach_id", coachMembership.profile_id);
      canBook = (count ?? 0) > 0;
    }

    if (view === "day") {
      dayWorkout = resolveDayWorkout(scheduledWorkouts, loggedIds, targetDate, today, visibilityWindow);

      const [macroResult, mealPlanResult, { data: dueLogRows }] = await Promise.all([
        macrosEnabled
          ? supabase
              .from("daily_macros")
              .select("calories, protein_g, carbs_g, fat_g")
              .eq("athlete_id", athleteId)
              .eq("log_date", targetDateKey)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        macrosEnabled
          ? supabase
              .from("meal_plans")
              .select("meals, macros")
              .eq("athlete_id", athleteId)
              .eq("log_date", targetDateKey)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("habit_logs")
          .select("habit_id, completed_at")
          .in("habit_id", (habitRows ?? []).map((h) => h.id))
          .eq("log_date", targetDateKey),
      ]);

      dayMacros = resolveDayMacroTarget(
        macroResult.data ?? null,
        (mealPlanResult.data?.macros as any) ?? null,
        (mealPlanResult.data?.meals as any) ?? null
      );

      const dueHabitDefs = (habitRows ?? []).filter((h) => isHabitDueOn(h.weekdays, targetDate));
      const completedIds = new Set(
        (dueLogRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id)
      );
      dayHabits = dueHabitDefs.map((h) => ({
        id: h.id,
        title: h.title,
        completed: completedIds.has(h.id),
      }));

      if (isToday) {
        const [{ data: weightRows }, { data: wellnessRow }] = await Promise.all([
          supabase
            .from("body_weight_logs")
            .select("id, logged_date, weight")
            .eq("athlete_id", athleteId)
            .eq("group_id", params.groupId)
            .order("logged_date", { ascending: false })
            .limit(7),
          supabase
            .from("wellness_checkins")
            .select("sleep_quality, soreness, energy")
            .eq("athlete_id", athleteId)
            .eq("group_id", params.groupId)
            .eq("log_date", todayKey)
            .maybeSingle(),
        ]);
        weightLogs = (weightRows ?? []).map((w) => ({ id: w.id, loggedDate: w.logged_date, weight: w.weight }));
        wellnessCheckin = wellnessRow
          ? { sleepQuality: wellnessRow.sleep_quality, soreness: wellnessRow.soreness, energy: wellnessRow.energy }
          : null;
      }
    } else if (view === "week") {
      const weekStart = new Date(targetDate);
      weekStart.setDate(targetDate.getDate() - targetDate.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const rangeDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d;
      });
      weekRangeStart = weekStart;
      weekRangeEnd = rangeDates[6];

      weekDays = await computeRangeSummaries(supabase, {
        athleteId,
        macrosEnabled,
        dates: rangeDates,
        scheduledWorkouts,
        loggedIds,
        today,
        visibilityWindow,
        habitDefs: habitRows ?? [],
      });
    } else {
      const rangeDates = Array.from(
        { length: new Date(monthYear, monthIndex + 1, 0).getDate() },
        (_, i) => new Date(monthYear, monthIndex, i + 1)
      );
      const summaries = await computeRangeSummaries(supabase, {
        athleteId,
        macrosEnabled,
        dates: rangeDates,
        scheduledWorkouts,
        loggedIds,
        today,
        visibilityWindow,
        habitDefs: habitRows ?? [],
      });
      monthSummaryByDateKey = new Map(summaries.map((s) => [s.dateKey, s]));
    }
  }

  const orgTheme = await getViewerOrgTheme();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      {isCoach && showMobileView && !isActingAsOther && (
        <div className="px-5 pt-4 flex items-center justify-between gap-3">
          <ViewAsClientEntryPoint />
          <ViewModeToggle targetMode="desktop" label="Desktop Mode" variant="button" />
        </div>
      )}
      <GroupHubHeader
        name={group.name}
        description={group.description}
        memberCount={roster.length}
        isCoach={renderAsCoach}
        groupId={params.groupId}
        coachId={user?.id}
        viewerId={user?.id}
        logoUrl={orgTheme.logoUrl}
        notifications={(notificationRows ?? []).map((n: any) => ({
          id: n.id,
          type: n.type,
          body: n.body,
          linkPath: n.link_path,
          createdAt: n.created_at,
          readAt: n.read_at,
        }))}
      />

      <section className="px-5 pt-6">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Programs
        </h2>
        {programs && programs.length > 0 ? (
          <ProgramCardList
            groupId={params.groupId}
            programs={programs.map((p: any) => ({
              id: p.id,
              name: p.name,
              workoutCount: p.workouts?.[0]?.count ?? 0,
              coverImagePath: p.cover_image_path ?? null,
            }))}
            visualsByProgramId={visualsByProgramId}
          />
        ) : (
          <p className="font-body text-sm text-steel py-2">No programs assigned.</p>
        )}
      </section>

      {showMobileView && athleteId && (
        <section className="px-5 pt-6">
          <ViewModeRedirector hasViewParam={!!searchParams.view} />
          <DayWeekMonthSwitcher groupId={params.groupId} />

          {view === "day" && (
            <div className="space-y-4">
              {isToday && (
                <WellnessCheckinPopup
                  athleteId={athleteId}
                  groupId={params.groupId}
                  todayDate={todayKey}
                  initialCheckin={wellnessCheckin}
                />
              )}
              <DayCard
                groupId={params.groupId}
                athleteId={athleteId}
                dateKey={targetDateKey}
                dateLabel={
                  isToday
                    ? "Today"
                    : targetDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
                }
                isToday={isToday}
                workout={dayWorkout}
                macros={dayMacros}
                habits={dayHabits}
                weightLogs={weightLogs}
                canBook={canBook}
                wellnessCheckin={wellnessCheckin}
              />
            </div>
          )}

          {view === "week" && (
            <HomeWeekView
              groupId={params.groupId}
              days={weekDays}
              todayKey={todayKey}
              weekLabel={weekLabel(weekRangeStart, weekRangeEnd)}
              prevHref={`/groups/${params.groupId}?view=week&date=${dateKeyOf(addDays(weekRangeStart, -7))}`}
              nextHref={`/groups/${params.groupId}?view=week&date=${dateKeyOf(addDays(weekRangeStart, 7))}`}
            />
          )}

          {view === "month" && (
            <HomeMonthView
              groupId={params.groupId}
              year={monthYear}
              monthIndex={monthIndex}
              monthLabel={monthLabel(monthYear, monthIndex)}
              summaryByDateKey={monthSummaryByDateKey}
              todayKey={todayKey}
              prevHref={`/groups/${params.groupId}?view=month&date=${dateKeyOf(new Date(monthYear, monthIndex - 1, 1))}`}
              nextHref={`/groups/${params.groupId}?view=month&date=${dateKeyOf(new Date(monthYear, monthIndex + 1, 1))}`}
            />
          )}
        </section>
      )}

      <RosterList
        members={roster}
        groupId={params.groupId}
        viewerId={user?.id}
        viewerIsCoach={renderAsCoach}
      />

      {showMobileView && <BottomTabBar groupId={params.groupId} />}
    </main>
  );
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Shared Week/Month data pass — one batched fetch per range instead of
// one query per day, then resolveDayWorkout (pure) does the per-day
// status math already proven by lib/athlete-day-schedule.test.ts.
async function computeRangeSummaries(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  {
    athleteId,
    macrosEnabled,
    dates,
    scheduledWorkouts,
    loggedIds,
    today,
    visibilityWindow,
    habitDefs,
  }: {
    athleteId: string;
    macrosEnabled: boolean;
    dates: Date[];
    scheduledWorkouts: ScheduledWorkoutEntry[];
    loggedIds: Set<string>;
    today: Date;
    visibilityWindow: "day" | "week" | "month" | "full";
    habitDefs: { id: string; title: string; weekdays: number[] }[];
  }
): Promise<HomeDaySummary[]> {
  const dateKeys = dates.map(dateKeyOf);
  const startKey = dateKeys[0];
  const endKey = dateKeys[dateKeys.length - 1];

  const [macroResult, habitLogResult] = await Promise.all([
    macrosEnabled
      ? supabase
          .from("daily_macros")
          .select("log_date, calories")
          .eq("athlete_id", athleteId)
          .gte("log_date", startKey)
          .lte("log_date", endKey)
      : Promise.resolve({ data: [] }),
    habitDefs.length > 0
      ? supabase
          .from("habit_logs")
          .select("habit_id, log_date, completed_at")
          .in("habit_id", habitDefs.map((h) => h.id))
          .gte("log_date", startKey)
          .lte("log_date", endKey)
      : Promise.resolve({ data: [] }),
  ]);

  const caloriesByDate = new Map<string, number | null>();
  for (const row of macroResult.data ?? []) {
    caloriesByDate.set((row as any).log_date, (row as any).calories);
  }
  const completedByHabitAndDate = new Set(
    (habitLogResult.data ?? [])
      .filter((l: any) => l.completed_at)
      .map((l: any) => `${l.habit_id}|${l.log_date}`)
  );

  return dates.map((date) => {
    const dateKey = dateKeyOf(date);
    const workout = resolveDayWorkout(scheduledWorkouts, loggedIds, date, today, visibilityWindow);
    const dueHabits = habitDefs.filter((h) => isHabitDueOn(h.weekdays, date));
    const habitsCompleted = dueHabits.filter((h) => completedByHabitAndDate.has(`${h.id}|${dateKey}`)).length;
    return {
      dateKey,
      date,
      workout,
      macroCalories: caloriesByDate.get(dateKey) ?? null,
      habitsDue: dueHabits.length,
      habitsCompleted,
    };
  });
}
