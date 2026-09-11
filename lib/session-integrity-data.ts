import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeExpectedMinimumSeconds,
  computeIntegrityLevel,
  type FlaggableSession,
  type IntegrityLevel,
} from "./session-integrity";

export interface AthleteIntegrityResult {
  level: IntegrityLevel;
  flaggedCount: number;
  totalSessions: number;
}

// Batched across a whole group's roster in a few queries (not per
// athlete/session) — same discipline as this app's other roster-wide
// rollups. Reuses athlete_sessions.duration_seconds (already captured by
// the shipped stopwatch feature) against a rough expected-minimum floor
// derived from however many sets were actually logged and their real
// rest_seconds — no new tracking needed.
export async function getIntegrityRollupForGroup(
  supabase: SupabaseClient,
  groupId: string,
  // Scopes the (heavier, session/set-joined) computation to just these
  // athletes — the Clients roster page only ever needs this for the
  // currently-visible page of a paginated roster, not every athlete the
  // group has ever had (the unscoped whole-roster version of this query
  // was a real driver of the 18.5s/1.1MB load a stress-test pass found
  // at 500 athletes). Omit to compute for the whole group, unchanged.
  athleteIds?: string[]
): Promise<Map<string, AthleteIntegrityResult>> {
  if (athleteIds && athleteIds.length === 0) return new Map();

  let query = supabase
    .from("athlete_sessions")
    .select("id, athlete_id, duration_seconds, completed_at")
    .eq("group_id", groupId)
    .eq("status", "completed")
    .not("duration_seconds", "is", null);
  if (athleteIds) query = query.in("athlete_id", athleteIds);
  const { data: sessions } = await query;

  const result = new Map<string, AthleteIntegrityResult>();
  if (!sessions || sessions.length === 0) return result;

  const sessionIds = sessions.map((s: any) => s.id);
  const { data: setRows } = await supabase
    .from("set_logs")
    .select("rest_seconds, status, session_exercises!inner ( session_id )")
    .in("session_exercises.session_id", sessionIds)
    .eq("status", "completed");

  const restSecondsBySession = new Map<string, { restSeconds: number | null }[]>();
  for (const row of (setRows ?? []) as any[]) {
    const sessionId = row.session_exercises.session_id as string;
    const list = restSecondsBySession.get(sessionId) ?? [];
    list.push({ restSeconds: row.rest_seconds });
    restSecondsBySession.set(sessionId, list);
  }

  const flaggableBySessionByAthlete = new Map<string, FlaggableSession[]>();
  for (const s of sessions as any[]) {
    const sets = restSecondsBySession.get(s.id) ?? [];
    if (sets.length === 0) continue; // nothing prescribed/logged to compare against
    const expectedMinimumSeconds = computeExpectedMinimumSeconds(sets);
    const list = flaggableBySessionByAthlete.get(s.athlete_id) ?? [];
    list.push({
      sessionId: s.id,
      actualSeconds: s.duration_seconds,
      expectedMinimumSeconds,
      completedAt: s.completed_at,
    });
    flaggableBySessionByAthlete.set(s.athlete_id, list);
  }

  for (const [athleteId, sessionList] of flaggableBySessionByAthlete) {
    const { level, flaggedCount } = computeIntegrityLevel(sessionList);
    result.set(athleteId, { level, flaggedCount, totalSessions: sessionList.length });
  }

  return result;
}
