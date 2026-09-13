// AI Assistant Phase 2 — Collective Intelligence conversational chat
// (collective_intelligence_phase_2_conversational_assistant.md). The "safe-
// query middle path": a curated, whitelisted set of narrow, deterministic
// lookup functions the chat's router may call — nothing outside this file
// is ever reachable from a conversational question. Every function either
// returns a real result (a citable description + the exact numbers it's
// built from, for the numeral guard) or a null/"no data" result — never a
// fabricated or estimated value.
//
// resolveAthleteByName is the one shared primitive every other lookup
// depends on: it scopes "which athlete" strictly to this coach's own
// roster (every group they coach, across the whole app — matching
// is_client_of_coach's coach-wide scope) and is deliberately deterministic
// (exact match, then substring match, ambiguous on multiple substring
// hits) rather than an LLM guess — this is the actual security boundary,
// not just a lookup convenience.
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectMatchedLoadTrend, type ExerciseSessionPoint } from "./matched-load-trend";
import { computeQuietTier } from "./quiet-client-tier";
import { GOAL_TYPE_LABELS } from "./goal-types";

// Any description embedding an ISO date ("2026-09-09") must also feed the
// date's own digit groups into numericValues — the numeral guard's regex
// matches every hyphen-separated run of digits individually (2026, 9, 9),
// and a caller who forgets this sees the guard correctly-but-confusingly
// reject an answer that only ever repeated the exact date it was given.
function dateAllowedNumbers(dateStr: string): number[] {
  return dateStr
    .slice(0, 10)
    .split("-")
    .map((part) => Number(part));
}

export interface ResolvedAthlete {
  athleteId: string;
  groupId: string;
  fullName: string;
}

export type AthleteResolution = ResolvedAthlete | "ambiguous" | "not_found";

export interface LookupResult {
  description: string;
  numericValues: number[];
  athleteNamesReferenced: string[];
}

async function getCoachRoster(
  supabase: SupabaseClient,
  coachId: string
): Promise<ResolvedAthlete[]> {
  const { data: coachGroups } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", coachId)
    .eq("role", "coach");
  const groupIds = (coachGroups ?? []).map((g) => g.group_id);
  if (groupIds.length === 0) return [];

  const { data: athleteRows } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, profiles ( full_name )")
    .in("group_id", groupIds)
    .eq("role", "athlete");

  const seen = new Set<string>();
  const roster: ResolvedAthlete[] = [];
  for (const row of (athleteRows ?? []) as any[]) {
    if (seen.has(row.profile_id)) continue;
    seen.add(row.profile_id);
    roster.push({
      athleteId: row.profile_id,
      groupId: row.group_id,
      fullName: row.profiles?.full_name ?? "Client",
    });
  }
  return roster;
}

// Deliberately deterministic name matching (exact, then substring) — never
// an LLM guess. "Ambiguous" and "not_found" are real, honest answers the
// synthesis step must relay plainly rather than silently picking one.
export async function resolveAthleteByName(
  supabase: SupabaseClient,
  params: { coachId: string; name: string }
): Promise<AthleteResolution> {
  const roster = await getCoachRoster(supabase, params.coachId);
  const needle = params.name.trim().toLowerCase();
  if (!needle) return "not_found";

  const exact = roster.filter((a) => a.fullName.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";

  const substring = roster.filter((a) => a.fullName.toLowerCase().includes(needle));
  if (substring.length === 1) return substring[0];
  if (substring.length > 1) return "ambiguous";

  return "not_found";
}

// Exposed so the route can build the name guard's "everyone else on this
// roster" blacklist without duplicating the roster fetch.
export async function getRosterFullNames(
  supabase: SupabaseClient,
  coachId: string
): Promise<string[]> {
  const roster = await getCoachRoster(supabase, coachId);
  return roster.map((a) => a.fullName);
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// 1. Most-asked real coach question — "what did they just do."
export async function getLastSessionSummary(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete
): Promise<LookupResult | null> {
  const { data } = await supabase
    .from("workout_logs")
    .select("created_at, total_volume, total_sets_completed, new_prs")
    .eq("athlete_id", athlete.athleteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      description: `${athlete.fullName} has no logged workouts on file.`,
      numericValues: [],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  const dateStr = data.created_at.slice(0, 10);
  const volume = Math.round(Number(data.total_volume ?? 0));
  const sets = data.total_sets_completed ?? 0;
  const prs = (data.new_prs ?? []) as string[];
  const prPart = prs.length > 0 ? ` including a new PR on ${prs.join(", ")}` : "";
  return {
    description: `${athlete.fullName}'s most recent logged workout was on ${dateStr}: ${sets} sets, ${volume} lbs total volume${prPart}.`,
    numericValues: [sets, volume, ...dateAllowedNumbers(dateStr)],
    athleteNamesReferenced: [athlete.fullName],
  };
}

// 2. The direct fix for "I don't have a signal for that yet" — reports the
// real recent history for one exercise even when it falls short of the
// daily briefing's stricter 3-session-streak threshold, so the chat can
// answer a genuinely novel question the fixed signal list doesn't cover.
export async function getExerciseTrend(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete,
  exerciseName: string
): Promise<LookupResult | null> {
  const { data: rows } = await supabase
    .from("set_logs")
    .select(
      `
      weight, rpe, completed_at,
      session_exercises!inner (
        exercise_name, session_id,
        athlete_sessions!inner ( athlete_id )
      )
    `
    )
    .eq("status", "completed")
    .not("weight", "is", null)
    .not("rpe", "is", null)
    .eq("session_exercises.exercise_name", exerciseName)
    .eq("session_exercises.athlete_sessions.athlete_id", athlete.athleteId)
    .order("completed_at", { ascending: true });

  const topSetBySession = new Map<
    string,
    { weight: number; rpe: number; completedAt: string }
  >();
  for (const row of (rows ?? []) as any[]) {
    const sessionId = row.session_exercises?.session_id;
    if (!sessionId) continue;
    const existing = topSetBySession.get(sessionId);
    if (!existing || row.weight > existing.weight || (row.weight === existing.weight && row.rpe > existing.rpe)) {
      topSetBySession.set(sessionId, { weight: row.weight, rpe: row.rpe, completedAt: row.completed_at });
    }
  }
  const points: ExerciseSessionPoint[] = [...topSetBySession.values()]
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .map((p) => ({ sessionDate: p.completedAt, topWeight: p.weight, topSetRpe: p.rpe }));

  if (points.length === 0) {
    return {
      description: `${athlete.fullName} has no logged sets for "${exerciseName}".`,
      numericValues: [],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  const trend = detectMatchedLoadTrend(exerciseName, points);
  const recent = points.slice(-5);
  const recentSummary = recent
    .map((p) => `${p.sessionDate.slice(0, 10)}: ${p.topWeight} lbs @ RPE ${p.topSetRpe}`)
    .join("; ");
  const recentValues = recent.flatMap((p) => [p.topWeight, p.topSetRpe, ...dateAllowedNumbers(p.sessionDate)]);

  if (trend) {
    return {
      description:
        trend.direction === "fatigue"
          ? `${athlete.fullName}'s RPE on ${exerciseName} rose from ${trend.rpeStart} to ${trend.rpeEnd} across ${trend.sessionCount} sessions at the same or lower weight (${trend.weightStart} to ${trend.weightEnd} lbs). Recent sessions: ${recentSummary}.`
          : `${athlete.fullName}'s RPE on ${exerciseName} fell from ${trend.rpeStart} to ${trend.rpeEnd} across ${trend.sessionCount} sessions at the same or higher weight (${trend.weightStart} to ${trend.weightEnd} lbs). Recent sessions: ${recentSummary}.`,
      numericValues: [trend.rpeStart, trend.rpeEnd, trend.sessionCount, trend.weightStart, trend.weightEnd, ...recentValues],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  return {
    description: `${athlete.fullName} has ${points.length} logged session${points.length === 1 ? "" : "s"} on ${exerciseName}, no clear-cut trend yet. Recent sessions: ${recentSummary}.`,
    numericValues: [points.length, ...recentValues],
    athleteNamesReferenced: [athlete.fullName],
  };
}

// 3. Readiness average over a window — same average this app's wellness
// check-ins already compute, just retrieved on demand for one athlete.
export async function getReadinessHistory(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete,
  windowDays: number
): Promise<LookupResult | null> {
  const { data } = await supabase
    .from("wellness_checkins")
    .select("sleep_quality, soreness, energy, log_date")
    .eq("athlete_id", athlete.athleteId)
    .eq("group_id", athlete.groupId)
    .gte("log_date", daysAgoKey(windowDays))
    .order("log_date", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      description: `${athlete.fullName} has no wellness check-ins on file in the last ${windowDays} days.`,
      numericValues: [windowDays],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  const avg =
    rows.reduce((sum, r) => sum + (r.sleep_quality + r.soreness + r.energy) / 3, 0) / rows.length;
  const roundedAvg = Number(avg.toFixed(1));
  return {
    description: `${athlete.fullName}'s average readiness (sleep quality, soreness, energy — each 1-5, higher is better) over the last ${windowDays} days is ${roundedAvg} out of 5, based on ${rows.length} check-in${rows.length === 1 ? "" : "s"}.`,
    // The "each 1-5" scale and "out of 5" phrasing are fixed literals in
    // the description text itself, not computed — they must be allowed
    // too, or the guard rejects an answer that only ever repeated the
    // scale it was given (the same class of miss as an embedded date).
    numericValues: [roundedAvg, rows.length, windowDays, 1, 5],
    athleteNamesReferenced: [athlete.fullName],
  };
}

// 4. Logging consistency for one athlete — reuses the same quiet-tier
// classification the dashboard hero and briefing already use, so the
// chat's framing never disagrees with what's flagged elsewhere.
export async function getLoggingConsistency(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete
): Promise<LookupResult | null> {
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("created_at")
    .eq("athlete_id", athlete.athleteId)
    .order("created_at", { ascending: false })
    .limit(1);

  // Personal program takes precedence over the group's shared one, same
  // fallback order as lib/todays-workout.ts — two narrow queries instead
  // of one .or() so an athlete with both a personal and a shared active
  // program (a real, valid state) never trips a "multiple rows" error.
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("training_days")
    .eq("group_id", athlete.groupId)
    .eq("athlete_id", athlete.athleteId)
    .eq("is_active", true)
    .maybeSingle();
  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("training_days")
        .eq("group_id", athlete.groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();
  const program = personalProgram ?? sharedProgram;

  const lastLoggedAt = logs && logs.length > 0 ? new Date(logs[0].created_at) : null;
  const now = new Date();
  const tier = computeQuietTier({ lastLoggedAt, now, trainingDays: program?.training_days ?? null });

  if (!lastLoggedAt) {
    return {
      description: `${athlete.fullName} has never logged a workout.`,
      numericValues: [],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  const daysSince = Math.round((now.getTime() - lastLoggedAt.getTime()) / 86400000);
  const tierLabel = tier === "none" ? "on track" : tier === "mild" ? "a bit quiet" : "gone quiet";
  return {
    description: `${athlete.fullName} last logged a workout ${daysSince} day${daysSince === 1 ? "" : "s"} ago (${tierLabel} relative to their own training schedule).`,
    numericValues: [daysSince],
    athleteNamesReferenced: [athlete.fullName],
  };
}

// 5. Roster-wide, own-roster count — not a cross-client comparison (the
// coach already sees every one of these names on the Clients page), so
// this doesn't need the cohort-n/de-identification treatment that a
// comparison FEATURE would — it's just this coach's own aggregate.
export async function getRosterLoggingThisWeek(
  supabase: SupabaseClient,
  coachId: string
): Promise<LookupResult | null> {
  const roster = await getCoachRoster(supabase, coachId);
  if (roster.length === 0) {
    return {
      description: "This coach has no athletes on their roster yet.",
      numericValues: [0],
      athleteNamesReferenced: [],
    };
  }
  const sevenDaysAgo = daysAgoKey(7);
  const athleteIds = roster.map((a) => a.athleteId);
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("athlete_id")
    .in("athlete_id", athleteIds)
    .gte("created_at", sevenDaysAgo);

  const loggedSet = new Set((logs ?? []).map((l) => l.athlete_id));
  const loggedCount = loggedSet.size;
  return {
    description: `${loggedCount} of ${roster.length} clients have logged at least one workout in the last 7 days.`,
    numericValues: [loggedCount, roster.length, 7],
    athleteNamesReferenced: [],
  };
}

// 6. Goal + nutrition-phase context — the suppression context every other
// answer needs to be read correctly (a rising-RPE trend during a real cut
// is expected, not concerning).
export async function getGoalAndNutritionPhaseStatus(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete
): Promise<LookupResult | null> {
  const [{ data: goalRow }, { data: phaseRow }] = await Promise.all([
    supabase
      .from("client_goals")
      .select("goal_type, status, confirmed_at")
      .eq("athlete_id", athlete.athleteId)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("nutrition_checkins")
      .select("phase, created_at")
      .eq("athlete_id", athlete.athleteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const goalLabel = goalRow ? GOAL_TYPE_LABELS[goalRow.goal_type as keyof typeof GOAL_TYPE_LABELS] ?? goalRow.goal_type : null;
  const phase = phaseRow?.phase ?? null;

  if (!goalLabel && !phase) {
    return {
      description: `${athlete.fullName} has no confirmed goal or nutrition phase on file.`,
      numericValues: [],
      athleteNamesReferenced: [athlete.fullName],
    };
  }

  const parts: string[] = [];
  if (goalLabel) parts.push(`confirmed goal: ${goalLabel}`);
  if (phase) parts.push(`current nutrition phase: ${phase.replace(/_/g, " ")}`);
  return {
    description: `${athlete.fullName}'s ${parts.join(", ")}.`,
    numericValues: [],
    athleteNamesReferenced: [athlete.fullName],
  };
}
