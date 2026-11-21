import type { SupabaseClient } from "@supabase/supabase-js";
import { pickRecordSet, type WeightedSet } from "@/lib/record-set";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { countsForProgress } from "@/lib/set-types";
import { readLoggedSets } from "@/lib/read-logged-sets";
import type { PrSet } from "@/lib/pr-wording";

// The set behind each new record of a finished workout (wave 2, P3): for each lift the workout named a record on, the set that earned it, by the app's one record
// rule (lib/record-set.ts: no earlier set as heavy for as many reps; the strongest such set by estimated max). The same reads and rule the share card uses
// (lib/shared-workout.ts), so a notice and the card never name different sets. Warm-ups and drop sets never count. A lift whose sets cannot be read, or that has
// no weighted set (a run, a hold), is still named, without a weight. Strongest first.

export async function loadPrSets(supabase: SupabaseClient, input: { athleteId: string; sessionId: string; names: string[] }): Promise<PrSet[]> {
  const names = [...new Set(input.names.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return [];
  const bare: PrSet[] = names.map((name) => ({ name, weight: null, reps: null }));
  try {
    const columns = "weight, reps, set_type, status, session_exercises!inner ( session_id, exercise_name, athlete_sessions!inner ( athlete_id ) )";
    const [{ data: sessionRows }, { data: priorRows }] = await Promise.all([
      readLoggedSets(supabase, columns, (q) => q.eq("session_exercises.session_id", input.sessionId).in("session_exercises.exercise_name", names).eq("status", "completed")),
      readLoggedSets(supabase, columns, (q) =>
        q
          .in("session_exercises.exercise_name", names)
          .eq("session_exercises.athlete_sessions.athlete_id", input.athleteId)
          .neq("session_exercises.session_id", input.sessionId)
          .eq("status", "completed")
      ),
    ]);
    if (sessionRows == null) return bare;
    const group = (rows: any[] | null) => {
      const by = new Map<string, WeightedSet[]>();
      for (const row of rows ?? []) {
        if (!countsForProgress(row.set_type) || row.weight == null || Number(row.weight) <= 0) continue;
        const se = Array.isArray(row.session_exercises) ? row.session_exercises[0] : row.session_exercises;
        const name = String(se?.exercise_name ?? "").trim();
        const list = by.get(name) ?? [];
        list.push({ weight: Number(row.weight), reps: Number(row.reps ?? 0) });
        by.set(name, list);
      }
      return by;
    };
    const mine = group(sessionRows);
    const prior = group(priorRows);
    const found = names.map((name) => {
      const earned = pickRecordSet(mine.get(name) ?? [], prior.get(name) ?? []);
      return earned ? { name, weight: earned.weight, reps: earned.reps } : { name, weight: null, reps: null };
    });
    const score = (p: PrSet) => (p.weight != null && p.reps != null ? estimateOneRepMax(p.weight, p.reps) ?? p.weight : -1);
    return found.sort((a, b) => score(b) - score(a));
  } catch {
    return bare;
  }
}
