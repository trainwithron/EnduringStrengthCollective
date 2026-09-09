import { createServerClient } from "@/lib/supabase/server";
import { GroupHubHeader } from "@/components/group/group-hub-header";
import { RosterList } from "@/components/group/roster-list";
import { WeightLogWidget } from "@/components/athlete/weight-log-widget";
import { TodayWidget } from "@/components/athlete/today-widget";
import { ProgramCardList } from "@/components/athlete/program-card-list";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { isHabitDueOn } from "@/lib/habits";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import type { RosterMember } from "@/lib/types";

export default async function GroupHubPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      .or(`athlete_id.is.null,athlete_id.eq.${user?.id ?? ""}`)
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
  // from Settings).
  const showMobileView = !isCoach || prefersAthleteStyleView();

  let weightLogs: { id: string; loggedDate: string; weight: number }[] = [];
  let todayMacros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null = null;
  let todayHabits: { id: string; title: string; completed: boolean }[] = [];
  const todayKey = new Date().toISOString().slice(0, 10);

  const viewerTier = roster.find((m) => m.profileId === user?.id)?.clientTier ?? null;
  const macrosEnabled = viewerTier !== "group";

  if (showMobileView && user) {
    // weightLogs, macros, and this athlete's habit definitions are all
    // independent of each other — only the habit *completion* lookup
    // right after needs to wait (it needs the due habits' ids first).
    const [{ data: weightRows }, macroResult, { data: habitRows }] = await Promise.all([
      supabase
        .from("body_weight_logs")
        .select("id, logged_date, weight")
        .eq("athlete_id", user.id)
        .eq("group_id", params.groupId)
        .order("logged_date", { ascending: false })
        .limit(7),
      // Group-tier clients don't get macro programming — skip the fetch
      // entirely rather than fetch-and-hide, same as the coach-side pages.
      macrosEnabled
        ? supabase
            .from("daily_macros")
            .select("calories, protein_g, carbs_g, fat_g")
            .eq("athlete_id", user.id)
            .eq("log_date", todayKey)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("client_habits")
        .select("id, title, weekdays")
        .eq("athlete_id", user.id)
        .eq("group_id", params.groupId)
        .eq("active", true),
    ]);

    weightLogs = (weightRows ?? []).map((w) => ({
      id: w.id,
      loggedDate: w.logged_date,
      weight: w.weight,
    }));

    if (macroResult.data) {
      todayMacros = {
        calories: macroResult.data.calories,
        proteinG: macroResult.data.protein_g,
        carbsG: macroResult.data.carbs_g,
        fatG: macroResult.data.fat_g,
      };
    }

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
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <GroupHubHeader
        name={group.name}
        description={group.description}
        memberCount={roster.length}
        isCoach={isCoach}
        groupId={params.groupId}
        coachId={user?.id}
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
          />
        ) : (
          <p className="font-body text-sm text-steel py-2">No programs assigned.</p>
        )}
      </section>

      {showMobileView && user && (
        <section className="px-5 pt-6 space-y-4">
          <TodayWidget todayDate={todayKey} macros={todayMacros} habits={todayHabits} />
          <WeightLogWidget
            athleteId={user.id}
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
