// Session Pattern Spotter — data-orchestration layer (real Supabase
// queries, no unit tests of its own, same convention as every other
// Spotter's *-gather.ts). Fetches one athlete's real trailing session
// history and runs the 4 pure detectors from lib/session-pattern-spotter.ts
// against it. `numericValues` on each finding is the numeral-guard
// whitelist for the synthesis call downstream — every real number that
// appears in `description` must also appear here, verbatim.
// `evidence` is what actually happened behind each finding (Ron, Oct 20: "show me the actual sets logged that were in question, the actual exercise"): the finding screen shows it as
// rows, so a coach sees the sessions, not just a percentage. Built by the pure buildSessionPatternFindings (lib/session-pattern-evidence.ts), which is tested.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSessionPatternFindings, type PatternSession, type SessionPatternFinding } from "./session-pattern-evidence";
import { getGroupCoachTimezone } from "./timezone";

export type { SessionPatternFinding } from "./session-pattern-evidence";

const RECENT_SESSION_COUNT = 10;

export async function gatherSessionPatternFindings(
  supabase: SupabaseClient,
  // `upTo`: only sessions that started at or before this time (the finding screen looks again at the same sessions the note was about).
  params: { athleteId: string; groupId: string; upTo?: string | null }
): Promise<SessionPatternFinding[]> {
  const { athleteId, groupId, upTo } = params;

  let query = supabase
    .from("athlete_sessions")
    .select(
      "id, started_at, duration_seconds, session_exercises ( exercise_order, exercise_name, tracked_fields, group_workout_exercise_id, set_logs ( set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status ) )"
    )
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("status", "completed");
  if (upTo) query = query.lte("started_at", upTo);
  const { data: sessionRows } = await query.order("started_at", { ascending: false }).limit(RECENT_SESSION_COUNT);

  const sessions = ((sessionRows ?? []) as unknown as PatternSession[]).slice().reverse(); // oldest -> newest
  if (sessions.length === 0) return [];

  // Rest: only real prescribed exercises (group_workout_exercise_id not null) carry a target_rest_seconds worth comparing against — a swapped/added exercise has no template.
  const gweIds = new Set<string>();
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      if (ex.group_workout_exercise_id) gweIds.add(ex.group_workout_exercise_id);
    }
  }
  const { data: targetRows } =
    gweIds.size > 0
      ? await supabase.from("group_workout_exercise_sets").select("group_workout_exercise_id, set_order, target_rest_seconds").in("group_workout_exercise_id", [...gweIds])
      : { data: [] as any[] };
  const targetRestByKey = new Map<string, number>();
  for (const row of (targetRows ?? []) as any[]) {
    if (typeof row.target_rest_seconds === "number") targetRestByKey.set(`${row.group_workout_exercise_id}:${row.set_order}`, row.target_rest_seconds);
  }

  return buildSessionPatternFindings(sessions, targetRestByKey, await getGroupCoachTimezone(supabase, groupId));
}
