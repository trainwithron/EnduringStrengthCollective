import { createServerClient } from "@/lib/supabase/server";
import { GroupHubHeader } from "@/components/group/group-hub-header";
import { RosterList } from "@/components/group/roster-list";
import { WeightLogWidget } from "@/components/athlete/weight-log-widget";
import { TodayWidget } from "@/components/athlete/today-widget";
import { WellnessCheckinWidget, type WellnessCheckinValues } from "@/components/athlete/wellness-checkin-widget";
import { ProgramCardList } from "@/components/athlete/program-card-list";
import { computeProgramCardVisuals } from "@/lib/program-card-data";
import { WeekAtAGlance, type WeekDayEntry } from "@/components/athlete/week-at-a-glance";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { ViewAsClientEntryPoint } from "@/components/athlete/view-as-client-entry-point";
import { isHabitDueOn } from "@/lib/habits";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { getViewerOrgTheme } from "@/lib/org-theme-server";
import { computeScheduledDates, isLocked } from "@/lib/program-schedule";
import { getWeekRange, isWithinRange } from "@/lib/week-range";
import { resolveDayMacroTarget } from "@/lib/todays-macros";
import type { RosterMember } from "@/lib/types";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function GroupHubPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
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

  let weightLogs: { id: string; loggedDate: string; weight: number }[] = [];
  let todayMacros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null = null;
  let todayHabits: { id: string; title: string; completed: boolean }[] = [];
  let weekDays: WeekDayEntry[] = [];
  let wellnessCheckin: WellnessCheckinValues | null = null;
  const todayKey = new Date().toISOString().slice(0, 10);

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

  if (showMobileView && athleteId) {
    // weightLogs, macros, and this athlete's habit definitions are all
    // independent of each other — only the habit *completion* lookup
    // right after needs to wait (it needs the due habits' ids first).
    const [{ data: weightRows }, macroResult, mealPlanResult, { data: habitRows }, { data: wellnessRow }] = await Promise.all([
      supabase
        .from("body_weight_logs")
        .select("id, logged_date, weight")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .order("logged_date", { ascending: false })
        .limit(7),
      // Group-tier clients don't get macro programming — skip the fetch
      // entirely rather than fetch-and-hide, same as the coach-side pages.
      macrosEnabled
        ? supabase
            .from("daily_macros")
            .select("calories, protein_g, carbs_g, fat_g")
            .eq("athlete_id", athleteId)
            .eq("log_date", todayKey)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      macrosEnabled
        ? supabase
            .from("meal_plans")
            .select("meals, macros")
            .eq("athlete_id", athleteId)
            .eq("log_date", todayKey)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("client_habits")
        .select("id, title, weekdays")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .eq("active", true),
      supabase
        .from("wellness_checkins")
        .select("sleep_quality, soreness, energy")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .eq("log_date", todayKey)
        .maybeSingle(),
    ]);

    wellnessCheckin = wellnessRow
      ? { sleepQuality: wellnessRow.sleep_quality, soreness: wellnessRow.soreness, energy: wellnessRow.energy }
      : null;

    weightLogs = (weightRows ?? []).map((w) => ({
      id: w.id,
      loggedDate: w.logged_date,
      weight: w.weight,
    }));

    // A day's meal plan carries its own macros, computed for the exact
    // meals it saved — that target wins over daily_macros when both
    // exist, so this widget's number never contradicts the actual plan.
    // See lib/todays-macros.ts.
    todayMacros = resolveDayMacroTarget(
      macroResult.data ?? null,
      (mealPlanResult.data?.macros as any) ?? null,
      (mealPlanResult.data?.meals as any) ?? null
    );

    const dueHabitDefs = (habitRows ?? []).filter((h) => isHabitDueOn(h.weekdays, new Date()));

    const { data: habitLogRows } = await supabase
      .from("habit_logs")
      .select("habit_id, completed_at")
      .in("habit_id", dueHabitDefs.map((h) => h.id))
      .eq("log_date", todayKey);
    const completedIds = new Set(
      (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id)
    );
    todayHabits = dueHabitDefs.map((h) => ({
      id: h.id,
      title: h.title,
      completed: completedIds.has(h.id),
    }));

    weekDays = await computeThisWeek(supabase, { groupId: params.groupId, athleteId });
  }

  const orgTheme = await getViewerOrgTheme();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      {isCoach && showMobileView && !isActingAsOther && (
        <div className="px-5 pt-4">
          <ViewAsClientEntryPoint />
        </div>
      )}
      <GroupHubHeader
        name={group.name}
        description={group.description}
        memberCount={roster.length}
        isCoach={isCoach}
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
        <section className="px-5 pt-6 space-y-4">
          {weekDays.length > 0 && <WeekAtAGlance groupId={params.groupId} days={weekDays} />}
          <WellnessCheckinWidget
            athleteId={athleteId}
            groupId={params.groupId}
            todayDate={todayKey}
            initialCheckin={wellnessCheckin}
          />
          <TodayWidget todayDate={todayKey} macros={todayMacros} habits={todayHabits} />
          <WeightLogWidget
            athleteId={athleteId}
            groupId={params.groupId}
            initialLogs={weightLogs}
          />
        </section>
      )}

      <RosterList
        members={roster}
        groupId={params.groupId}
        viewerId={user?.id}
        viewerIsCoach={isCoach}
      />

      {showMobileView && <BottomTabBar groupId={params.groupId} />}
    </main>
  );
}

// Resolves this calendar week's training days for the athlete's active
// program (same personal-over-shared precedence as getTodaysWorkoutId)
// into the shape WeekAtAGlance needs. A day still renders when locked —
// showing the week's shape (a workout exists Wednesday) without its
// content is the deliberate choice here, not an oversight: it's the same
// lock-icon-only pattern already used for the athlete's program list, and
// it's what keeps "you can see the plan exists" from turning into "you
// can see and copy the plan's actual content" before it's unlocked.
async function computeThisWeek(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  { groupId, athleteId }: { groupId: string; athleteId: string }
): Promise<WeekDayEntry[]> {
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("id, start_date, training_days, visibility_window")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("id, start_date, training_days, visibility_window")
        .eq("group_id", groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();

  const program = personalProgram ?? sharedProgram;
  if (!program || !program.start_date || !program.training_days?.length) return [];

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title")
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  if (!workouts || workouts.length === 0) return [];

  const scheduledDateByDayId = computeScheduledDates(
    program.start_date,
    program.training_days,
    workouts
  );

  const today = new Date();
  const { start, end } = getWeekRange(today);
  const thisWeek = workouts
    .map((w) => ({ ...w, date: scheduledDateByDayId.get(w.id) }))
    .filter(
      (w): w is typeof w & { date: Date } =>
        !!w.date && isWithinRange(w.date, start, end)
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (thisWeek.length === 0) return [];

  const { data: logs } = await supabase
    .from("workout_logs")
    .select("workout_id")
    .eq("athlete_id", athleteId)
    .in(
      "workout_id",
      thisWeek.map((w) => w.id)
    );
  const loggedIds = new Set((logs ?? []).map((l) => l.workout_id));

  return thisWeek.map((w) => {
    const dateKey = `${w.date.getFullYear()}-${String(w.date.getMonth() + 1).padStart(2, "0")}-${String(
      w.date.getDate()
    ).padStart(2, "0")}`;
    const status: WeekDayEntry["status"] = loggedIds.has(w.id)
      ? "done"
      : isLocked(w.date, today, program.visibility_window)
        ? "locked"
        : "open";
    return {
      workoutId: w.id,
      title: w.title,
      date: dateKey,
      weekday: WEEKDAY_SHORT[w.date.getDay()],
      status,
      isToday: dateKey === new Date().toISOString().slice(0, 10),
    };
  });
}
