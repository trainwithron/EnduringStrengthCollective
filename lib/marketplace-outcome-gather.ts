// The real I/O layer for marketplace-coach-ranking.ts's pure scoring
// logic — assembles actual ClientOutcomeCase[] from this platform's
// real tables. Mirrors this codebase's established pure-logic-then-
// gather split (lib/trainer-dispatch.ts + lib/trainer-dispatch-gather.ts,
// lib/calendar-spotter.ts + lib/calendar-spotter-gather.ts).
//
// Real, honest state as of this build (marketplace_gather_and_browse_
// ui_data_investigation_sept29.md): client_goals has zero real rows in
// production today. This function is correct and ready for when that
// changes — it is expected to return an empty array for every coach
// until real athletes actually propose/confirm goals, which is the
// honest behavior, not a bug to work around.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientOutcomeCase, GoalType } from "./marketplace-coach-ranking";

interface WeightLogRow {
  logged_date: string;
  weight: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// A real, full-span start-vs-end comparison across a client's entire
// logged history with this coach — deliberately NOT a reuse of
// lib/weight-trend.ts's computeWeeklyWeightTrend, which is a
// week-over-week comparison built for the nutrition check-in engine's
// own different question. The ranking research's own spec calls for
// "start vs. end average, not one arbitrary week" specifically so a
// single good/bad week can't swing a whole outcome record — a
// genuinely different computation, sharing only the raw log data.
// Returns null (not false) when there isn't enough real data to call
// it either way — a real "we don't know yet" case is omitted by the
// caller, never guessed.
export function computeFullSpanWeightLossSuccess(logs: WeightLogRow[]): boolean | null {
  if (logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
  // A small window (up to 3 entries) at each end smooths out one-off
  // noisy readings without needing enough history to compute a real
  // weekly average on each side — matches this table's real logging
  // density (irregular, not a guaranteed daily/weekly cadence).
  const windowSize = Math.max(1, Math.min(3, Math.floor(sorted.length / 2)));
  const startAvg = average(sorted.slice(0, windowSize).map((l) => l.weight));
  const endAvg = average(sorted.slice(-windowSize).map((l) => l.weight));
  if (startAvg === null || endAvg === null) return null;
  return endAvg < startAvg;
}

// Real per-(coach, goal_type) gather: every client of this coach with a
// confirmed goal of this type, each resolved to a real success/failure
// verdict from their own real logged data. Only weight_loss and
// endurance_event have a reliable real signal today, matching
// hasReliableOutcomeSignal's own gate in marketplace-coach-ranking.ts —
// this function mirrors that gate rather than trusting every caller to
// check first.
export async function gatherOutcomeCasesForCoach(
  supabase: SupabaseClient,
  coachId: string,
  goalType: GoalType
): Promise<ClientOutcomeCase[]> {
  if (goalType !== "weight_loss" && goalType !== "endurance_event") return [];

  // Every group this coach actually coaches — client_goals is scoped by
  // group_id, the same real boundary lib/trainer-dispatch-gather.ts's
  // own per-coach queries already use.
  const { data: coachedRows } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", coachId)
    .eq("role", "coach");
  const groupIds = (coachedRows ?? []).map((r: { group_id: string }) => r.group_id);
  if (groupIds.length === 0) return [];

  const { data: goalRows } = await supabase
    .from("client_goals")
    .select("athlete_id, group_id, created_at, target_date")
    .in("group_id", groupIds)
    .eq("goal_type", goalType)
    .eq("status", "confirmed");
  if (!goalRows || goalRows.length === 0) return [];

  const cases: ClientOutcomeCase[] = [];

  if (goalType === "weight_loss") {
    for (const goal of goalRows as { athlete_id: string; group_id: string; created_at: string; target_date: string | null }[]) {
      const { data: logs } = await supabase
        .from("body_weight_logs")
        .select("logged_date, weight")
        .eq("athlete_id", goal.athlete_id)
        .eq("group_id", goal.group_id)
        .gte("logged_date", goal.created_at.slice(0, 10));
      const success = computeFullSpanWeightLossSuccess((logs ?? []) as WeightLogRow[]);
      if (success === null) continue; // genuinely not enough real data — omitted, not guessed
      cases.push({ clientId: goal.athlete_id, success, goalCreatedAt: goal.created_at, targetDate: goal.target_date });
    }
  } else {
    // endurance_event: success = at least one real exercise_records row
    // achieved during the engagement window. This table only ever gets
    // a new row when a genuine PB is set (its own supersession logic),
    // so "a row exists after the goal was created" is directly "a real
    // PB was set while working with this coach" — no new computation
    // invented, reusing the table's own real meaning.
    for (const goal of goalRows as { athlete_id: string; group_id: string; created_at: string; target_date: string | null }[]) {
      const { data: records } = await supabase
        .from("exercise_records")
        .select("id")
        .eq("athlete_id", goal.athlete_id)
        .gte("achieved_at", goal.created_at)
        .limit(1);
      cases.push({
        clientId: goal.athlete_id,
        success: (records ?? []).length > 0,
        goalCreatedAt: goal.created_at,
        targetDate: goal.target_date,
      });
    }
  }

  return cases;
}
