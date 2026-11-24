import { readRowsByIds } from "@/lib/read-by-ids";
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
import { isImportedFood } from "./imported-food";
import { lastDayKeys, loggedDateKeys } from "./food-log-adherence";
import { dateKeyInZone, getGroupCoachTimezone } from "./timezone";

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

// `scopeGroupIds`: the groups of the organization the coach is in. Ask Spot answers about THAT organization's clients only (never another organization's), so the roster is limited to them.
// The chat reads it ONCE per turn and passes it to every name match and the roster count (Nov 23, Spotters keep up: it used to be read again for every lookup and for the name guard).
export async function getCoachRoster(
  supabase: SupabaseClient,
  coachId: string,
  scopeGroupIds?: string[]
): Promise<ResolvedAthlete[]> {
  const { data: coachGroups } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", coachId)
    .eq("role", "coach");
  const groupIds = (coachGroups ?? []).map((g) => g.group_id).filter((id) => !scopeGroupIds || scopeGroupIds.includes(id));
  if (groupIds.length === 0) return [];

  const { data: athleteRows } = await readRowsByIds(groupIds, (g) => (from, to) =>
    supabase.from("group_memberships").select("profile_id, group_id, profiles ( full_name )").in("group_id", g).eq("role", "athlete").order("id").range(from, to)
  );

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
  params: { coachId: string; name: string; scopeGroupIds?: string[] }
): Promise<AthleteResolution> {
  return matchAthleteInRoster(await getCoachRoster(supabase, params.coachId, params.scopeGroupIds), params.name);
}

// The same match on a roster already read this turn.
export function matchAthleteInRoster(roster: ResolvedAthlete[], name: string): AthleteResolution {
  const needle = name.trim().toLowerCase();
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
  coachId: string,
  scopeGroupIds?: string[]
): Promise<string[]> {
  const roster = await getCoachRoster(supabase, coachId, scopeGroupIds);
  return roster.map((a) => a.fullName);
}

// The chat history: read newest first (so the limit keeps the latest), shown oldest first (route.ts).
export function latestHistory<T>(newestFirst: T[] | null | undefined): T[] {
  return [...(newestFirst ?? [])].reverse();
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

export const EXERCISE_TREND_DAYS = 180;

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
    // the last 180 days only (Nov 23: it read every set ever logged on the exercise; the answer shows the last 5 sessions and the trend needs a few)
    .gte("completed_at", new Date(Date.now() - EXERCISE_TREND_DAYS * 86400000).toISOString())
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
  windowDaysAsked: number
): Promise<LookupResult | null> {
  // A window of 1 to 365 days, whatever the model asked for.
  const windowDays = Math.min(365, Math.max(1, Math.round(Number.isFinite(windowDaysAsked) ? windowDaysAsked : 7)));
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
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("training_days")
        .eq("group_id", athlete.groupId)
        .is("athlete_id", null).eq("org_program", false)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
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
  coachId: string,
  scopeGroupIds?: string[],
  rosterReadThisTurn?: ResolvedAthlete[]
): Promise<LookupResult | null> {
  const roster = rosterReadThisTurn ?? (await getCoachRoster(supabase, coachId, scopeGroupIds));
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
      // the goal in this client's group, never one from another group (a client can be in two groups with two coaches)
      .eq("group_id", athlete.groupId)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("nutrition_checkins")
      .select("phase, created_at")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
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

// Every number written into a description, so the numeral guard lets an answer repeat what the client wrote ("lose 20 lbs by June").
export function numbersInText(...texts: (string | null | undefined)[]): number[] {
  return texts.flatMap((t) => (t ? (t.match(/\d+(\.\d+)?/g) ?? []).map(Number) : []));
}

// Quoted, on one line, at most 300 characters: a client's own words in a description.
function quoteAnswer(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? `"${t.length > 300 ? `${t.slice(0, 297)}...` : t}"` : null;
}

// 7. The goal sheet and the smaller goals (Nov 23, Spotters keep up): the main goal, the smaller goals that are not declined, and the client's answers on the goal sheet. The
// 3-day food recall stays out (it is the nutrition view's).
export async function getGoalSheetAndSubGoals(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete
): Promise<LookupResult | null> {
  const [{ data: goal }, { data: subGoals }, { data: sheet }] = await Promise.all([
    supabase
      .from("client_goals")
      .select("goal_type, custom_label, target_date, status")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
      .in("status", ["confirmed", "proposed"])
      // a confirmed goal before a proposed one (alphabetical), then the newest
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("client_sub_goals")
      .select("title, status, target_date")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
      .neq("status", "declined")
      .order("created_at", { ascending: true })
      .limit(20),
    supabase
      .from("client_goal_sheets")
      .select("why_matters, success_90_days, obstacles, days_per_week, want_score, want_why, work_willing")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
      .maybeSingle(),
  ]);

  const parts: string[] = [];
  const numbers: number[] = [];
  if (goal) {
    const label = goal.goal_type === "custom" && goal.custom_label ? goal.custom_label : GOAL_TYPE_LABELS[goal.goal_type as keyof typeof GOAL_TYPE_LABELS] ?? goal.goal_type;
    const by = goal.target_date ? ` by ${String(goal.target_date).slice(0, 10)}` : "";
    parts.push(`main goal (${goal.status === "confirmed" ? "confirmed" : "proposed, not yet confirmed"}): ${label}${by}`);
    numbers.push(...numbersInText(label));
    if (goal.target_date) numbers.push(...dateAllowedNumbers(String(goal.target_date)));
  }
  const subs = (subGoals ?? []) as { title: string; status: string; target_date: string | null }[];
  if (subs.length > 0) {
    const listed = subs.map((s) => `${s.title}${s.status === "done" ? " (done)" : s.status === "proposed" ? " (proposed)" : ""}${s.target_date ? ` by ${s.target_date.slice(0, 10)}` : ""}`);
    parts.push(`smaller goals: ${listed.join("; ")}`);
    for (const s of subs) {
      numbers.push(...numbersInText(s.title));
      if (s.target_date) numbers.push(...dateAllowedNumbers(s.target_date));
    }
  }
  if (sheet) {
    const answers: string[] = [];
    const add = (label: string, text: string | null | undefined) => {
      const q = quoteAnswer(text);
      if (q) {
        answers.push(`${label} ${q}`);
        numbers.push(...numbersInText(text));
      }
    };
    add("why it matters:", sheet.why_matters);
    add("success in 90 days:", sheet.success_90_days);
    add("what got in the way before:", sheet.obstacles);
    if (sheet.days_per_week != null) {
      answers.push(`can realistically train ${sheet.days_per_week} days a week`);
      numbers.push(sheet.days_per_week, 7);
    }
    if (sheet.want_score != null) {
      answers.push(`how bad they want it: ${sheet.want_score} out of 10`);
      numbers.push(sheet.want_score, 10);
    }
    add("why that number:", sheet.want_why);
    add("how hard they will work:", sheet.work_willing);
    if (answers.length > 0) {
      parts.push(`goal sheet answers: ${answers.join("; ")}`);
      numbers.push(90);
    }
  }

  if (parts.length === 0) {
    return { description: `${athlete.fullName} has no goal, smaller goals or goal sheet answers on file.`, numericValues: [], athleteNamesReferenced: [athlete.fullName] };
  }
  return { description: `${athlete.fullName}'s ${parts.join(". ")}.`, numericValues: numbers, athleteNamesReferenced: [athlete.fullName] };
}

export const FOOD_SUMMARY_DAYS = 7;

export interface FoodSummaryEntry {
  log_date: string;
  status: string | null;
  food_source: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

// The numbers of the food summary (pure, tested), over the client's own last 7 days (`todayKey` is today in their time zone):
//  * the days logged: lib/food-log-adherence.ts loggedDateKeys, the same rule as the weekly check-in and the client page's "Food logged X/7" (anything not skipped, never
//    history brought in from another app);
//  * the average: only over the days with calories written down (a day logged as "coffee" with no numbers still counts as logged, but does not pull the average down).
export function summarizeFoodLog(
  entries: FoodSummaryEntry[],
  todayKey: string
): { daysLogged: number; daysWithNumbers: number; avg: { calories: number; protein: number; carbs: number; fat: number } | null } {
  const window = new Set(lastDayKeys(todayKey, FOOD_SUMMARY_DAYS));
  const daysLogged = new Set(loggedDateKeys(entries).filter((k) => window.has(k))).size;
  const withNumbers = entries.filter(
    (e) => e.status !== "skipped" && !!e.log_date && !isImportedFood(e) && window.has(e.log_date.slice(0, 10)) && e.calories != null && Number.isFinite(Number(e.calories))
  );
  const numberDays = new Set(withNumbers.map((e) => e.log_date.slice(0, 10)));
  if (numberDays.size === 0) return { daysLogged, daysWithNumbers: 0, avg: null };
  const sum = (k: "calories" | "protein_g" | "carbs_g" | "fat_g") => withNumbers.reduce((s, e) => s + (Number(e[k]) || 0), 0);
  const per = (n: number) => Math.round(n / numberDays.size);
  return {
    daysLogged,
    daysWithNumbers: numberDays.size,
    avg: { calories: per(sum("calories")), protein: per(sum("protein_g")), carbs: per(sum("carbs_g")), fat: per(sum("fat_g")) },
  };
}

// The client's own time zone when it is a real one, else the business's (the same order as the client page's "Food logged X/7").
export function clientZone(profileZone: string | null | undefined, businessZone: string): string {
  const z = (profileZone ?? "").trim();
  if (!z) return businessZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return businessZone;
  }
}

// 8. The food log over the last 7 days (Nov 23, Spotters keep up): how many days the client logged and their average calories and macros on those days, against the target the
// coach set.
export async function getFoodLogSummary(
  supabase: SupabaseClient,
  athlete: ResolvedAthlete
): Promise<LookupResult | null> {
  const [{ data: rows }, { data: target }, { data: profile }, businessZone] = await Promise.all([
    supabase
      .from("food_log_entries")
      .select("log_date, status, food_source, calories, protein_g, carbs_g, fat_g")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
      // a little more than a week of dates, so the client's own last 7 days are inside it whatever their time zone (the days are picked below)
      .gte("log_date", daysAgoKey(FOOD_SUMMARY_DAYS + 1))
      .limit(1000),
    supabase
      .from("client_macro_targets")
      .select("calories, protein_g, carbs_g, fat_g")
      .eq("athlete_id", athlete.athleteId)
      .eq("group_id", athlete.groupId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", athlete.athleteId).maybeSingle(),
    getGroupCoachTimezone(supabase, athlete.groupId),
  ]);
  const todayKey = dateKeyInZone(clientZone((profile as { timezone?: string | null } | null)?.timezone, businessZone));
  const { daysLogged, daysWithNumbers, avg } = summarizeFoodLog((rows ?? []) as FoodSummaryEntry[], todayKey);
  const numbers: number[] = [daysLogged, FOOD_SUMMARY_DAYS];
  const t = target as { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null } | null;
  const hasTarget = !!t && t.calories != null;
  const targetText = hasTarget
    ? ` Their target is ${t!.calories} kcal, ${t!.protein_g ?? 0} g protein, ${t!.carbs_g ?? 0} g carbs, ${t!.fat_g ?? 0} g fat.`
    : " No calorie target is set.";
  if (hasTarget) numbers.push(Number(t!.calories), Number(t!.protein_g ?? 0), Number(t!.carbs_g ?? 0), Number(t!.fat_g ?? 0));
  if (!avg) {
    return {
      description:
        daysLogged === 0
          ? `${athlete.fullName} logged food on 0 of the last ${FOOD_SUMMARY_DAYS} days.${targetText}`
          : `${athlete.fullName} logged food on ${daysLogged} of the last ${FOOD_SUMMARY_DAYS} days, with no calories written down on those days.${targetText}`,
      numericValues: [0, ...numbers],
      athleteNamesReferenced: [athlete.fullName],
    };
  }
  numbers.push(avg.calories, avg.protein, avg.carbs, avg.fat, daysWithNumbers);
  const over = daysWithNumbers === daysLogged ? "on the days logged" : `on the ${daysWithNumbers} day${daysWithNumbers === 1 ? "" : "s"} with calories written down`;
  return {
    description: `${athlete.fullName} logged food on ${daysLogged} of the last ${FOOD_SUMMARY_DAYS} days, averaging ${avg.calories} kcal, ${avg.protein} g protein, ${avg.carbs} g carbs and ${avg.fat} g fat ${over}.${targetText}`,
    numericValues: numbers,
    athleteNamesReferenced: [athlete.fullName],
  };
}
