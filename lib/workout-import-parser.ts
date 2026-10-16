// Pure row-shaping logic for the CSV/Excel workout importer. Takes plain
// string[][] (already extracted from a file by the caller — xlsx.js in the
// browser) so this stays testable without touching File/ArrayBuffer APIs.

import { normalizeTimedRow } from "@/lib/timed-exercise";
import { isNumericOnlyName, splitPrescriptionName } from "@/lib/exercise-name-guard";
import { poundsFrom } from "@/lib/weight-units";

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

// A header the way it is compared: lower case, underscores and hyphens read as spaces, runs of spaces as one ("Exercise_Name" is "exercise name").
export function normalizeHeader(header: string): string {
  return (header ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

const COUNTER_WORDS = ["no", "num", "number", "nr", "order", "index", "id", "position", "pos", "seq", "sequence"];

// A column that only numbers the rows ("Exercise #", "Exercise_#", "Exercise No", "Exercise Number", "Set #"): never the column that holds the names or the set count. A header that says "of" is
// a COUNT of something, not a row number ("Number of Sets", "No. of Sets", "# of Reps"), and "Set Count" or "Rep Count" are counts too: those are the columns we want.
export function isCounterHeader(header: string): boolean {
  const h = normalizeHeader(header);
  const tokens = h.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("of")) return false;
  if (h.includes("#")) return true;
  return tokens.some((token) => COUNTER_WORDS.includes(token));
}

// Best-effort auto-detection of which spreadsheet column is which. An exact header match wins ("Exercise_Name" and "exercise name" are the same). Otherwise a header that CONTAINS the alias
// ("Weight (lbs)" contains "weight"), but never a column that only counts the rows ("Exercise #"), and for the exercise column one that also says "name" is preferred.
export function detectColumns(headerRow: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headerRow.map((h) => normalizeHeader(h ?? ""));

  for (const col of IMPORT_COLUMNS) {
    const aliases = HEADER_ALIASES[col];
    let exactIndex = -1;
    const containing: number[] = [];
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      if (!h) continue;
      if (aliases.includes(h)) {
        exactIndex = i;
        break;
      }
      if (aliases.some((a) => h.includes(a)) && !isCounterHeader(headerRow[i] ?? "")) containing.push(i);
    }
    let found = exactIndex;
    if (found < 0 && containing.length > 0) {
      found = col === "exercise" ? containing.find((i) => normalizedHeaders[i].includes("name")) ?? containing[0] : containing[0];
    }
    if (found >= 0) mapping[col] = found;
  }

  return mapping;
}

export const EXERCISE_NUMBERS_MESSAGE = "The exercise column looks like numbers, not names. Pick the column with the exercise names.";

// Any exercise "name" that is only digits, commas, dots and spaces (1, 8,8,8, 20) means the wrong column was read. Stops a junk import before anything is written.
export function looksLikeNumbersNotNames(values: string[]): boolean {
  return values.some((v) => isNumericOnlyName((v ?? "").toString()));
}

// More than half of a column being plain numbers: a counter or a measurement, never the column to offer as the exercise names.
function mostlyNumbers(values: string[]): boolean {
  const filled = values.map((v) => (v ?? "").toString().trim()).filter(Boolean);
  if (filled.length === 0) return false;
  return filled.filter((v) => isNumericOnlyName(v)).length / filled.length > 0.5;
}

// The column most likely to hold the exercise names, for the picker to start on: not a counter, mostly text, and a header that says exercise, movement, lift or name scores highest.
export function bestExerciseColumn(headerRow: string[], body: string[][]): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < headerRow.length; i++) {
    if (isCounterHeader(headerRow[i] ?? "")) continue;
    const values = body.map((r) => (r[i] ?? "").toString().trim()).filter(Boolean);
    if (values.length === 0 || mostlyNumbers(values)) continue;
    const h = normalizeHeader(headerRow[i] ?? "");
    const textShare = values.filter((v) => /[a-z]/i.test(v)).length / values.length;
    const distinct = new Set(values.map((v) => v.toLowerCase())).size / values.length;
    const score = textShare * 2 + distinct + (/(exercise|movement|lift)/.test(h) ? 3 : 0) + (h.includes("name") ? 2 : 0);
    if (!best || score > best.score) best = { index: i, score };
  }
  return best ? best.index : null;
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
  // What the weight cell said when it was not a plain number ("135-185", "BW+25", "60%"): kept as a note instead of being turned into a wrong number.
  weightNote?: string | null;
  // The set count was more than the limit and was cut to it.
  setsCapped?: boolean;
}

export const MAX_IMPORT_SETS = 20;

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
  // A blank Week or Day cell (a merged cell in a spreadsheet) means "the same as the row above", not "back to Day 1".
  let lastWeek = "Week 1";
  let lastDay = "Day 1";

  for (const row of dataRows) {
    let exerciseName = cell(row, mapping.exercise);
    if (!exerciseName) continue;

    const week = cell(row, mapping.week) || lastWeek;
    const day = cell(row, mapping.day) || lastDay;
    lastWeek = week;
    lastDay = day;
    const setsRaw = cell(row, mapping.sets);
    const setsParsed = setsRaw ? parseInt(setsRaw, 10) || 1 : 1;
    let sets = Math.min(Math.max(setsParsed, 1), MAX_IMPORT_SETS);
    const setsCapped = setsParsed > MAX_IMPORT_SETS;
    const prescription = cell(row, mapping.prescription);

    // An exercise cell that carries its own prescription ("Bench 3x10 @7"): the name is the words before it, and the sets and reps fill in only what the row does not say itself.
    const split = splitPrescriptionName(exerciseName);
    if (split) {
      exerciseName = split.name;
      if (!setsRaw) sets = Math.min(split.sets, MAX_IMPORT_SETS);
    }

    // A dedicated Reps column wins; otherwise fall back to pulling a number
    // out of a combined "Reps: N x M" free-text column.
    let reps = cell(row, mapping.reps) || null;
    if (!reps && split?.reps) reps = split.reps;
    if (!reps && prescription) {
      // "Reps: 5 x 3" is 5 reps; "Reps: 3 sets" only says there are three sets and is not a rep target.
      const repsFromText = extractFromPrescription(prescription, /reps?:\s*(\d+(?:\.\d+)?)(?![\d.])(?!\s*sets?\b)/i);
      reps = repsFromText != null ? String(repsFromText) : null;
    }

    const timeSeconds = prescription
      ? extractFromPrescription(prescription, /time\s*\(sec\):\s*(\d+(?:\.\d+)?)(?![\d.])(?!\s*sets?\b)/i)
      : null;

    // Only a plain number, with lb or kg after it if at all, is a weight. "135-185", "BW+25" and "60%" are kept as a note and the weight is left blank.
    const weightText = cell(row, mapping.weight);
    const weightMatch = weightText.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs|kg)?$/i);
    const weight = weightMatch ? (weightMatch[2]?.toLowerCase() === "kg" ? poundsFrom(parseFloat(weightMatch[1]), "kg") : parseFloat(weightMatch[1])) : null;
    const weightNote = weightText && !weightMatch ? weightText : null;
    const rpeRaw = cell(row, mapping.rpe);
    const rpe = rpeRaw ? parseFloat(rpeRaw) : split?.rpe ?? null;
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
        timeSeconds: timeSeconds ?? split?.timeSeconds ?? null,
        ...(weightNote ? { weightNote } : {}),
        ...(setsCapped ? { setsCapped } : {}),
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

// What to tell the coach about cells that were not read as plain numbers or were cut to a limit; empty when everything was read as written.
export function importReadWarnings(rows: ParsedImportRow[]): string[] {
  const out: string[] = [];
  const unreadable = rows.filter((r) => r.weightNote);
  if (unreadable.length > 0) {
    out.push(`${unreadable.length} weight${unreadable.length === 1 ? "" : "s"} could not be read as a plain number (for example "${unreadable[0].weightNote}"). ${unreadable.length === 1 ? "It is" : "They are"} in the exercise notes and the weight is left blank.`);
  }
  const capped = rows.filter((r) => r.setsCapped);
  if (capped.length > 0) {
    out.push(`${capped.length} exercise${capped.length === 1 ? " had" : "s had"} more than ${MAX_IMPORT_SETS} sets; ${capped.length === 1 ? "it was" : "they were"} cut to ${MAX_IMPORT_SETS}. Check ${capped.length === 1 ? "it" : "them"}.`);
  }
  return out;
}

export interface ImportedExercise {
  exerciseName: string;
  sets: number;
  // The weight cell, when it was not a plain number; saved as the exercise's note.
  note?: string | null;
  setsCapped?: boolean;
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
      ...(row.weightNote ? { note: `Weight: ${row.weightNote}` } : {}),
      ...(row.setsCapped ? { setsCapped: true } : {}),
    });
  }

  // The week number is the number after "Week" or "Wk" ("Phase 1 Week 2" is week 2), else a label that is only a number; when that is missing or already used by an earlier week, the next free number in the order the weeks appear.
  const used = new Set<number>();
  const numbers = weekOrder.map((week) => {
    const named = week.match(/\b(?:week|wk)\.?\s*(\d+)/i) ?? week.match(/^\s*(\d+)\s*$/);
    let n = named ? parseInt(named[1], 10) : 0;
    if (n < 1 || used.has(n)) {
      n = 1;
      while (used.has(n)) n++;
    }
    used.add(n);
    return n;
  });

  return weekOrder.map((week, i) => {
    return {
      weekLabel: week,
      weekNumber: numbers[i],
      days: dayOrderByWeek.get(week)!.map((day) => ({
        dayLabel: day,
        exercises: exercisesByWeekDay.get(`${week} ${day}`)!,
      })),
    };
  });
}
