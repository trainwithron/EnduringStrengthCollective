// AI Assistant Slice 2 (Collective Intelligence — The Briefing).
// Data-orchestration layer — real Supabase queries, no unit tests of its
// own, same convention as lib/dashboard-data.ts and
// lib/leaderboard-data.ts (only the pure lib/ functions it calls are
// tested). Reuses the exact same pure detectors the Home dashboard hero
// already uses (computeQuietTier, isLowReadiness, detectMatchedLoadTrend,
// computeHabitCompliance) — this is the same underlying signals, just
// gathered as a full candidate LIST per coach instead of one selected
// "most urgent" flag.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQuietTier } from "./quiet-client-tier";
import { isLowReadiness } from "./wellness";
import { detectMatchedLoadTrend, type ExerciseSessionPoint } from "./matched-load-trend";
import { computeHabitCompliance, computeCompliancePct } from "./habits";
import { hasEstablishedBaseline } from "./coach-briefing-baseline";
import { isOnCooldown, COOLDOWN_DAYS } from "./coach-briefing-cooldown";
import { isSustainedHrvSuppression, SUSTAINED_SUPPRESSION_DAYS } from "./hrv-suppression";
import { isGoalReversal, type GoalType } from "./goal-reversal";
import { GOAL_TYPE_LABELS } from "./goal-types";

export type SignalKind =
  | "low_readiness"
  | "hrv_suppression"
  | "goal_reversal"
  | "matched_load_trend_fatigue"
  | "matched_load_trend_gain"
  | "quiet_client"
  | "missed_habits";

export interface CandidateSignal {
  id: string;
  athleteId: string;
  athleteName: string;
  groupId: string;
  kind: SignalKind;
  description: string;
  numericValues: number[];
  isStrongQuietTier: boolean;
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function gatherCandidateSignals(
  supabase: SupabaseClient,
  params: { coachId: string; groupIds: string[] }
): Promise<CandidateSignal[]> {
  const { coachId, groupIds } = params;
  if (groupIds.length === 0) return [];

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const sevenDaysAgoKey = daysAgoKey(7);
  const ninetyDaysAgoKey = daysAgoKey(90);
  const cooldownWindowKey = daysAgoKey(COOLDOWN_DAYS);

  const [
    { data: athleteRows },
    { data: logRows },
    { data: programRows },
    { data: wellnessRows },
    { data: habitRows },
    { data: matchedLoadSetRows },
    { data: nutritionPhaseRows },
    { data: recentBriefingItemRows },
  ] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("group_id, profile_id, joined_at, profiles ( full_name )")
      .in("group_id", groupIds)
      .eq("role", "athlete"),
    supabase
      .from("workout_logs")
      .select("athlete_id, created_at")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("programs")
      .select("group_id, athlete_id, training_days")
      .in("group_id", groupIds)
      .eq("is_active", true),
    supabase
      .from("wellness_checkins")
      .select("athlete_id, sleep_quality, soreness, energy")
      .in("group_id", groupIds)
      .eq("log_date", todayKey),
    supabase
      .from("client_habits")
      .select("id, athlete_id, group_id, weekdays")
      .in("group_id", groupIds)
      .eq("active", true),
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
      .in("session_exercises.athlete_sessions.group_id", groupIds)
      .gte("completed_at", ninetyDaysAgoKey)
      .order("completed_at", { ascending: true }),
    supabase
      .from("nutrition_checkins")
      .select("athlete_id, phase, created_at")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("coach_briefing_items")
      .select("signal_ids, coach_briefings!inner ( coach_id, briefing_date )")
      .eq("coach_briefings.coach_id", coachId)
      .gte("coach_briefings.briefing_date", cooldownWindowKey),
  ]);

  const lastLoggedAtByAthlete = new Map<string, string>();
  for (const log of logRows ?? []) {
    if (!lastLoggedAtByAthlete.has(log.athlete_id)) lastLoggedAtByAthlete.set(log.athlete_id, log.created_at);
  }

  const personalTrainingDaysByAthlete = new Map<string, number[] | null>();
  const sharedTrainingDaysByGroup = new Map<string, number[] | null>();
  for (const p of programRows ?? []) {
    if (p.athlete_id) personalTrainingDaysByAthlete.set(p.athlete_id, p.training_days);
    else sharedTrainingDaysByGroup.set(p.group_id, p.training_days);
  }

  const readinessByAthlete = new Map<string, number>();
  for (const w of wellnessRows ?? []) {
    readinessByAthlete.set(w.athlete_id, (w.sleep_quality + w.soreness + w.energy) / 3);
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
    if (!latestNutritionPhaseByAthlete.has(row.athlete_id)) latestNutritionPhaseByAthlete.set(row.athlete_id, row.phase);
  }

  const priorShownSignalIds: { signalId: string; shownAt: Date }[] = [];
  for (const row of (recentBriefingItemRows ?? []) as any[]) {
    const shownAt = new Date(row.coach_briefings.briefing_date);
    for (const signalId of row.signal_ids ?? []) {
      priorShownSignalIds.push({ signalId, shownAt });
    }
  }

  const athleteByProfileId = new Map<
    string,
    { profileId: string; groupId: string; fullName: string; joinedAt: string | null }
  >();
  for (const row of athleteRows ?? []) {
    if (athleteByProfileId.has(row.profile_id)) continue;
    const profile = (row as any).profiles;
    athleteByProfileId.set(row.profile_id, {
      profileId: row.profile_id,
      groupId: row.group_id,
      fullName: profile?.full_name ?? "Client",
      joinedAt: row.joined_at,
    });
  }

  // AI Assistant Slice 4 — HRV signal. A second-wave fetch (needs the
  // roster's real profile ids first, unlike the athlete-agnostic queries
  // above) scoped to just the athletes on this coach's roster who have
  // an active Oura connection.
  const athleteIds = [...athleteByProfileId.keys()];
  const { data: wearableConnectionRows } =
    athleteIds.length > 0
      ? await supabase
          .from("wearable_connections")
          .select("id, profile_id, created_at")
          .in("profile_id", athleteIds)
          .eq("provider", "oura")
          .eq("status", "active")
      : { data: [] as { id: string; profile_id: string; created_at: string }[] };
  const connectionByAthlete = new Map((wearableConnectionRows ?? []).map((c) => [c.profile_id, c]));
  const connectionIds = (wearableConnectionRows ?? []).map((c) => c.id);
  const hrvCutoffKey = daysAgoKey(SUSTAINED_SUPPRESSION_DAYS);
  const { data: hrvMetricRows } =
    connectionIds.length > 0
      ? await supabase
          .from("wearable_daily_metrics")
          .select("connection_id, metric_date, value")
          .in("connection_id", connectionIds)
          .eq("metric_type", "hrv_balance")
          .gte("metric_date", hrvCutoffKey)
          .order("metric_date", { ascending: true })
      : { data: [] as { connection_id: string; metric_date: string; value: number }[] };
  const hrvPointsByConnection = new Map<string, { date: string; value: number }[]>();
  for (const row of hrvMetricRows ?? []) {
    const list = hrvPointsByConnection.get(row.connection_id) ?? [];
    list.push({ date: row.metric_date, value: row.value });
    hrvPointsByConnection.set(row.connection_id, list);
  }

  // Goal-date-aware nutrition — the goal-reversal flag
  // (goal_date_aware_nutrition_and_programming_idea.md). Only the two
  // most recently CONFIRMED goals matter — a reversal is a genuine
  // direction flip between what the coach most recently signed off on
  // and the one before that, never compared against a still-'proposed'
  // goal (which hasn't taken effect yet).
  const { data: confirmedGoalRows } =
    athleteIds.length > 0
      ? await supabase
          .from("client_goals")
          .select("athlete_id, group_id, goal_type, confirmed_at, created_at")
          .in("athlete_id", athleteIds)
          .eq("status", "confirmed")
          .order("confirmed_at", { ascending: false })
      : { data: [] as { athlete_id: string; group_id: string; goal_type: string; confirmed_at: string; created_at: string }[] };
  const confirmedGoalsByAthlete = new Map<string, { goalType: string; confirmedAt: string }[]>();
  for (const row of confirmedGoalRows ?? []) {
    const list = confirmedGoalsByAthlete.get(row.athlete_id) ?? [];
    list.push({ goalType: row.goal_type, confirmedAt: row.confirmed_at });
    confirmedGoalsByAthlete.set(row.athlete_id, list);
  }

  const candidates: CandidateSignal[] = [];

  function pushIfEligible(signal: CandidateSignal) {
    if (!isOnCooldown(signal.id, priorShownSignalIds, now)) candidates.push(signal);
  }

  for (const athlete of athleteByProfileId.values()) {
    const baselineEstablished = hasEstablishedBaseline(
      athlete.joinedAt ? new Date(athlete.joinedAt) : null,
      now
    );

    const readiness = readinessByAthlete.get(athlete.profileId);
    if (readiness != null && isLowReadiness({ sleepQuality: readiness, soreness: readiness, energy: readiness })) {
      pushIfEligible({
        id: `low_readiness::${athlete.profileId}`,
        athleteId: athlete.profileId,
        athleteName: athlete.fullName,
        groupId: athlete.groupId,
        kind: "low_readiness",
        description: `${athlete.fullName} logged low readiness today (average ${readiness.toFixed(1)} of 5).`,
        numericValues: [Number(readiness.toFixed(1))],
        isStrongQuietTier: false,
      });
    }

    const connection = connectionByAthlete.get(athlete.profileId);
    if (connection) {
      const connectionAgeDays = Math.floor(
        (now.getTime() - new Date(connection.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      const hrvPoints = hrvPointsByConnection.get(connection.id) ?? [];
      if (isSustainedHrvSuppression(hrvPoints, connectionAgeDays)) {
        const recentValues = hrvPoints.slice(-SUSTAINED_SUPPRESSION_DAYS).map((p) => p.value);
        pushIfEligible({
          id: `hrv_suppression::${athlete.profileId}`,
          athleteId: athlete.profileId,
          athleteName: athlete.fullName,
          groupId: athlete.groupId,
          kind: "hrv_suppression",
          description: `${athlete.fullName}'s HRV balance has stayed below 50 for the last ${SUSTAINED_SUPPRESSION_DAYS} days in a row (recent readings: ${recentValues.join(", ")}).`,
          numericValues: [50, SUSTAINED_SUPPRESSION_DAYS, ...recentValues],
          isStrongQuietTier: false,
        });
      }
    }

    // Goal-date-aware nutrition — goal-reversal flag. Only compares the
    // two most recent CONFIRMED goals; the cooldown key includes the
    // newer goal's own confirmation time so a real reversal only ever
    // gets mentioned once, not every day it stays cooled down.
    const confirmedGoals = confirmedGoalsByAthlete.get(athlete.profileId) ?? [];
    if (confirmedGoals.length >= 2) {
      const [newest, previous] = confirmedGoals;
      if (isGoalReversal(previous.goalType as GoalType, newest.goalType as GoalType)) {
        const previousLabel = GOAL_TYPE_LABELS[previous.goalType as GoalType] ?? previous.goalType;
        const newLabel = GOAL_TYPE_LABELS[newest.goalType as GoalType] ?? newest.goalType;
        pushIfEligible({
          id: `goal_reversal::${athlete.profileId}::${newest.confirmedAt}`,
          athleteId: athlete.profileId,
          athleteName: athlete.fullName,
          groupId: athlete.groupId,
          kind: "goal_reversal",
          description: `${athlete.fullName}'s new goal (${newLabel}) contradicts the goal confirmed on ${previous.confirmedAt.slice(0, 10)} (${previousLabel}) — worth a real conversation before anything changes.`,
          numericValues: [],
          isStrongQuietTier: false,
        });
      }
    }

    if (baselineEstablished) {
      const exerciseHistories = exerciseHistoriesByAthlete.get(athlete.profileId);
      if (exerciseHistories) {
        for (const [exerciseName, points] of exerciseHistories) {
          const trend = detectMatchedLoadTrend(exerciseName, points);
          if (!trend) continue;
          const nutritionPhase = latestNutritionPhaseByAthlete.get(athlete.profileId);
          const inDeficitPhase = nutritionPhase === "fat_loss" || nutritionPhase === "reverse_diet";
          if (trend.direction === "fatigue" && inDeficitPhase) continue;
          const id = `matched_load_trend::${athlete.profileId}::${exerciseName}`;
          pushIfEligible({
            id,
            athleteId: athlete.profileId,
            athleteName: athlete.fullName,
            groupId: athlete.groupId,
            kind: trend.direction === "fatigue" ? "matched_load_trend_fatigue" : "matched_load_trend_gain",
            description:
              trend.direction === "fatigue"
                ? `${athlete.fullName}'s RPE on ${exerciseName} rose from ${trend.rpeStart} to ${trend.rpeEnd} across ${trend.sessionCount} sessions at the same or lower weight (${trend.weightStart} to ${trend.weightEnd} lbs).`
                : `${athlete.fullName}'s RPE on ${exerciseName} fell from ${trend.rpeStart} to ${trend.rpeEnd} across ${trend.sessionCount} sessions at the same or higher weight (${trend.weightStart} to ${trend.weightEnd} lbs).`,
            numericValues: [trend.rpeStart, trend.rpeEnd, trend.sessionCount, trend.weightStart, trend.weightEnd],
            isStrongQuietTier: false,
          });
        }
      }
    }

    const trainingDays =
      personalTrainingDaysByAthlete.get(athlete.profileId) ?? sharedTrainingDaysByGroup.get(athlete.groupId) ?? null;
    const lastLoggedAtStr = lastLoggedAtByAthlete.get(athlete.profileId);
    const tier = computeQuietTier({
      lastLoggedAt: lastLoggedAtStr ? new Date(lastLoggedAtStr) : null,
      now,
      trainingDays,
    });
    if (tier !== "none") {
      pushIfEligible({
        id: `quiet_client::${athlete.profileId}`,
        athleteId: athlete.profileId,
        athleteName: athlete.fullName,
        groupId: athlete.groupId,
        kind: "quiet_client",
        description: lastLoggedAtStr
          ? `${athlete.fullName} hasn't logged a workout since ${lastLoggedAtStr.slice(0, 10)}.`
          : `${athlete.fullName} has never logged a workout.`,
        numericValues: [],
        isStrongQuietTier: tier === "strong",
      });
    }

    if (baselineEstablished) {
      const habits = habitsByAthlete.get(athlete.profileId) ?? [];
      if (habits.length > 0) {
        const logs = (habitLogRows ?? [])
          .filter((l) => habits.some((h) => h.id === l.habit_id))
          .map((l) => ({ habitId: l.habit_id, logDate: l.log_date, completed: !!l.completed_at }));
        const compliance = computeHabitCompliance(habits, logs, windowDates);
        const pct = computeCompliancePct(compliance.totalCompleted, compliance.totalDue);
        if (pct != null && pct < 50) {
          const missedCount = compliance.totalDue - compliance.totalCompleted;
          pushIfEligible({
            id: `missed_habits::${athlete.profileId}`,
            athleteId: athlete.profileId,
            athleteName: athlete.fullName,
            groupId: athlete.groupId,
            kind: "missed_habits",
            description: `${athlete.fullName} has missed ${missedCount} habit${missedCount === 1 ? "" : "s"} this week (${pct}% compliance).`,
            numericValues: [missedCount, pct],
            isStrongQuietTier: false,
          });
        }
      }
    }
  }

  return candidates;
}
