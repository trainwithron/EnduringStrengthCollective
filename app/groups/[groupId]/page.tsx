import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { GroupHubHeader } from "@/components/group/group-hub-header";
import { RosterList } from "@/components/group/roster-list";
import { WeightLogWidget } from "@/components/athlete/weight-log-widget";
import { TodayWidget } from "@/components/athlete/today-widget";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { isHabitDueOn } from "@/lib/habits";
import { isPwaStandalone } from "@/lib/pwa-server";
import type { RosterMember } from "@/lib/types";

export default async function GroupHubPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, name, description")
    .eq("id", params.groupId)
    .single();

  if (groupError || !group) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  // Roster with role + most recent completed workout timestamp.
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select(
      `
      role,
      profiles ( id, full_name, avatar_url ),
      profile_id,
      client_tier
    `
    )
    .eq("group_id", params.groupId);

  const { data: recentLogs } = await supabase
    .from("workout_logs")
    .select("athlete_id, created_at")
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false });

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

  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, is_active")
    .eq("group_id", params.groupId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  const isCoach = roster.some((m) => m.profileId === user?.id && m.role === "coach");
  // A coach opening the installed home-screen app sees the same mobile
  // experience an athlete gets — logging their own training doesn't need
  // the desktop coaching tools. The same coach in a plain browser tab
  // (isPwaStandalone false) still gets the desktop shell everywhere else.
  const showMobileView = !isCoach || isPwaStandalone();

  let weightLogs: { id: string; loggedDate: string; weight: number }[] = [];
  let todayMacros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null = null;
  let todayHabits: { id: string; title: string; completed: boolean }[] = [];
  const todayKey = new Date().toISOString().slice(0, 10);

  const viewerTier = roster.find((m) => m.profileId === user?.id)?.clientTier ?? null;
  const macrosEnabled = viewerTier !== "group";

  if (showMobileView && user) {
    const { data: weightRows } = await supabase
      .from("body_weight_logs")
      .select("id, logged_date, weight")
      .eq("athlete_id", user.id)
      .eq("group_id", params.groupId)
      .order("logged_date", { ascending: false })
      .limit(7);
    weightLogs = (weightRows ?? []).map((w) => ({
      id: w.id,
      loggedDate: w.logged_date,
      weight: w.weight,
    }));

    // Group-tier clients don't get macro programming — skip the fetch
    // entirely rather than fetch-and-hide, same as the coach-side pages.
    if (macrosEnabled) {
      const { data: macroRow } = await supabase
        .from("daily_macros")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("athlete_id", user.id)
        .eq("log_date", todayKey)
        .maybeSingle();
      if (macroRow) {
        todayMacros = {
          calories: macroRow.calories,
          proteinG: macroRow.protein_g,
          carbsG: macroRow.carbs_g,
          fatG: macroRow.fat_g,
        };
      }
    }

    const { data: habitRows } = await supabase
      .from("client_habits")
      .select("id, title, weekdays")
      .eq("athlete_id", user.id)
      .eq("group_id", params.groupId)
      .eq("active", true);
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
      />

      {programs && programs.length > 0 && (
        <section className="px-5 pt-6">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Programs
          </h2>
          <div className="divide-y divide-steel/15">
            {programs.map((p) => (
              <Link
                key={p.id}
                href={`/groups/${params.groupId}/programs/${p.id}`}
                className="flex items-center justify-between py-3 min-h-[44px] active:bg-surface/60 -mx-1 px-1 transition-colors"
              >
                <span className="font-body font-medium text-[15px]">
                  {p.name}
                  {!p.is_active && (
                    <span className="font-body text-[11px] text-steel ml-2 align-middle">
                      inactive
                    </span>
                  )}
                </span>
                <span className="font-body text-xs text-rust">Open &rarr;</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
