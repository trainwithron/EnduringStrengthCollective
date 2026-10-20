// The Session Pattern Spotter's findings, built from one client's recent finished sessions (oldest first), with the evidence behind each one. Pure (the database read is in
// lib/session-pattern-spotter-gather.ts), so the counting is tested. A set counts as done by the logger's own rule (lib/set-complete.ts pastSetDone), never by its status alone: sets
// logged under the old checkbox rule kept their weight and reps but stayed "pending", and were read as skipped (a coach was told a first exercise averaged 46% of its sets when every
// set was there, Oct 20).
import { detectRpeCreep, detectRestTimeCreep, detectStrugglePoint, detectWeekdayRushing } from "./session-pattern-spotter";
import { pastSetDone } from "./set-complete";
import { nowInZone } from "./timezone";

export interface PatternSet {
  set_order: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  time_seconds?: number | null;
  distance?: number | null;
  rest_seconds?: number | null;
  status?: string | null;
  [column: string]: unknown;
}
export interface PatternExercise {
  exercise_order: number;
  exercise_name: string;
  tracked_fields?: string[] | null;
  group_workout_exercise_id: string | null;
  set_logs: PatternSet[] | null;
}
export interface PatternSession {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  session_exercises: PatternExercise[] | null;
}

// One logged set as the evidence shows it: done or not, and what was logged.
export interface EvidenceSet {
  done: boolean;
  weight: number | null;
  reps: number | null;
  timeSeconds: number | null;
  distance: number | null;
}

export type FindingEvidence =
  // struggle point: the flagged slot in each recent session, its exercise, how many sets were done, and the sets themselves
  // `slotLabel`: where the slot is in the workout, in words ("the first exercise").
  | { kind: "slot_sets"; slotLabel: string; rows: { startedAt: string; exerciseName: string; done: number; total: number; sets: EvidenceSet[] }[] }
  // RPE creep: each session's average RPE
  | { kind: "session_rpe"; rows: { startedAt: string; avgRpe: number }[] }
  // rest creep: each exercise's real rest against the programmed rest
  | { kind: "rest"; rows: { exerciseName: string; actualSeconds: number; targetSeconds: number; sets: number }[] }
  // weekday rushing: that weekday's sessions and how long each took, against the overall average
  | { kind: "durations"; weekday: string; overallMinutes: number; rows: { startedAt: string; minutes: number }[] };

export interface SessionPatternFinding {
  kind: "rpe_creep" | "rest_time_creep" | "struggle_point" | "weekday_rushing";
  description: string;
  numericValues: number[];
  evidence?: FindingEvidence;
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function evidenceSet(set: PatternSet, ex: PatternExercise): EvidenceSet {
  return { done: pastSetDone(set, ex), weight: num(set.weight), reps: num(set.reps), timeSeconds: num(set.time_seconds), distance: num(set.distance) };
}

// `timeZone`: the coach's, so an evening session is on its own weekday (the server runs in UTC, where 6 PM in Las Vegas is already the next day).
export function buildSessionPatternFindings(sessions: PatternSession[], targetRestByKey: Map<string, number>, timeZone: string = "UTC"): SessionPatternFinding[] {
  const findings: SessionPatternFinding[] = [];
  const weekdayOf = (iso: string) => nowInZone(timeZone, new Date(iso)).getUTCDay();

  // --- Signal 1: RPE creep ---
  const rpeRows: { startedAt: string; avgRpe: number }[] = [];
  for (const s of sessions) {
    const rpes: number[] = [];
    for (const ex of s.session_exercises ?? []) for (const set of ex.set_logs ?? []) if (typeof set.rpe === "number") rpes.push(set.rpe);
    if (rpes.length > 0) rpeRows.push({ startedAt: s.started_at, avgRpe: rpes.reduce((a, b) => a + b, 0) / rpes.length });
  }
  const rpeCreep = detectRpeCreep(rpeRows.map((r) => r.avgRpe));
  if (rpeCreep) {
    const recent = round1(rpeCreep.recentAvgRpe);
    const baseline = round1(rpeCreep.baselineAvgRpe);
    findings.push({
      kind: "rpe_creep",
      description: `Average logged RPE has dropped from ${baseline} to ${recent} over their last few sessions.`,
      numericValues: [recent, baseline],
      // the six sessions the comparison is made over, newest first
      evidence: { kind: "session_rpe", rows: rpeRows.slice(-6).reverse().map((r) => ({ startedAt: r.startedAt, avgRpe: round1(r.avgRpe) })) },
    });
  }

  // --- Signal 2: rest-time creep ---
  const restSamples: { targetRestSeconds: number; actualRestSeconds: number; exerciseName: string }[] = [];
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      if (!ex.group_workout_exercise_id) continue;
      for (const set of ex.set_logs ?? []) {
        if (typeof set.rest_seconds !== "number") continue;
        const target = targetRestByKey.get(`${ex.group_workout_exercise_id}:${set.set_order}`);
        if (typeof target === "number" && target > 0) restSamples.push({ targetRestSeconds: target, actualRestSeconds: set.rest_seconds, exerciseName: ex.exercise_name });
      }
    }
  }
  const restCreep = detectRestTimeCreep(restSamples);
  if (restCreep) {
    const avgActual = Math.round(restCreep.avgActualSeconds);
    const avgTarget = Math.round(restCreep.avgTargetSeconds);
    const byExercise = new Map<string, { actual: number; target: number; n: number }>();
    for (const r of restSamples) {
      const e = byExercise.get(r.exerciseName) ?? { actual: 0, target: 0, n: 0 };
      e.actual += r.actualRestSeconds;
      e.target += r.targetRestSeconds;
      e.n += 1;
      byExercise.set(r.exerciseName, e);
    }
    findings.push({
      kind: "rest_time_creep",
      description: `Real rest between sets is averaging ${avgActual}s against a prescribed ${avgTarget}s (${restCreep.direction === "over" ? "consistently longer" : "consistently shorter"} than programmed).`,
      numericValues: [avgActual, avgTarget],
      evidence: {
        kind: "rest",
        rows: Array.from(byExercise.entries())
          .map(([exerciseName, e]) => ({ exerciseName, actualSeconds: Math.round(e.actual / e.n), targetSeconds: Math.round(e.target / e.n), sets: e.n }))
          .sort((a, b) => b.sets - a.sets),
      },
    });
  }

  // --- Signal 3: struggle point ---
  const slotSamples: { slotIndex: number; setsCompleted: number; setsPrescribed: number }[] = [];
  for (const s of sessions) {
    for (const ex of s.session_exercises ?? []) {
      const sets = ex.set_logs ?? [];
      if (sets.length === 0) continue;
      slotSamples.push({ slotIndex: ex.exercise_order, setsCompleted: sets.filter((set) => pastSetDone(set, ex)).length, setsPrescribed: sets.length });
    }
  }
  const struggle = detectStrugglePoint(slotSamples);
  if (struggle) {
    const pct = Math.round(struggle.avgCompletionPct);
    const rows = sessions
      .slice()
      .reverse()
      .map((s) => ({ s, ex: (s.session_exercises ?? []).find((e) => e.exercise_order === struggle.slotIndex && (e.set_logs ?? []).length > 0) }))
      .filter((x): x is { s: PatternSession; ex: PatternExercise } => !!x.ex)
      .map(({ s, ex }) => {
        const sets = [...(ex.set_logs ?? [])].sort((a, b) => a.set_order - b.set_order).map((set) => evidenceSet(set, ex));
        return { startedAt: s.started_at, exerciseName: ex.exercise_name, done: sets.filter((x) => x.done).length, total: sets.length, sets };
      });
    const names = Array.from(new Set(rows.map((r) => r.exerciseName)));
    // The slot's place among the slots these sessions have (exercise_order may start at 0 or 1).
    const orders = Array.from(new Set(slotSamples.map((x) => x.slotIndex))).sort((a, b) => a - b);
    const rank = orders.indexOf(struggle.slotIndex);
    const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
    const slotLabel = rank >= 0 && rank < ORDINALS.length ? `the ${ORDINALS[rank]} exercise` : `exercise #${struggle.slotIndex}`;
    const which = names.length === 1 ? names[0] : `${names.length} different exercises`;
    findings.push({
      kind: "struggle_point",
      description: `Exercise slot #${struggle.slotIndex} (${which}) is only getting ${pct}% of its prescribed sets completed on average.`,
      numericValues: [pct, struggle.slotIndex, ...(names.length === 1 ? [] : [names.length])],
      evidence: { kind: "slot_sets", slotLabel, rows },
    });
  }

  // --- Signal 4: weekday rushing ---
  const timed = sessions.filter((s) => typeof s.duration_seconds === "number" && s.duration_seconds > 0);
  const rushing = detectWeekdayRushing(timed.map((s) => ({ weekday: weekdayOf(s.started_at), durationSeconds: s.duration_seconds as number })));
  if (rushing) {
    const avgMin = Math.round(rushing.avgDurationSeconds / 60);
    const overallMin = Math.round(rushing.overallAvgDurationSeconds / 60);
    findings.push({
      kind: "weekday_rushing",
      description: `${WEEKDAY_LABELS[rushing.weekday]} sessions average ${avgMin} min, real sessions overall average ${overallMin} min.`,
      numericValues: [avgMin, overallMin],
      evidence: {
        kind: "durations",
        weekday: WEEKDAY_LABELS[rushing.weekday],
        overallMinutes: overallMin,
        rows: timed
          .filter((s) => weekdayOf(s.started_at) === rushing.weekday)
          .reverse()
          .map((s) => ({ startedAt: s.started_at, minutes: Math.round((s.duration_seconds as number) / 60) })),
      },
    });
  }

  return findings;
}

// One set as a coach reads it: "135 x 8", "8 reps", "30s", "not logged" for a set with nothing done. Weights are stored in pounds; `toUnit` shows them in the client's unit.
export function evidenceSetText(set: EvidenceSet, toUnit: (lbs: number) => string = (lbs) => String(lbs)): string {
  if (!set.done) return "not logged";
  if (set.weight != null && set.reps != null) return `${toUnit(set.weight)} x ${set.reps}`;
  if (set.reps != null) return `${set.reps} reps`;
  if (set.timeSeconds != null) return `${set.timeSeconds}s`;
  if (set.distance != null) return `${set.distance}`;
  if (set.weight != null) return toUnit(set.weight);
  return "done";
}

// A session's sets in one line: "135 x 8, 135 x 8, not logged", or just "not logged" when nothing was logged at all.
export function evidenceRowText(sets: EvidenceSet[], toUnit?: (lbs: number) => string): string {
  if (sets.length > 0 && sets.every((s) => !s.done)) return "not logged";
  return sets.map((s) => evidenceSetText(s, toUnit)).join(", ");
}

// "Sep 16": the day of a session, in the coach's time zone.
export function shortDay(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

// oldest first, the way a coach reads back through the weeks
const listDays = (rows: { startedAt: string; exerciseName: string }[], timeZone: string) => [...rows].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((r) => `${shortDay(r.startedAt, timeZone)} ${r.exerciseName}`).join(", ");

// One plain sentence for a finding, from what actually happened (the struggle point says which sessions and exercises; the others keep their own sentence).
export function findingSentence(f: SessionPatternFinding, timeZone: string): string {
  if (f.kind !== "struggle_point" || f.evidence?.kind !== "slot_sets") return f.description;
  const { rows, slotLabel } = f.evidence;
  const none = rows.filter((r) => r.done === 0);
  const short = rows.filter((r) => r.done > 0 && r.done < r.total);
  const parts: string[] = [];
  if (none.length > 0) parts.push(`${slotLabel} wasn't logged in ${none.length} of the last ${rows.length} sessions (${listDays(none, timeZone)})`);
  if (short.length > 0) parts.push(`${none.length > 0 ? "and it" : slotLabel} was cut short in ${short.length}${none.length > 0 ? "" : ` of the last ${rows.length} sessions`} (${listDays(short, timeZone)})`);
  if (parts.length === 0) return f.description;
  return `Worth a look: ${parts.join(" ")}.`;
}

// The note at the top of the finding screen. The note as written stands only while the findings are the same ones with the same numbers; otherwise it is built from what is
// found now, so it never contradicts the evidence under it.
export function patternSummary(
  findings: SessionPatternFinding[],
  stored: { kind: string; numericValues?: number[] }[],
  storedText: string | null,
  timeZone: string
): string {
  if (findings.length === 0) return "Looked at again with every logged set counted, nothing stands out in these sessions now.";
  const same =
    !!storedText &&
    findings.length === stored.length &&
    findings.every((f) => {
      const s = stored.find((x) => x.kind === f.kind);
      return !!s && JSON.stringify(s.numericValues ?? []) === JSON.stringify(f.numericValues);
    });
  if (same) return storedText!;
  return findings.map((f) => findingSentence(f, timeZone)).join(" ");
}

// A short heading for one finding's rows, used when there are several (with one, the note above already says it).
export function findingLabel(f: SessionPatternFinding): string {
  switch (f.kind) {
    case "struggle_point":
      return `Sets missing in ${f.evidence?.kind === "slot_sets" ? f.evidence.slotLabel : "one exercise"}`;
    case "rpe_creep":
      return "Effort (RPE) dropping";
    case "rest_time_creep":
      return f.description.includes("longer") ? "Resting longer than planned" : "Resting shorter than planned";
    case "weekday_rushing":
      return f.evidence?.kind === "durations" ? `${f.evidence.weekday} sessions running short` : "One weekday running short";
  }
}
