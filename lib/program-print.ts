import type { ExerciseSetTarget } from "@/lib/types";

// The printable program (Ron: a coach must never be stuck in our software). One line per exercise, the way the builder's collapsed view reads: the name, then what is prescribed
// ("3 x 10 @ 135 lb, RPE 7"), with blank write-in boxes beside it for what was actually done. No videos.

const clean = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const distinct = <T,>(values: (T | null | undefined)[]): T[] => Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined && (typeof v !== "string" || v.trim() !== ""))));

// "3 x 10 @ 135 lb, RPE 7": sets x reps (or seconds, or distance), then the load, effort, tempo, rest and pace when the coach set them. Sets that differ are written out
// ("10/8/6", "135/145/155 lb") rather than hidden. Nothing prescribed reads as just the number of sets.
export function describePrescription(sets: ExerciseSetTarget[]): string {
  if (sets.length === 0) return "";
  const ordered = sets.slice().sort((a, b) => a.setOrder - b.setOrder);
  const n = ordered.length;
  const slash = (items: string[]) => items.join("/");

  const reps = ordered.map((s) => (s.targetReps ?? "").trim());
  const seconds = ordered.map((s) => s.targetTimeSeconds);
  const distance = ordered.map((s) => s.targetDistance);
  let main: string;
  const repSet = distinct(reps);
  if (repSet.length === 1 && reps.every((r) => r)) main = `${n} x ${repSet[0]}`;
  else if (repSet.length > 1) main = `${n} sets: ${slash(reps.map((r) => r || "-"))}`;
  else if (seconds.some((s) => s)) main = distinct(seconds).length === 1 ? `${n} x ${seconds[0]}s` : `${n} sets: ${slash(seconds.map((s) => (s ? `${s}s` : "-")))}`;
  else if (distance.some((d) => d)) main = distinct(distance).length === 1 ? `${n} x ${clean(distance[0] as number)}` : `${n} sets: ${slash(distance.map((d) => (d ? clean(d) : "-")))}`;
  else main = `${n} ${n === 1 ? "set" : "sets"}`;

  const parts = [main];
  const weights = ordered.map((s) => s.targetWeight);
  if (weights.some((w) => w)) {
    const w = distinct(weights);
    parts[0] += w.length === 1 ? ` @ ${clean(w[0] as number)} lb` : ` @ ${slash(weights.map((x) => (x ? clean(x) : "-")))} lb`;
  }
  const rpe = distinct(ordered.map((s) => s.targetRpe));
  if (rpe.length > 0) parts.push(`RPE ${slash(rpe.map(clean))}`);
  const rir = distinct(ordered.map((s) => s.targetRir));
  if (rir.length > 0) parts.push(`RIR ${slash(rir.map(clean))}`);
  const tempo = distinct(ordered.map((s) => s.targetTempo));
  if (tempo.length > 0) parts.push(`tempo ${slash(tempo)}`);
  const rest = distinct(ordered.map((s) => s.targetRestSeconds));
  if (rest.length > 0) parts.push(`rest ${slash(rest.map((r) => `${clean(r)}s`))}`);
  const pace = distinct(ordered.map((s) => s.targetPace));
  if (pace.length > 0) parts.push(`pace ${slash(pace)}`);
  return parts.join(", ");
}

export interface PrintDay {
  id: string;
  title: string;
  weekNumber: number;
  dayIndex: number;
  exercises: { name: string; prescription: string }[];
}

// The days a non-coach may print: not locked, and with exercises (a locked day comes back from the database with none).
export function releasedDayIds(days: PrintDay[], isDayLocked: (id: string) => boolean): Set<string> {
  return new Set(days.filter((d) => !isDayLocked(d.id) && d.exercises.length > 0).map((d) => d.id));
}

// Weeks in order, each with its days in order. A viewer who is not the coach and not the owner of the copy only gets the days already released: the caller passes the ids to keep.
export function groupPrintWeeks(days: PrintDay[], keepIds?: Set<string>): { weekNumber: number; days: PrintDay[] }[] {
  const weeks = new Map<number, PrintDay[]>();
  for (const d of days) {
    if (keepIds && !keepIds.has(d.id)) continue;
    const list = weeks.get(d.weekNumber) ?? [];
    list.push(d);
    weeks.set(d.weekNumber, list);
  }
  return Array.from(weeks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, list]) => ({ weekNumber, days: list.sort((a, b) => a.dayIndex - b.dayIndex) }));
}
