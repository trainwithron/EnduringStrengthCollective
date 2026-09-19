// Pure row-shaping logic for the exercise-history CSV/Excel importer
// (coach_onboarding_history_ingestion_scoping_sept19.md). Deliberately a
// separate parser from lib/workout-import-parser.ts, per the task's own
// explicit warning: that parser's rows describe a PRESCRIBED program
// template (a text reps scheme like "8-10", no date), while this one
// describes ACTUALLY LOGGED history — a real calendar date, a real
// numeric rep count, one row per set actually performed.

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
  weight: number | null;
  reps: number | null;
  rpe: number | null;
}

export interface HistoryParseResult {
  rows: ParsedHistoryRow[];
  skippedCount: number;
}

// Rows missing an exercise name, a parseable date, or BOTH weight and
// reps are skipped (a row with no real training data isn't a set worth
// recording) — counted, never silently dropped without a trace, so the
// upload UI can tell the coach "N rows skipped."
export function parseHistoryRows(dataRows: string[][], mapping: HistoryColumnMapping): HistoryParseResult {
  const rows: ParsedHistoryRow[] = [];
  let skippedCount = 0;

  for (const row of dataRows) {
    const exerciseName = cell(row, mapping.exercise);
    const dateRaw = cell(row, mapping.date);
    const date = parseFlexibleDate(dateRaw);

    const weightRaw = cell(row, mapping.weight).replace(/[^0-9.]/g, "");
    const weight = weightRaw ? parseFloat(weightRaw) : null;
    const repsRaw = cell(row, mapping.reps).replace(/[^0-9.]/g, "");
    const reps = repsRaw ? parseInt(repsRaw, 10) : null;
    const rpeRaw = cell(row, mapping.rpe);
    const rpe = rpeRaw ? parseFloat(rpeRaw) : null;

    const hasRealData = (weight != null && Number.isFinite(weight)) || (reps != null && Number.isFinite(reps));

    if (!exerciseName || !date || !hasRealData) {
      skippedCount++;
      continue;
    }

    rows.push({
      date,
      exerciseName,
      weight: weight != null && Number.isFinite(weight) ? weight : null,
      reps: reps != null && Number.isFinite(reps) ? reps : null,
      rpe: rpe != null && Number.isFinite(rpe) ? rpe : null,
    });
  }

  return { rows, skippedCount };
}
