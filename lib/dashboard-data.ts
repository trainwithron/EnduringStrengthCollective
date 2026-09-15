// Server-only data orchestration behind the coach Home dashboard redesign
// (coach_dashboard_redesign_scoping.md). Pairs with the tested pure libs
// (team-pulse.ts, quiet-client-tier.ts, coach-hero-priority.ts) the same
// way lib/leaderboard-data.ts pairs with lib/leaderboard.ts — this file
// does the real Supabase fetching and has no unit tests of its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTeamPulse } from "./team-pulse";
import { computeQuietTier, type QuietTier } from "./quiet-client-tier";
import { selectHeroFlag, type HeroFlag } from "./coach-hero-priority";
import { isLowReadiness } from "./wellness";
import { detectMatchedLoadTrend, type ExerciseSessionPoint } from "./matched-load-trend";
import { computeEngagement, computeEstimatedMRR } from "./business-metrics";
import { computeHabitCompliance, computeCompliancePct } from "./habits";

export interface DashboardGroupInfo {
  id: string;
  name: string;
  // Null for a coach who only administers one organization — callers
  // only need to render this when it's actually ambiguous which org an
  // item belongs to (see coach_desktop_shell's own "You're in: org >
  // group" indicator for the same one-org-is-invisible convention).
  orgName?: string | null;
}

export interface TeamPulseResult {
  groupId: string;
  groupName: string;
  orgName: string | null;
  pulse: number | null;
}

// Hover-peek stat tiles (coach_dashboard_redesign_scoping.md) — each
// tile has a default value plus 1-2 real alternates; hovering shows all
// of them at once (zero commitment), clicking one sets it as that
// tile's new persistent default. `values[0]` is always the tile's
// current default (whatever the coach last picked, or the built-in
// default if they never have).
export interface StatTileValue {
  key: string;
  label: string;
  display: string;
}
export interface StatTileDef {
  key: "clients" | "active" | "attention" | "mrr" | "income";
  values: StatTileValue[];
}
export interface DashboardStatTiles {
  rosterSize: number;
  activeThisWeekPct: number;
  needsAttentionCount: number;
  estimatedMrr: number;
  tiles: StatTileDef[];
}

export interface TodayBooking {
  id: string;
  athleteName: string;
  groupName: string;
  startAt: string;
}

export interface HeroEmptyState {
  kind: "recent_pr" | "compliance_reframe" | "next_session";
  text: string;
  href: string | null;
}

export interface CoachDashboardData {
  heroFlag: (HeroFlag & { href: string; orgName: string | null }) | null;
  heroEmptyState: HeroEmptyState | null;
  teamPulses: TeamPulseResult[];
  statTiles: DashboardStatTiles;
  todayBookings: TodayBooking[];
  weekNarrative: string;
  quietTierByAthlete: Map<string, QuietTier>;
}

function todayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayKeyOf(d);
}

export async function getCoachDashboardData(
  supabase: SupabaseClient,
  params: {
    coachId: string;
    teamGroups: DashboardGroupInfo[];
    allGroups: DashboardGroupInfo[];
    // Which alternate value each hover-peek tile currently defaults to
    // (coach_dashboard_layout.tile_metric_overrides), e.g. {"mrr": "projected"}.
    tileMetricOverrides?: Record<string, string>;
  }
): Promise<CoachDashboardData> {
  const { coachId, teamGroups, allGroups, tileMetricOverrides = {} } = params;
  const allGroupIds = allGroups.map((g) => g.id);
  const groupNameById = new Map(allGroups.map((g) => [g.id, g.name]));
  const orgNameByGroupId = new Map(allGroups.map((g) => [g.id, g.orgName ?? null]));
  const now = new Date();
  const todayKey = todayKeyOf(now);
  const sevenDaysAgoKey = daysAgoKey(7);
  const monthKey = todayKey.slice(0, 7);

  if (allGroupIds.length === 0) {
    return {
      heroFlag: null,
      heroEmptyState: null,
      teamPulses: [],
      statTiles: { rosterSize: 0, activeThisWeekPct: 0, needsAttentionCount: 0, estimatedMrr: 0, tiles: [] },
      todayBookings: [],
      weekNarrative: "No clients yet — invite your first one to get started.",
      quietTierByAthlete: new Map(),
    };
  }

  const ninetyDaysAgoKey = daysAgoKey(90);

  const [
    { data: athleteRows },
    { data: logRows },
    { data: programRows },
    { data: wellnessTodayRows },
    { data: habitRows },
    { data: bookingRows },
    { data: creditPurchaseRows },
    { data: matchedLoadSetRows },
    { data: nutritionPhaseRows },
  ] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("group_id, profile_id, monthly_rate, joined_at, profiles ( full_name )")
      .in("group_id", allGroupIds)
      .eq("role", "athlete"),
    supabase
      .from("workout_logs")
      .select("athlete_id, group_id, created_at, new_prs")
      .in("group_id", allGroupIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("programs")
      .select("group_id, athlete_id, training_days")
      .in("group_id", allGroupIds)
      .eq("is_active", true),
    supabase
      .from("wellness_checkins")
      .select("athlete_id, group_id, sleep_quality, soreness, energy")
      .in("group_id", allGroupIds)
      .eq("log_date", todayKey),
    supabase
      .from("client_habits")
      .select("id, athlete_id, group_id, weekdays")
      .in("group_id", allGroupIds)
      .eq("active", true),
    supabase
      .from("bookings")
      .select("id, group_id, start_at, status, profiles!bookings_athlete_id_fkey ( full_name )")
      .eq("coach_id", coachId)
      .in("group_id", allGroupIds)
      .eq("status", "confirmed")
      .gte("start_at", `${todayKey}T00:00:00`)
      .lt("start_at", `${todayKey}T23:59:59`)
      .order("start_at", { ascending: true }),
    supabase
      .from("credit_purchases")
      .select("amount_cents, created_at")
      .in("group_id", allGroupIds)
      .gte("created_at", daysAgoKey(30)),
    // AI Assistant Slice 1 (lib/matched-load-trend.ts) — every completed
    // set with a real weight+RPE, bounded to the last 90 days (enough
    // real session history for a 3+ session trend without scanning an
    // athlete's whole career). Grouped client-side into one top-set-per-
    // session point per (athlete, exercise) below.
    supabase
      .from("set_logs")
      .select(
        `
        weight, rpe, completed_at,
        session_exercises!inner (
          exercise_name, session_id,
          athlete_sessions!inner ( athlete_id, group_id )
        )
      `
      )
      .eq("status", "completed")
      .not("weight", "is", null)
      .not("rpe", "is", null)
      .in("session_exercises.athlete_sessions.group_id", allGroupIds)
      .gte("completed_at", ninetyDaysAgoKey)
      .order("completed_at", { ascending: true }),
    // Suppresses the fatigue direction for an athlete in a deliberate
    // 'fat_loss' or 'reverse_diet' phase — falling strength/rising RPE at
    // matched load is the EXPECTED result of a real caloric deficit, not
    // a fatigue signal, per ai_assistant_opus_deep_dive_findings.md's
    // single biggest predictable false-positive (named there for
    // 'fat_loss' specifically; 'reverse_diet' carries the identical
    // caloric-deficit reasoning so it gets the same treatment). Never
    // suppresses the celebration direction. First-seen (most recent) row
    // per athlete wins.
    supabase
      .from("nutrition_checkins")
      .select("athlete_id, phase, created_at")
      .in("group_id", allGroupIds)
      .order("created_at", { ascending: false }),
  ]);

  // Most recent completed-workout date per athlete — first occurrence
  // wins since logRows is already ordered newest-first.
  const lastLoggedAtByAthlete = new Map<string, string>();
  for (const log of logRows ?? []) {
    if (!lastLoggedAtByAthlete.has(log.athlete_id)) {
      lastLoggedAtByAthlete.set(log.athlete_id, log.created_at);
    }
  }

  // AI Assistant Slice 1 — reduce every logged set down to one top-set
  // (heaviest) per (athlete, exercise, session), then group those into
  // chronological point lists per (athlete, exercise) for the pure
  // detector. A tie at the same top weight keeps the higher-RPE set,
  // the "worst case" reading rather than an arbitrary pick.
  const topSetByKey = new Map<
    string,
    { athleteId: string; exerciseName: string; weight: number; rpe: number; completedAt: string }
  >();
  for (const row of (matchedLoadSetRows ?? []) as any[]) {
    const sessionExercise = row.session_exercises;
    const athleteId = sessionExercise?.athlete_sessions?.athlete_id;
    const exerciseName = sessionExercise?.exercise_name;
    const sessionId = sessionExercise?.session_id;
    if (!athleteId || !exerciseName || !sessionId) continue;
    const key = `${athleteId}::${exerciseName}::${sessionId}`;
    const existing = topSetByKey.get(key);
    if (!existing || row.weight > existing.weight || (row.weight === existing.weight && row.rpe > existing.rpe)) {
      topSetByKey.set(key, { athleteId, exerciseName, weight: row.weight, rpe: row.rpe, completedAt: row.completed_at });
    }
  }
  const exerciseHistoriesByAthlete = new Map<string, Map<string, ExerciseSessionPoint[]>>();
  for (const top of topSetByKey.values()) {
    const athleteMap = exerciseHistoriesByAthlete.get(top.athleteId) ?? new Map<string, ExerciseSessionPoint[]>();
    const points = athleteMap.get(top.exerciseName) ?? [];
    points.push({ sessionDate: top.completedAt, topWeight: top.weight, topSetRpe: top.rpe });
    athleteMap.set(top.exerciseName, points);
    exerciseHistoriesByAthlete.set(top.athleteId, athleteMap);
  }
  for (const athleteMap of exerciseHistoriesByAthlete.values()) {
    for (const points of athleteMap.values()) {
      points.sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
    }
  }

  const latestNutritionPhaseByAthlete = new Map<string, string>();
  for (const row of nutritionPhaseRows ?? []) {
    if (!latestNutritionPhaseByAthlete.has(row.athlete_id)) {
      latestNutritionPhaseByAthlete.set(row.athlete_id, row.phase);
    }
  }

  // A personal program (athlete_id set) always wins over the group's
  // shared one for that specific athlete — same precedence used
  // throughout the app (lib/todays-workout.ts, lib/athlete-day-schedule.ts).
  const personalTrainingDaysByAthlete = new Map<string, number[] | null>();
  const sharedTrainingDaysByGroup = new Map<string, number[] | null>();
  for (const p of programRows ?? []) {
    if (p.athlete_id) {
      personalTrainingDaysByAthlete.set(p.athlete_id, p.training_days);
    } else {
      sharedTrainingDaysByGroup.set(p.group_id, p.training_days);
    }
  }

  const readinessByAthlete = new Map<string, number>();
  for (const w of wellnessTodayRows ?? []) {
    readinessByAthlete.set(
      w.athlete_id,
      (w.sleep_quality + w.soreness + w.energy) / 3
    );
  }

  const habitsByAthlete = new Map<string, { id: string; weekdays: number[] }[]>();
  for (const h of habitRows ?? []) {
    const list = habitsByAthlete.get(h.athlete_id) ?? [];
    list.push({ id: h.id, weekdays: h.weekdays });
    habitsByAthlete.set(h.athlete_id, list);
  }
  const habitIds = (habitRows ?? []).map((h) => h.id);
  const { data: habitLogRows } =
    habitIds.length > 0
      ? await supabase
          .from("habit_logs")
          .select("habit_id, log_date, completed_at")
          .in("habit_id", habitIds)
          .gte("log_date", sevenDaysAgoKey)
      : { data: [] as { habit_id: string; log_date: string; completed_at: string | null }[] };

  const windowDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    windowDates.push(d);
  }

  function habitComplianceFor(athleteId: string): { totalDue: number; totalCompleted: number } {
    const habits = habitsByAthlete.get(athleteId) ?? [];
    if (habits.length === 0) return { totalDue: 0, totalCompleted: 0 };
    const logs = (habitLogRows ?? [])
      .filter((l) => habits.some((h) => h.id === l.habit_id))
      .map((l) => ({ habitId: l.habit_id, logDate: l.log_date, completed: !!l.completed_at }));
    return computeHabitCompliance(habits, logs, windowDates);
  }

  // Dedupe the roster by profile — a client can technically belong to
  // more than one group, and every roster-wide count/flag should count
  // them once, not once per membership.
  const athleteByProfileId = new Map<
    string,
    { profileId: string; groupId: string; groupName: string; fullName: string; monthlyRate: number | null; joinedAt: string | null }
  >();
  for (const row of athleteRows ?? []) {
    if (athleteByProfileId.has(row.profile_id)) continue;
    const profile = (row as any).profiles;
    athleteByProfileId.set(row.profile_id, {
      profileId: row.profile_id,
      groupId: row.group_id,
      groupName: groupNameById.get(row.group_id) ?? "Group",
      fullName: profile?.full_name ?? "Client",
      monthlyRate: row.monthly_rate,
      joinedAt: row.joined_at,
    });
  }
  const athletes = [...athleteByProfileId.values()];

  const heroFlags: (HeroFlag & { href: string })[] = [];
  const quietTierByAthlete = new Map<string, QuietTier>();
  let needsAttentionCount = 0;
  let mildTierCount = 0;
  let strongTierCount = 0;

  for (const athlete of athletes) {
    const href = `/groups/${athlete.groupId}/athletes/${athlete.profileId}`;

    const readiness = readinessByAthlete.get(athlete.profileId);
    if (readiness != null && isLowReadiness({ sleepQuality: readiness, soreness: readiness, energy: readiness })) {
      // isLowReadiness only needs the AVERAGE to be meaningful — feeding
      // the same pre-averaged number into all three fields reproduces
      // the identical average without needing the individual components.
      heroFlags.push({
        kind: "low_readiness",
        athleteId: athlete.profileId,
        athleteName: athlete.fullName,
        groupId: athlete.groupId,
        groupName: athlete.groupName,
        readiness,
        href,
      });
    }

    // AI Assistant Slice 1 — pick this athlete's single most notable
    // matched-load trend per direction (the longest-running one, if more
    // than one exercise qualifies), rather than pushing one flag per
    // exercise and flooding the candidate pool with near-duplicates for
    // the same athlete.
    const exerciseHistories = exerciseHistoriesByAthlete.get(athlete.profileId);
    if (exerciseHistories) {
      let bestFatigue: ReturnType<typeof detectMatchedLoadTrend> = null;
      let bestGain: ReturnType<typeof detectMatchedLoadTrend> = null;
      for (const [exerciseName, points] of exerciseHistories) {
        const trend = detectMatchedLoadTrend(exerciseName, points);
        if (!trend) continue;
        if (trend.direction === "fatigue" && (!bestFatigue || trend.sessionCount > bestFatigue.sessionCount)) {
          bestFatigue = trend;
        }
        if (trend.direction === "strength_gain" && (!bestGain || trend.sessionCount > bestGain.sessionCount)) {
          bestGain = trend;
        }
      }
      // The single biggest predictable false-positive
      // (ai_assistant_opus_deep_dive_findings.md): an athlete in a
      // deliberate fat_loss (or reverse_diet — same caloric-deficit
      // reasoning) phase is SUPPOSED to show rising RPE at matched load —
      // that's the expected result of the coach's own plan, not a
      // fatigue signal. Never suppresses the celebration direction — a
      // real strength gain is worth surfacing regardless of nutrition
      // phase.
      const nutritionPhase = latestNutritionPhaseByAthlete.get(athlete.profileId);
      const inCaloricDeficitPhase = nutritionPhase === "fat_loss" || nutritionPhase === "reverse_diet";
      if (bestFatigue && !inCaloricDeficitPhase) {
        heroFlags.push({
          kind: "matched_load_trend",
          athleteId: athlete.profileId,
          athleteName: athlete.fullName,
          groupId: athlete.groupId,
          groupName: athlete.groupName,
          direction: "fatigue",
          exerciseName: bestFatigue.exerciseName,
          sessionCount: bestFatigue.sessionCount,
          href,
        });
      }
      if (bestGain) {
        heroFlags.push({
          kind: "matched_load_trend",
          athleteId: athlete.profileId,
          athleteName: athlete.fullName,
          groupId: athlete.groupId,
          groupName: athlete.groupName,
          direction: "strength_gain",
          exerciseName: bestGain.exerciseName,
          sessionCount: bestGain.sessionCount,
          href,
        });
      }
    }

    const trainingDays =
      personalTrainingDaysByAthlete.get(athlete.profileId) ??
      sharedTrainingDaysByGroup.get(athlete.groupId) ??
      null;
    const lastLoggedAtStr = lastLoggedAtByAthlete.get(athlete.profileId);
    const tier = computeQuietTier({
      lastLoggedAt: lastLoggedAtStr ? new Date(lastLoggedAtStr) : null,
      now,
      trainingDays,
    });
    quietTierByAthlete.set(athlete.profileId, tier);
    if (tier !== "none") {
      needsAttentionCount++;
      if (tier === "mild") mildTierCount++;
      if (tier === "strong") strongTierCount++;
      heroFlags.push({
        kind: "quiet_client",
        athleteId: athlete.profileId,
        athleteName: athlete.fullName,
        groupId: athlete.groupId,
        groupName: athlete.groupName,
        tier,
        href,
      });
    }

    const compliance = habitComplianceFor(athlete.profileId);
    const pct = computeCompliancePct(compliance.totalCompleted, compliance.totalDue);
    if (pct != null && pct < 50) {
      heroFlags.push({
        kind: "missed_habits",
        athleteId: athlete.profileId,
        athleteName: athlete.fullName,
        groupId: athlete.groupId,
        groupName: athlete.groupName,
        missedCount: compliance.totalDue - compliance.totalCompleted,
        href,
      });
    }
  }

  const selectedHeroFlag = selectHeroFlag(heroFlags) as (HeroFlag & { href: string }) | null;
  const heroFlag = selectedHeroFlag
    ? { ...selectedHeroFlag, orgName: orgNameByGroupId.get(selectedHeroFlag.groupId) ?? null }
    : null;

  // Empty-state rotation when nothing real is flagged — recent PR/streak
  // celebration first, then a positive compliance reframe, then just
  // pointing at the next scheduled session. (The doc's fourth slot,
  // reused coaching/business tip content, is skipped — that content bank
  // doesn't exist yet; a real follow-up, not silently dropped.)
  let heroEmptyState: HeroEmptyState | null = null;
  if (!heroFlag) {
    const recentPrLog = (logRows ?? []).find(
      (l) => (l.new_prs?.length ?? 0) > 0 && Date.now() - new Date(l.created_at).getTime() < 3 * 24 * 60 * 60 * 1000
    );
    if (recentPrLog) {
      const athlete = athleteByProfileId.get(recentPrLog.athlete_id);
      heroEmptyState = {
        kind: "recent_pr",
        text: `${athlete?.fullName ?? "A client"} just hit a new PR — worth a shoutout.`,
        href: athlete ? `/groups/${athlete.groupId}/athletes/${athlete.profileId}` : null,
      };
    } else if (athletes.length > 0) {
      const engagement = computeEngagement(
        athletes.map((a) => ({
          lastActiveDateKey: lastLoggedAtByAthlete.get(a.profileId)?.slice(0, 10) ?? null,
        })),
        todayKey,
        7
      );
      if (engagement.pct >= 70) {
        heroEmptyState = {
          kind: "compliance_reframe",
          text: `${engagement.activeCount} of ${engagement.totalCount} clients logged a workout this week (${engagement.pct}%) — everyone's on track.`,
          href: null,
        };
      } else if (bookingRows && bookingRows.length > 0) {
        const next = bookingRows[0] as any;
        heroEmptyState = {
          kind: "next_session",
          text: `Next up: ${next.profiles?.full_name ?? "a client"} at ${new Date(next.start_at).toLocaleTimeString(
            "en-US",
            { hour: "numeric", minute: "2-digit" }
          )}.`,
          href: null,
        };
      } else {
        heroEmptyState = { kind: "compliance_reframe", text: "Nothing urgent right now — a quiet day.", href: null };
      }
    }
  }

  // Team Pulse — one score per real team-mode group, never blended.
  const teamPulses: TeamPulseResult[] = teamGroups.map((group) => {
    const groupAthletes = athletes.filter((a) => a.groupId === group.id);
    if (groupAthletes.length === 0) {
      return { groupId: group.id, groupName: group.name, orgName: group.orgName ?? null, pulse: null };
    }

    const readinessValues = groupAthletes
      .map((a) => readinessByAthlete.get(a.profileId))
      .filter((v): v is number => v != null);
    const avgReadinessToday =
      readinessValues.length > 0 ? readinessValues.reduce((s, v) => s + v, 0) / readinessValues.length : null;

    const engagement = computeEngagement(
      groupAthletes.map((a) => ({ lastActiveDateKey: lastLoggedAtByAthlete.get(a.profileId)?.slice(0, 10) ?? null })),
      todayKey,
      7
    );

    let totalDue = 0;
    let totalCompleted = 0;
    for (const a of groupAthletes) {
      const c = habitComplianceFor(a.profileId);
      totalDue += c.totalDue;
      totalCompleted += c.totalCompleted;
    }
    const habitCompliancePct = computeCompliancePct(totalCompleted, totalDue);

    return {
      groupId: group.id,
      groupName: group.name,
      orgName: group.orgName ?? null,
      pulse: computeTeamPulse({ avgReadinessToday, pctActiveThisWeek: engagement.pct, habitCompliancePct }),
    };
  });

  // Stat tiles + this-week narrative.
  const rosterEngagement = computeEngagement(
    athletes.map((a) => ({ lastActiveDateKey: lastLoggedAtByAthlete.get(a.profileId)?.slice(0, 10) ?? null })),
    todayKey,
    7
  );
  const estimatedMrr = computeEstimatedMRR(athletes.map((a) => ({ monthlyRate: a.monthlyRate })));

  const engagementToday = computeEngagement(
    athletes.map((a) => ({ lastActiveDateKey: lastLoggedAtByAthlete.get(a.profileId)?.slice(0, 10) ?? null })),
    todayKey,
    1
  );
  const engagementMonth = computeEngagement(
    athletes.map((a) => ({ lastActiveDateKey: lastLoggedAtByAthlete.get(a.profileId)?.slice(0, 10) ?? null })),
    todayKey,
    30
  );
  const newThisMonthCount = athletes.filter((a) => a.joinedAt?.slice(0, 7) === monthKey).length;

  // Income — real, from credit_purchases (one-time credit-pack
  // purchases). Subscription/membership income isn't in this table
  // (membership_subscriptions tracks status, not individual payments),
  // so this is a real but partial income figure — the same honest
  // partial-data caveat lib/business-metrics.ts's own MRR functions
  // already carry.
  const incomeMonthCents = (creditPurchaseRows ?? [])
    .filter((r) => r.created_at.slice(0, 7) === monthKey)
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const incomeWeekCents = (creditPurchaseRows ?? [])
    .filter((r) => r.created_at >= sevenDaysAgoKey)
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const incomeTodayCents = (creditPurchaseRows ?? [])
    .filter((r) => r.created_at.slice(0, 10) === todayKey)
    .reduce((sum, r) => sum + r.amount_cents, 0);

  // Reorders one tile's alternate values so the coach's saved pick
  // (tile_metric_overrides) is `values[0]`, the current default — falls
  // back to whatever was already first when there's no override, or the
  // saved key no longer matches any real value.
  function withOverride(key: string, values: StatTileValue[]): StatTileValue[] {
    const pick = tileMetricOverrides[key];
    if (!pick) return values;
    const index = values.findIndex((v) => v.key === pick);
    if (index <= 0) return values;
    const reordered = [...values];
    const [chosen] = reordered.splice(index, 1);
    reordered.unshift(chosen);
    return reordered;
  }

  const tiles: StatTileDef[] = [
    {
      key: "clients",
      values: withOverride("clients", [
        { key: "current", label: "Clients", display: String(athletes.length) },
        { key: "new_this_month", label: "New this month", display: String(newThisMonthCount) },
        { key: "at_risk", label: "At-risk clients", display: String(needsAttentionCount) },
      ]),
    },
    {
      key: "active",
      values: withOverride("active", [
        { key: "current", label: "Active this week", display: `${rosterEngagement.pct}%` },
        { key: "today", label: "Active today", display: `${engagementToday.pct}%` },
        { key: "month", label: "Active this month", display: `${engagementMonth.pct}%` },
      ]),
    },
    {
      key: "attention",
      values: withOverride("attention", [
        { key: "current", label: "Need attention", display: String(needsAttentionCount) },
        { key: "mild", label: "Mild tier", display: String(mildTierCount) },
        { key: "strong", label: "Strong tier", display: String(strongTierCount) },
      ]),
    },
    {
      key: "mrr",
      values: withOverride("mrr", [
        { key: "current", label: "Est. MRR", display: `$${estimatedMrr.toLocaleString()}` },
        // No historical MRR tracking exists yet (monthly_rate is a
        // current snapshot, not logged over time) — "projected" is
        // honestly just the current estimate, not a real growth model.
        { key: "projected", label: "Projected next month", display: `$${estimatedMrr.toLocaleString()}` },
      ]),
    },
    {
      key: "income",
      values: withOverride("income", [
        { key: "current", label: "Income this month", display: `$${(incomeMonthCents / 100).toLocaleString()}` },
        { key: "week", label: "Income this week", display: `$${(incomeWeekCents / 100).toLocaleString()}` },
        { key: "today", label: "Income today", display: `$${(incomeTodayCents / 100).toLocaleString()}` },
      ]),
    },
  ];

  const statTiles: DashboardStatTiles = {
    rosterSize: athletes.length,
    activeThisWeekPct: rosterEngagement.pct,
    needsAttentionCount,
    estimatedMrr,
    tiles,
  };

  const weekNarrative =
    athletes.length === 0
      ? "No clients yet — invite your first one to get started."
      : `${rosterEngagement.activeCount} of ${rosterEngagement.totalCount} clients logged a workout this week (${rosterEngagement.pct}%)${
          needsAttentionCount > 0 ? ` — ${needsAttentionCount} need${needsAttentionCount === 1 ? "s" : ""} a check-in` : ""
        }.`;

  const todayBookings: TodayBooking[] = (bookingRows ?? []).map((b: any) => ({
    id: b.id,
    athleteName: b.profiles?.full_name ?? "A client",
    groupName: groupNameById.get(b.group_id) ?? "Group",
    startAt: b.start_at,
  }));

  return {
    heroFlag,
    heroEmptyState,
    teamPulses,
    statTiles,
    todayBookings,
    weekNarrative,
    quietTierByAthlete,
  };
}
