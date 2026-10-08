// Pure row-shaping logic for the CSV/Excel workout importer. Takes plain
// string[][] (already extracted from a file by the caller — xlsx.js in the
// browser) so this stays testable without touching File/ArrayBuffer APIs.

import { normalizeTimedRow } from "@/lib/timed-exercise";

export type ImportColumn =
  | "week"
  | "day"
  | "exercise"
  | "sets"
  | "reps"
  | "weight"
  | "rpe"
  | "rest"
  | "prescription";

export const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  week: ["week", "macrocycle week", "phase week"],
  day: ["day", "workout day", "session", "week day"],
  exercise: ["exercise", "exercise name", "movement", "lift", "exercises"],
  sets: ["sets", "set", "# sets", "num sets"],
  reps: ["reps", "rep", "repetitions", "target reps"],
  weight: ["weight", "load", "lbs", "kg", "target weight"],
  rpe: ["rpe", "rate of perceived exertion"],
  rest: ["rest", "rest time", "rest sec"],
  // A free-text column some platforms export instead of separate Reps/Time
  // columns — e.g. "Reps: 20 x 3" or "Reps: 1 x 3, Time (sec): 30 x 3".
  prescription: ["prescription", "scheme", "details"],
};

export type ColumnMapping = Partial<Record<ImportColumn, number>>;

export const IMPORT_COLUMNS: ImportColumn[] = [
  "week",
  "day",
  "exercise",
  "sets",
  "reps",
  "weight",
  "rpe",
  "rest",
  "prescription",
];

// Best-effort auto-detection of which spreadsheet column is which — exact
// header match wins, otherwise the first header containing the alias as a
// substring (e.g. "Weight (lbs)" contains "weight").
export function detectColumns(headerRow: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headerRow.map((h) => (h ?? "").toLowerCase().trim());

  for (const col of IMPORT_COLUMNS) {
    const aliases = HEADER_ALIASES[col];
    let exactIndex = -1;
    let containsIndex = -1;
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      if (!h) continue;
      if (aliases.includes(h)) {
        exactIndex = i;
        break;
      }
      if (containsIndex === -1 && aliases.some((a) => h.includes(a))) {
        containsIndex = i;
      }
    }
    const found = exactIndex >= 0 ? exactIndex : containsIndex;
    if (found >= 0) mapping[col] = found;
  }

  return mapping;
}

export interface ParsedImportRow {
  week: string;
  day: string;
  exerciseName: string;
  sets: number;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  rest: string | null;
  timeSeconds: number | null;
}

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return (row[index] ?? "").toString().trim();
}

function extractFromPrescription(text: string, label: RegExp): number | null {
  const match = text.match(label);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : null;
}

// Rows with no exercise name are skipped (blank spacer rows are common in
// real spreadsheet exports). A blank "Day" falls back to "Day 1" so a
// single-day export with no Day column still produces one importable day;
// likewise a blank "Week" falls back to "Week 1".
export function parseImportRows(dataRows: string[][], mapping: ColumnMapping): ParsedImportRow[] {
  const rows: ParsedImportRow[] = [];

  for (const row of dataRows) {
    const exerciseName = cell(row, mapping.exercise);
    if (!exerciseName) continue;

    const week = cell(row, mapping.week) || "Week 1";
    const day = cell(row, mapping.day) || "Day 1";
    const setsRaw = cell(row, mapping.sets);
    const sets = setsRaw ? parseInt(setsRaw, 10) || 1 : 1;
    const prescription = cell(row, mapping.prescription);

    // A dedicated Reps column wins; otherwise fall back to pulling a number
    // out of a combined "Reps: N x M" free-text column.
    let reps = cell(row, mapping.reps) || null;
    if (!reps && prescription) {
      const repsFromText = extractFromPrescription(prescription, /reps?:\s*(\d+(?:\.\d+)?)/i);
      reps = repsFromText != null ? String(repsFromText) : null;
    }

    const timeSeconds = prescription
      ? extractFromPrescription(prescription, /time\s*\(sec\):\s*(\d+(?:\.\d+)?)/i)
      : null;

    const weightRaw = cell(row, mapping.weight).replace(/[^0-9.]/g, "");
    const weight = weightRaw ? parseFloat(weightRaw) : null;
    const rpeRaw = cell(row, mapping.rpe);
    const rpe = rpeRaw ? parseFloat(rpeRaw) : null;
    const rest = cell(row, mapping.rest) || null;

    // A duration in the reps place ("60 sec") or a bare number on a plank or wall sit is a time, not reps.
    rows.push(
      normalizeTimedRow({
        week,
        day,
        exerciseName,
        sets,
        reps,
        weight: weight != null && Number.isFinite(weight) ? weight : null,
        rpe: rpe != null && Number.isFinite(rpe) ? rpe : null,
        rest,
        timeSeconds,
      })
    );
  }

  return rows;
}

// Self-healing pass for a real, recurring AI-extraction mistake: a
// uniform set scheme like "Lateral Jumps 3x8" sometimes comes back as
// three separate "Lateral Jumps 1x8" rows instead of one row with
// Sets=3 — the extraction prompt's "split into rows only if sets
// genuinely differ" rule (meant for a warm-up ramp: 135x5, 185x5,
// 225x3) gets misapplied to a plain uniform set count. Tightening the
// prompt (gemini-import-guide.tsx) helps but can't guarantee every
// model gets it right every time, so this merges the mistake back
// together after the fact, deterministically, regardless of which AI
// (or spreadsheet quirk) produced it.
//
// Only merges rows that are genuinely indistinguishable as "the same
// prescribed set, split apart": same week, same day, same exercise
// name, each individually already Sets=1, and every target value
// (reps/weight/rpe/rest/timeSeconds) identical. A real ramp set (each
// row a different weight/reps) never matches on the last condition and
// survives completely untouched. Only merges rows that are already
// adjacent in the parsed order — matches how both a spreadsheet export
// and an AI-extracted CSV actually list one exercise's sets, one after
// another, never interleaved with a different exercise's rows.
export function mergeIdenticalSetRows(rows: ParsedImportRow[]): ParsedImportRow[] {
  const merged: ParsedImportRow[] = [];
  // Parallel to `merged` — tracks whether merged[i] was built exclusively
  // out of Sets=1 rows (so it's still eligible to absorb more of them).
  // A row that arrived already showing Sets=3 was already correctly
  // extracted as one row and must never absorb a stray duplicate row
  // afterward — merged[i].sets alone can't distinguish "genuinely 3 from
  // the source" from "3 built by merging three 1s", so this tracks it
  // separately instead.
  const eligible: boolean[] = [];

  for (const row of rows) {
    const lastIndex = merged.length - 1;
    const prev = merged[lastIndex];
    const canMerge =
      prev &&
      eligible[lastIndex] &&
      row.sets === 1 &&
      prev.week === row.week &&
      prev.day === row.day &&
      prev.exerciseName === row.exerciseName &&
      prev.reps === row.reps &&
      prev.weight === row.weight &&
      prev.rpe === row.rpe &&
      prev.rest === row.rest &&
      prev.timeSeconds === row.timeSeconds;

    if (canMerge) {
      prev.sets += 1;
    } else {
      merged.push({ ...row });
      eligible.push(row.sets === 1);
    }
  }

  return merged;
}

// "90", "90s", "90 sec", "2 min", "1:30" -> seconds. Anything else (a range,
// a note like "as needed") is not guessed at; the prescription just has no
// rest target.
export function parseRestSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const clock = t.match(/^(\d+):(\d{2})$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? "s";
  return Math.round(unit.startsWith("m") ? n * 60 : n);
}

export interface ImportedExercise {
  exerciseName: string;
  sets: number;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  timeSeconds: number | null;
  restSeconds?: number | null;
}

export interface ImportedDay {
  dayLabel: string;
  exercises: ImportedExercise[];
}

export interface ImportedWeek {
  weekLabel: string;
  weekNumber: number;
  days: ImportedDay[];
}

// Groups flat parsed rows into weeks -> days, preserving first-seen order
// at both levels (matches the order the coach's spreadsheet actually
// listed them, not an alphabetical or numeric re-sort).
export function groupIntoWeeks(rows: ParsedImportRow[]): ImportedWeek[] {
  const weekOrder: string[] = [];
  const dayOrderByWeek = new Map<string, string[]>();
  const exercisesByWeekDay = new Map<string, ImportedExercise[]>();

  for (const row of rows) {
    if (!dayOrderByWeek.has(row.week)) {
      dayOrderByWeek.set(row.week, []);
      weekOrder.push(row.week);
    }
    const dayOrder = dayOrderByWeek.get(row.week)!;
    const key = `${row.week} ${row.day}`;
    if (!exercisesByWeekDay.has(key)) {
      exercisesByWeekDay.set(key, []);
      dayOrder.push(row.day);
    }
    exercisesByWeekDay.get(key)!.push({
      exerciseName: row.exerciseName,
      sets: row.sets,
      reps: row.reps,
      weight: row.weight,
      rpe: row.rpe,
      timeSeconds: row.timeSeconds,
      restSeconds: parseRestSeconds(row.rest),
    });
  }

  return weekOrder.map((week, i) => {
    const match = week.match(/(\d+)/);
    return {
      weekLabel: week,
      weekNumber: match ? parseInt(match[1], 10) : i + 1,
      days: dayOrderByWeek.get(week)!.map((day) => ({
        dayLabel: day,
        exercises: exercisesByWeekDay.get(`${week} ${day}`)!,
      })),
    };
  });
}
