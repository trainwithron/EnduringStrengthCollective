// Session Pattern Spotter — data-orchestration layer (real Supabase
// queries, no unit tests of its own, same convention as every other
// Spotter's *-gather.ts). Fetches one athlete's real trailing session
// history and runs the 4 pure detectors from lib/session-pattern-spotter.ts
// against it. `numericValues` on each finding is the numeral-guard
// whitelist for the synthesis call downstream — every real number that
// appears in `description` must also appear here, verbatim.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectRpeCreep,
  detectRestTimeCreep,
  detectStrugglePoint,
  detectWeekdayRushing,
} from "./session-pattern-spotter";

export interface SessionPatternFinding {
  kind: "rpe_creep" | "rest_time_creep" | "struggle_point" | "weekday_rushing";
  description: string;
  numericValues: number[];
}

const RECENT_SESSION_COUNT = 10;
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function gatherSessionPatternFindings(
  supabase: SupabaseClient,
  params: { athleteId: string; groupId: string }
): Promise<SessionPatternFinding[]> {
  const { athleteId, groupId } = params;

  const { data: sessionRows } = await supabase
    .from("athlete_sessions")
    .select(
      "id, started_at, duration_seconds, session_exercises ( exercise_order, group_workout_exercise_id, set_logs ( set_order, rpe, rest_seconds, status ) )"
    )
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(RECENT_SESSION_COUNT);

  const sessions = (sessionRows ?? []).slice().reverse() as any[]; // oldest -> newest
  if (sessions.length === 0) return [];

  const findings: SessionPatternFinding[] = [];

  // --- Signal 1: RPE creep ---
  const sessionAvgRpes: number[] = [];
  for (const s of sessions) {
    const rpes: number[] = [];
    for (const ex of s.session_exercises ?? []) {
      for (const set of ex.set_logs ?? []) {
        if (typeof set.rpe === "number") rpes.push(set.rpe);
      }
    }
    if (rpes.length > 0) sessionAvgRpes.push(rpes.reduce((a, b) => a + b, 0) / rpes.length);
  }
  const rpeCreep = detectRpeCreep(sessionAvgRpes);
  if (rpeCreep) {
    const recent = round1(rpeCreep.recentAvgRpe);
    const baseline = round1(rpeCreep.baselineAvgRpe);
    findings.push({
      kind: "rpe_creep",
      description: `Average logged RPE has dropped from ${baseline} to ${recent} over their last few sessions.`,
      numericValues: [recent, baseline],
    });
  }

  // --- Signal 2: rest-time creep ---
  // Only real prescribed exercises (group_workout_exercise_id not null)
  // carry a target_rest_seconds worth comparing against — a swapped/
  // added exercise has no template to compare to.
  const gweIds = new Set<string>();
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      if (ex.group_workout_exercise_id) gweIds.add(ex.group_workout_exercise_id);
    }
  }
  const { data: targetRows } =
    gweIds.size > 0
      ? await supabase
          .from("group_workout_exercise_sets")
          .select("group_workout_exercise_id, set_order, target_rest_seconds")
          .in("group_workout_exercise_id", [...gweIds])
      : { data: [] as any[] };
  const targetRestByKey = new Map<string, number>();
  for (const row of targetRows ?? []) {
    if (typeof row.target_rest_seconds === "number") {
      targetRestByKey.set(`${row.group_workout_exercise_id}:${row.set_order}`, row.target_rest_seconds);
    }
  }
  const restSamples: { targetRestSeconds: number; actualRestSeconds: number }[] = [];
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      if (!ex.group_workout_exercise_id) continue;
      for (const set of ex.set_logs ?? []) {
        if (typeof set.rest_seconds !== "number") continue;
        const target = targetRestByKey.get(`${ex.group_workout_exercise_id}:${set.set_order}`);
        if (typeof target === "number" && target > 0) {
          restSamples.push({ targetRestSeconds: target, actualRestSeconds: set.rest_seconds });
        }
      }
    }
  }
  const restCreep = detectRestTimeCreep(restSamples);
  if (restCreep) {
    const avgActual = Math.round(restCreep.avgActualSeconds);
    const avgTarget = Math.round(restCreep.avgTargetSeconds);
    findings.push({
      kind: "rest_time_creep",
      description: `Real rest between sets is averaging ${avgActual}s against a prescribed ${avgTarget}s (${restCreep.direction === "over" ? "consistently longer" : "consistently shorter"} than programmed).`,
      numericValues: [avgActual, avgTarget],
    });
  }

  // --- Signal 3: struggle point ---
  const slotSamples: { slotIndex: number; setsCompleted: number; setsPrescribed: number }[] = [];
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      const sets = ex.set_logs ?? [];
      if (sets.length === 0) continue;
      const completed = sets.filter((set: any) => set.status === "completed").length;
      slotSamples.push({ slotIndex: ex.exercise_order, setsCompleted: completed, setsPrescribed: sets.length });
    }
  }
  const struggle = detectStrugglePoint(slotSamples);
  if (struggle) {
    const pct = Math.round(struggle.avgCompletionPct);
    findings.push({
      kind: "struggle_point",
      description: `Exercise slot #${struggle.slotIndex} (often the first exercise) is only getting ${pct}% of its prescribed sets completed on average.`,
      numericValues: [pct, struggle.slotIndex],
    });
  }

  // --- Signal 4: weekday rushing ---
  const weekdaySamples = sessions
    .filter((s) => typeof s.duration_seconds === "number" && s.duration_seconds > 0)
    .map((s) => ({ weekday: new Date(s.started_at).getDay(), durationSeconds: s.duration_seconds as number }));
  const rushing = detectWeekdayRushing(weekdaySamples);
  if (rushing) {
    const avgMin = Math.round(rushing.avgDurationSeconds / 60);
    const overallMin = Math.round(rushing.overallAvgDurationSeconds / 60);
    findings.push({
      kind: "weekday_rushing",
      description: `${WEEKDAY_LABELS[rushing.weekday]} sessions average ${avgMin} min, real sessions overall average ${overallMin} min.`,
      numericValues: [avgMin, overallMin],
    });
  }

  return findings;
}
