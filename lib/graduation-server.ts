import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "@/lib/page-all";
import type { HistorySession } from "@/lib/graduation";
import { pastSetDone } from "@/lib/set-complete";

// A player's completed workouts, with every logged set, read with the server's own (service role) client for the player the caller has already been checked against. A failed page is reported (failed), never
// treated as "nothing logged", so a half-read history is never sent as if it were whole.
const MAX_SESSIONS = 2000;

interface SessionRow {
  id: string;
  started_at: string | null;
  completed_at: string | null;
  workouts: { title: string | null } | { title: string | null }[] | null;
  groups: { name: string | null } | { name: string | null }[] | null;
  session_exercises: { exercise_name: string; exercise_order: number | null; tracked_fields: string[] | null; set_logs: { set_order: number | null; weight: number | null; reps: number | null; time_seconds: number | null; distance: number | null; height: number | null; status: string | null }[] | null }[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadTrainingHistory(db: SupabaseClient, athleteId: string): Promise<{ sessions: HistorySession[]; failed: boolean; truncated: boolean }> {
  const { rows, failed, truncated } = await pageAll(
    (from, to) =>
      db
        .from("athlete_sessions")
        .select("id, started_at, completed_at, workouts ( title ), groups ( name ), session_exercises ( exercise_name, exercise_order, tracked_fields, set_logs ( set_order, weight, reps, time_seconds, distance, height, status ) )")
        .eq("athlete_id", athleteId)
        .eq("status", "completed")
        .order("id")
        .range(from, to),
    { pageSize: 200, maxPages: MAX_SESSIONS / 200 }
  );
  const sessions: HistorySession[] = (rows as SessionRow[]).map((r) => ({
    date: (r.completed_at ?? r.started_at ?? "").slice(0, 10),
    title: one(r.workouts)?.title?.trim() || "Workout",
    groupName: one(r.groups)?.name?.trim() || "",
    exercises: [...(r.session_exercises ?? [])]
      .sort((a, b) => (a.exercise_order ?? 0) - (b.exercise_order ?? 0))
      .map((e) => ({
        name: e.exercise_name,
        // only sets that were actually done (lib/set-complete.ts pastSetDone: an old "pending" set with its values counts)
        sets: [...(e.set_logs ?? [])]
          .filter((s) => pastSetDone(s, e))
          .sort((a, b) => (a.set_order ?? 0) - (b.set_order ?? 0))
          .map((s) => ({ weight: s.weight == null ? null : Number(s.weight), reps: s.reps })),
      })),
  }));
  return { sessions, failed, truncated };
}
