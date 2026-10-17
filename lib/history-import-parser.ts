// Pure row-shaping logic for the exercise-history CSV/Excel importer
// (coach_onboarding_history_ingestion_scoping_sept19.md). Deliberately a
// separate parser from lib/workout-import-parser.ts, per the task's own
// explicit warning: that parser's rows describe a PRESCRIBED program
// template (a text reps scheme like "8-10", no date), while this one
// describes ACTUALLY LOGGED history — a real calendar date, a real
// numeric rep count, one row per set actually performed.

import { SET_VALUE_LIMITS } from "@/lib/set-value-limits";
import { parseWeightCell, planUnits, unitFromText, weightInPounds, type UnitPlan, type WeightUnit } from "@/lib/weight-units";

export type HistoryColumn = "date" | "exercise" | "weight" | "reps" | "rpe";

const HEADER_ALIASES: Record<HistoryColumn, string[]> = {
  date: ["date", "workout date", "session date", "logged date"],
  exercise: ["exercise", "exercise name", "movement", "lift"],
  weight: ["weight", "load", "lbs", "kg"],
  reps: ["reps", "rep", "repetitions"],
  rpe: ["rpe", "rate of perceived exertion"],
};

export type HistoryColumnMapping = Partial<Record<HistoryColumn, number>>;

const HISTORY_COLUMNS: HistoryColumn[] = ["date", "exercise", "weight", "reps", "rpe"];

// Same exact-then-substring detection convention as
// workout-import-parser.ts's detectColumns — kept separate rather than
// shared since the two column sets and their aliases are genuinely
// different data shapes.
export function detectHistoryColumns(headerRow: string[]): HistoryColumnMapping {
  const mapping: HistoryColumnMapping = {};
  const normalizedHeaders = headerRow.map((h) => (h ?? "").toLowerCase().trim());

  for (const col of HISTORY_COLUMNS) {
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

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return (row[index] ?? "").toString().trim();
}

// Deliberately regex-based rather than `new Date(string)` — a bare
// "1/2/2026" is genuinely ambiguous to the Date constructor across
// locales/engines. Supports the three real shapes a coach's own export
// or hand-typed sheet is likely to use: ISO (2026-01-15), and US-style
// slash or dash (1/15/2026, 1-15-2026, and 2-digit years). Returns a
// normalized "YYYY-MM-DD" or null when nothing recognizable matched.
export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return normalizeDateParts(Number(y), Number(m), Number(d));
  }

  const usStyle = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (usStyle) {
    const [, m, d, yRaw] = usStyle;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return normalizeDateParts(y, Number(m), Number(d));
  }

  return null;
}

function normalizeDateParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export interface ParsedHistoryRow {
  date: string; // "YYYY-MM-DD"
  exerciseName: string;
  weight: number | null; // always pounds (a kilogram weight is converted here)
  // Set when this row cannot be an ordinary set: its weight names a different unit than the rest of the file, or a number is past what a real set can be (the database's own limits). It is imported flagged as an unclear data point, never silently converted or cut by a guess.
  unclearReason?: string;
  reps: number | null;
  rpe: number | null;
}

// Why a row of the file was not read. Every skipped row is listed with its row number in the file (the header is row 1), so the coach can fix the file and bring it in again.
export type HistorySkipReason = "no_exercise" | "bad_date" | "no_data" | "weight_not_number" | "reps_not_count" | "rpe_not_number" | "too_big" | "needs_coach";

export interface SkippedHistoryRow {
  rowNumber: number;
  reason: HistorySkipReason;
  detail: string; // plain words for the coach, naming the cell
}

export interface HistoryParseResult {
  rows: ParsedHistoryRow[];
  skippedCount: number;
  skipped: SkippedHistoryRow[];
  units: UnitPlan; // the unit the file was read in, and where that came from
}

// The unit the weight column's header names ("Weight (kg)"), or null when it names none.
export function headerUnitOf(header: string[], mapping: HistoryColumnMapping): WeightUnit | null {
  return mapping.weight == null ? null : unitFromText(header[mapping.weight] ?? "");
}

// The most each column can hold at all. A value between the database's limit for a real set and this is kept only as an unclear data point (a coach's write); a value past it is never written.
const REPS_COLUMN_MAX = 100000;
const WEIGHT_COLUMN_MAX_LB = 9999;
const RPE_COLUMN_MAX = 99.9;

const UNIT_WORDS = /(kgs?|kilograms?|kilos?|lbs?|pounds?)/gi;

// A weight cell that is a plain number, with a unit after it if at all ("225", "100 kg", "1,000"). A cell with no digits ("BW", "bodyweight") is no weight; one with digits that is not a plain number ("135-185", "60%", "BW+25") is not read.
function weightCellState(raw: string): "empty" | "none" | "plain" | "unreadable" {
  const t = raw.trim();
  if (!t) return "empty";
  if (!/\d/.test(t)) return "none";
  return /^\d+(?:,\d{3})*(?:[.,]\d+)?$/.test(t.replace(UNIT_WORDS, "").replace(/\s+/g, "")) ? "plain" : "unreadable";
}

// Reps are a count that was performed: "5", "5.0", "5 reps". A range ("8-12"), a list ("8/8/6") or words are never turned into a number (8-12 must not become 812).
function parseRepsCell(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(\d+)(?:\.0+)?\s*(?:reps?|x)?$/i.exec(t);
  return m ? { ok: true, value: parseInt(m[1], 10) } : { ok: false };
}

function parseRpeCell(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(?:rpe\s*|@\s*)?(\d+(?:[.,]\d+)?)$/i.exec(t);
  return m ? { ok: true, value: parseFloat(m[1].replace(",", ".")) } : { ok: false };
}

const fmt = (n: number) => n.toLocaleString("en-US");

// Rows that cannot be read are skipped, each with a reason and its row number, never dropped without a trace (a blank spacer row is not a problem and is not listed): no exercise name, no readable date,
// neither weight nor reps, a weight that is not a plain number ("135-185"), reps that are not a count ("8-12"), an RPE that is not a number, or a number no real set can be. A number past the database's limit is
// kept as an unclear data point when the person importing is a coach (canFlag), otherwise skipped.
export function parseHistoryRows(
  dataRows: string[][],
  mapping: HistoryColumnMapping,
  options: { headerUnit?: WeightUnit | null; chosenUnit?: WeightUnit; canFlag?: boolean; firstRowNumber?: number } = {}
): HistoryParseResult {
  const rows: ParsedHistoryRow[] = [];
  const skipped: SkippedHistoryRow[] = [];
  const canFlag = options.canFlag ?? true;
  const firstRowNumber = options.firstRowNumber ?? 2;
  // Which unit the file is in: its header, else the unit written in its cells, else the coach's choice (pounds unless they picked kilograms).
  const units = planUnits({
    headerUnit: options.headerUnit ?? null,
    cellUnits: dataRows.map((r) => parseWeightCell(cell(r, mapping.weight)).unit),
    chosen: options.chosenUnit ?? "lb",
  });

  dataRows.forEach((row, index) => {
    const rowNumber = firstRowNumber + index;
    if (row.every((c) => !(c ?? "").toString().trim())) return;
    const skip = (reason: HistorySkipReason, detail: string) => void skipped.push({ rowNumber, reason, detail });

    const exerciseName = cell(row, mapping.exercise);
    const dateRaw = cell(row, mapping.date);
    const date = parseFlexibleDate(dateRaw);
    if (!exerciseName) return skip("no_exercise", "No exercise name.");
    if (!date) return skip("bad_date", dateRaw ? `The date "${dateRaw}" could not be read (use 2026-01-15 or 1/15/2026).` : "No date.");

    const weightRaw = cell(row, mapping.weight);
    const weightState = weightCellState(weightRaw);
    if (weightState === "unreadable") return skip("weight_not_number", `The weight "${weightRaw}" is not a plain number (a range or a note is not a weight that was lifted).`);
    const converted = weightState === "plain" ? weightInPounds(parseWeightCell(weightRaw), units) : { pounds: null, unclearReason: null };
    const weight = converted.pounds != null && Number.isFinite(converted.pounds) ? converted.pounds : null;

    const repsRaw = cell(row, mapping.reps);
    const repsRead = parseRepsCell(repsRaw);
    if (!repsRead.ok) return skip("reps_not_count", `The reps "${repsRaw}" are not a single count (a range such as 8-12 is not a number of reps performed).`);
    const reps = repsRead.value;

    const rpeRaw = cell(row, mapping.rpe);
    const rpeRead = parseRpeCell(rpeRaw);
    if (!rpeRead.ok) return skip("rpe_not_number", `The RPE "${rpeRaw}" is not a number.`);
    const rpe = rpeRead.value != null && Number.isFinite(rpeRead.value) ? rpeRead.value : null;

    if (weight == null && reps == null) return skip("no_data", "No weight and no reps.");

    // Values no real set can be.
    const odd: string[] = [];
    if (weight != null && weight > SET_VALUE_LIMITS.weightLb) odd.push(`weight ${fmt(weight)} lb is over ${fmt(SET_VALUE_LIMITS.weightLb)} lb`);
    if (reps != null && reps > SET_VALUE_LIMITS.reps) odd.push(`${fmt(reps)} reps is over ${fmt(SET_VALUE_LIMITS.reps)}`);
    if (rpe != null && rpe > SET_VALUE_LIMITS.rpe) odd.push(`RPE ${rpe} is over ${SET_VALUE_LIMITS.rpe}`);
    if (odd.length > 0) {
      const pastColumn = (weight != null && weight > WEIGHT_COLUMN_MAX_LB) || (reps != null && reps > REPS_COLUMN_MAX) || (rpe != null && rpe > RPE_COLUMN_MAX);
      if (pastColumn) return skip("too_big", `${odd.join("; ")}: not a real set.`);
      if (!canFlag) return skip("needs_coach", `${odd.join("; ")}. Ask your coach to import this file; a coach can keep it as an unclear data point.`);
    }

    rows.push({
      date,
      exerciseName,
      weight,
      ...(odd.length > 0 ? { unclearReason: `Value past what a set can be (${odd.join("; ")})` } : converted.unclearReason ? { unclearReason: converted.unclearReason } : {}),
      reps,
      rpe,
    });
  });

  return { rows, skippedCount: skipped.length, skipped, units };
}
