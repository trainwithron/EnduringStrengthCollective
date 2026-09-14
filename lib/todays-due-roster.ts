import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodaysWorkoutId } from "./todays-workout";

export interface DueRosterEntry {
  athleteId: string;
  fullName: string;
  workoutId: string;
  workoutTitle: string | null;
}

// Aggregate version of getTodaysWorkoutId's per-athlete resolution — the
// coach mobile Home's "Log a session" block (coach_mobile_app_redesign_
// plan.md) needs "which of my clients are due today," which didn't
// exist as a query before. An N+1 of an already-cheap per-athlete
// lookup — fine for a real roster size; worth batching only if a
// roster ever gets genuinely large.
export async function getTodaysDueRoster(
  supabase: SupabaseClient,
  { groupId }: { groupId: string }
): Promise<DueRosterEntry[]> {
  const { data: rosterRows } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", groupId)
    .eq("role", "athlete");

  const athletes = (rosterRows ?? []).map((r: any) => ({
    athleteId: r.profile_id as string,
    fullName: (r.profiles?.full_name as string | null) ?? "Unknown",
  }));

  if (athletes.length === 0) return [];

  const results = await Promise.all(
    athletes.map(async (a) => ({
      ...a,
      result: await getTodaysWorkoutId(supabase, { groupId, athleteId: a.athleteId }),
    }))
  );

  const ready = results.filter(
    (r): r is typeof r & { result: { status: "ready"; workoutId: string } } => r.result.status === "ready"
  );

  if (ready.length === 0) return [];

  const { data: workoutRows } = await supabase
    .from("workouts")
    .select("id, title")
    .in(
      "id",
      ready.map((r) => r.result.workoutId)
    );
  const titleById = new Map((workoutRows ?? []).map((w) => [w.id, w.title as string | null]));

  return ready
    .map((r) => ({
      athleteId: r.athleteId,
      fullName: r.fullName,
      workoutId: r.result.workoutId,
      workoutTitle: titleById.get(r.result.workoutId) ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
