import { estimateOneRepMax } from "@/lib/one-rep-max";
import { countsForProgress } from "@/lib/set-types";

// Best at each rep count (wave 2, P2; Ron, Nov 20): for one lift, the heaviest weight the client has done for 1 rep, 2 reps, 3 reps ... It follows the app's one
// record rule (lib/record-set.ts): a set of 225 x 5 is also a 225 for 3, so the best at N reps is the heaviest set of N reps OR MORE. That keeps the table
// honest (it never claims a weight was done for more reps than it was) and always reads downhill. Each row says the set it came from (its own reps and date),
// so "225 for 3" can show it was really 225 x 5. Warm-ups and drop sets never count (lib/set-types.ts), nor a set with no weight or no reps.
// The estimated max on top: the best of the app's one estimate (lib/one-rep-max.ts: Epley with reps in reserve, only from sets of 8 reps or fewer) over the
// counted sets.

export interface RepSet {
  weight: number | null;
  reps: number | null;
  setType?: string | null;
  at: string; // ISO timestamp or date key
}

export interface RepMaxRow {
  reps: number; // the rep count of this row
  weight: number; // the best weight done for at least this many reps
  fromReps: number; // the reps of the set it came from (>= reps)
  at: string; // when that set was done (the first time that weight was reached at that many reps)
}

export interface RepMaxTable {
  rows: RepMaxRow[];
  estimatedMax: { value: number; weight: number; reps: number; at: string } | null;
}

export const REP_MAX_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function counted(sets: RepSet[]): { weight: number; reps: number; at: string }[] {
  return sets
    .filter((s) => countsForProgress(s.setType ?? "working"))
    .filter((s) => s.weight != null && s.reps != null && Number(s.weight) > 0 && Number(s.reps) >= 1 && Number.isFinite(Number(s.weight)))
    .map((s) => ({ weight: Number(s.weight), reps: Math.floor(Number(s.reps)), at: s.at }));
}

export function repMaxTable(sets: RepSet[], counts: readonly number[] = REP_MAX_COUNTS): RepMaxTable {
  const done = counted(sets);
  const rows: RepMaxRow[] = [];
  for (const n of counts) {
    let best: { weight: number; reps: number; at: string } | null = null;
    for (const s of done) {
      if (s.reps < n) continue;
      // heavier wins; at the same weight the earlier set is when it was first reached
      if (!best || s.weight > best.weight || (s.weight === best.weight && s.at < best.at)) best = s;
    }
    if (best) rows.push({ reps: n, weight: best.weight, fromReps: best.reps, at: best.at });
  }
  let estimatedMax: RepMaxTable["estimatedMax"] = null;
  for (const s of done) {
    const e = estimateOneRepMax(s.weight, s.reps);
    if (e == null) continue;
    if (!estimatedMax || e > estimatedMax.value || (e === estimatedMax.value && s.at < estimatedMax.at)) estimatedMax = { value: e, weight: s.weight, reps: s.reps, at: s.at };
  }
  return { rows, estimatedMax };
}

// The table for every lift at once, by lift name (case and spacing kept from the most recent set of that name).
export function repMaxTablesByLift(sets: (RepSet & { exerciseName: string })[], counts: readonly number[] = REP_MAX_COUNTS): Map<string, RepMaxTable> {
  const byKey = new Map<string, { name: string; latest: string; sets: RepSet[] }>();
  for (const s of sets) {
    const key = s.exerciseName.trim().toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key) ?? { name: s.exerciseName.trim(), latest: s.at, sets: [] };
    if (s.at > entry.latest) {
      entry.latest = s.at;
      entry.name = s.exerciseName.trim();
    }
    entry.sets.push(s);
    byKey.set(key, entry);
  }
  const out = new Map<string, RepMaxTable>();
  for (const { name, sets: liftSets } of byKey.values()) {
    const table = repMaxTable(liftSets, counts);
    if (table.rows.length > 0) out.set(name, table);
  }
  return out;
}
