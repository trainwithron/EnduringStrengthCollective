// The team sheet's cell reader: turns what an athlete wrote in one box ("225 235 245", "225x5 235x3", "BW", "-") into sets. Plain code, no AI, free. Anything it is not sure of comes back as "unsure" and is
// left blank and highlighted on the review screen: it never guesses a number (docs/team-sheet-design.html).
//
//   empty                     nothing written: no set is saved
//   skipped                   -, X, DNS, skip, n/a, out: left out on purpose; saved as skipped, never as zero
//   225 235 245               three sets at those weights, at the reps the sheet prescribes
//   225x5 235x3               set 1: 225 for 5, set 2: 235 for 3
//   225x5x3                   225 for 5 reps, 3 sets
//   185 (one number)          all the prescribed sets at 185
//   BW  /  BW 10 10 8         body weight; the numbers after it are the reps of each set; alone: the prescribed sets and reps
//   2?5, a smudge, a word     unsure
// Decimals use a point (132.5). A comma, a slash, a semicolon or a space separates sets. "lb" or "kg" after a number must match the sheet's unit, or the cell is unsure (it is never converted behind anyone's back).
export type SheetUnit = "lb" | "kg";

export interface Prescription {
  sets?: number | null;
  reps?: number | null;
}

export interface ParsedSet {
  /** null = body weight */
  weight: number | null;
  /** null when the sheet gave no reps and the athlete wrote none */
  reps: number | null;
  /** the reps come from the sheet's prescription, not from what was written */
  repsAssumed: boolean;
}

export type ParsedCell =
  | { kind: "empty" }
  | { kind: "skipped" }
  | { kind: "sets"; sets: ParsedSet[] }
  | { kind: "unsure"; raw: string; reason: string };

export const MAX_WEIGHT = 2000;
export const MAX_REPS = 100;
export const MAX_SETS = 20;

const SKIP_WORDS = new Set(["-", "--", "---", "x", "dns", "skip", "skipped", "na", "n/a", "out", "none", "nil"]);

const unsure = (raw: string, reason: string): ParsedCell => ({ kind: "unsure", raw, reason });

// One cell, as it might arrive from a spreadsheet (a number cell can already be a JavaScript number).
export function parseCell(input: unknown, opts: { unit?: SheetUnit; prescribed?: Prescription } = {}): ParsedCell {
  if (input === null || input === undefined) return { kind: "empty" };
  const raw = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : String(input);
  // a spreadsheet's non-breaking space, tabs and line breaks are just spaces; unicode multiplication signs are an x
  let text = raw.replace(/[   ]/g, " ").replace(/[×✕✖*]/g, "x").trim().toLowerCase();
  if (text === "") return { kind: "empty" };
  if (SKIP_WORDS.has(text) || /^[–—−]+$/.test(text)) return { kind: "skipped" };

  const unit: SheetUnit = opts.unit ?? "lb";
  const otherUnit: SheetUnit = unit === "lb" ? "kg" : "lb";
  // "225 lb" and "225lb": the unit of the sheet is dropped, the other unit makes the cell unsure
  if (new RegExp(`\\b${otherUnit}s?\\b|\\d${otherUnit}s?\\b`).test(text)) return unsure(raw.trim(), `written in ${otherUnit}, the sheet is in ${unit}`);
  text = text.replace(new RegExp(`(\\d)\\s*${unit}s?\\b`, "g"), "$1").replace(new RegExp(`\\b${unit}s?\\b`, "g"), " ");
  // "225 x 5" is "225x5"
  text = text.replace(/\s*x\s*/g, "x");
  text = text.replace(/[,;/|]+/g, " ").replace(/\s+/g, " ").trim();
  if (text === "") return unsure(raw.trim(), "nothing readable");

  const prescribedSets = clampInt(opts.prescribed?.sets, 1, MAX_SETS);
  const prescribedReps = clampInt(opts.prescribed?.reps, 1, MAX_REPS);
  const tokens = text.split(" ");

  // body weight: "bw", or "bw" followed by the reps of each set
  if (tokens[0] === "bw" || tokens[0] === "bodyweight") {
    const rest = tokens.slice(1);
    // body weight with no reps written and none prescribed (a range like 8-10) would save nothing: say so instead of showing it as read
    if (rest.length === 0) return prescribedReps === null ? unsure(raw.trim(), "body weight, but no number of reps was written or prescribed") : { kind: "sets", sets: repeat({ weight: null, reps: prescribedReps, repsAssumed: true }, prescribedSets ?? 1) };
    const sets: ParsedSet[] = [];
    for (const t of rest) {
      const reps = asReps(t);
      if (reps === null) return unsure(raw.trim(), `"${t}" is not a number of reps`);
      sets.push({ weight: null, reps, repsAssumed: false });
    }
    if (sets.length > MAX_SETS) return unsure(raw.trim(), "too many sets");
    return { kind: "sets", sets };
  }

  const sets: ParsedSet[] = [];
  for (const t of tokens) {
    const m = /^(\d+(?:\.\d+)?)(?:x(\d+)(?:x(\d+))?)?$/.exec(t);
    if (!m) return unsure(raw.trim(), `"${t}" could not be read`);
    const weight = Number(m[1]);
    if (!(weight >= 1) || weight > MAX_WEIGHT) return unsure(raw.trim(), `${m[1]} is not a believable weight`);
    if (m[2] === undefined) {
      sets.push({ weight, reps: prescribedReps, repsAssumed: true });
      continue;
    }
    const reps = asReps(m[2]);
    if (reps === null) return unsure(raw.trim(), `${m[2]} is not a believable number of reps`);
    let count = 1;
    if (m[3] !== undefined) {
      count = Number(m[3]);
      if (!(count >= 1) || count > MAX_SETS) return unsure(raw.trim(), `${m[3]} is not a believable number of sets`);
    }
    for (let i = 0; i < count; i++) sets.push({ weight, reps, repsAssumed: false });
  }
  if (sets.length > MAX_SETS) return unsure(raw.trim(), "too many sets");
  // one bare number on its own means every prescribed set at that weight
  if (tokens.length === 1 && /^\d+(?:\.\d+)?$/.test(tokens[0]) && prescribedSets && prescribedSets > 1) {
    return { kind: "sets", sets: repeat(sets[0], prescribedSets) };
  }
  return { kind: "sets", sets };
}

function asReps(token: string): number | null {
  if (!/^\d+$/.test(token)) return null;
  const n = Number(token);
  return n >= 1 && n <= MAX_REPS ? n : null;
}

function clampInt(n: number | null | undefined, min: number, max: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v >= min && v <= max ? v : null;
}

function repeat(set: ParsedSet, times: number): ParsedSet[] {
  return Array.from({ length: times }, () => ({ ...set }));
}

/** A short plain description of what was read, for the review screen: "225 x 5, 235 x 5 (reps from the sheet)". */
export function describeCell(cell: ParsedCell, unit: SheetUnit = "lb"): string {
  if (cell.kind === "empty") return "";
  if (cell.kind === "skipped") return "skipped";
  if (cell.kind === "unsure") return `not sure: ${cell.raw}`;
  const parts = cell.sets.map((s) => `${s.weight === null ? "BW" : `${s.weight} ${unit}`}${s.reps === null ? "" : ` x ${s.reps}`}`);
  const assumed = cell.sets.some((s) => s.repsAssumed && s.reps !== null);
  return parts.join(", ") + (assumed ? " (reps from the sheet)" : "");
}

export type BoxKind = "load" | "reps" | "unread";
export type BoxResult = ParsedCell | { kind: "unread" };

/**
 * One box on a sheet, read by what its exercise records. Weight exercises are read as weights ("225 235 245"); a reps-only exercise (a pull-up) is read as reps ("10 10 8", which is body weight with those reps); an
 * exercise with neither (a plank's time) is not read: what is written there is kept as a note. The same function reads the box on the review screen and again on the server.
 */
export function readBox(kind: BoxKind, text: string, opts: { unit: SheetUnit; sets: number; reps: number | null }): BoxResult {
  if (kind === "unread") return { kind: "unread" };
  const prescribed = { sets: opts.sets, reps: opts.reps };
  const t = text.trim();
  if (kind === "reps" && t !== "" && /^[\d\s,;/]+$/.test(t)) return parseCell("BW " + t, { unit: opts.unit, prescribed });
  return parseCell(t, { unit: opts.unit, prescribed });
}
