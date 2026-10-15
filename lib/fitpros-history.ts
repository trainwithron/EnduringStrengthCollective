// Reads a FitPros workout-history export (the plain-text format described in its header) and plans how it lands in a client's program: which program day each workout is, which week,
// and which exercise line each one is. Pure (no database), so every rule here is tested. Nothing is written until the coach has seen this plan and approved it.
//
// Rules from the coach: the client's star rating and the workout-level note are dropped; per-exercise notes are kept; a duration over 4 hours is a timer left running and is dropped;
// a stray extra weight (more weights than reps) is dropped; truncated or odd values are listed, not guessed at; a workout that matches no program day is imported as plain history.

import { findLibraryVariant, type AliasEntry } from "@/lib/exercise-matching";
import { mergeAliases, resolveTypedAlias } from "@/lib/exercise-alias-seed";
import { parseWeightCell, planUnits, weightInPounds, type WeightUnit } from "@/lib/weight-units";

export const MAX_DURATION_SECONDS = 4 * 3600;
export const MIN_DAY_MATCH = 0.5;

export interface FitprosSet {
  reps: number | null;
  weight: number | null; // pounds once parseFitprosExport has finished (a kilogram weight is converted there)
  // Set when this weight names a different unit than the rest of the file: imported flagged as an unclear data point, never converted by a guess.
  unclearReason?: string;
  // Only while parsing: the unit written after this weight ("205lb", "100kg"), if any.
  weightUnit?: WeightUnit | null;
  timeSeconds: number | null;
  height: number | null;
  distance: number | null;
}

export interface FitprosExercise {
  name: string;
  sets: FitprosSet[];
  note: string | null;
}

export interface FitprosWorkout {
  date: string; // YYYY-MM-DD
  title: string;
  durationSeconds: number | null;
  exercises: FitprosExercise[];
  flags: string[];
}

// "1h 7m" / "57m 44s" / "4m 51s" -> seconds. Blank or unreadable -> null.
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+)\s*(h|m|s)/g)) {
    found = true;
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
  }
  return found ? total : null;
}

function numberOrNull(token: string): number | null {
  const t = token.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function splitList(cell: string): string[] {
  return cell.trim() === "" ? [] : cell.split(",").map((x) => x.trim());
}

// "30sec" / "2min" / "120" -> seconds
function parseTimeToken(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(sec|s|min|m)?$/i.exec(token.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "sec").toLowerCase();
  return unit.startsWith("m") ? n * 60 : n;
}

function parseLabelled(token: string, label: string, unit: string): number | null {
  const m = new RegExp("^(?:" + label + "\\s*)?(\\d+(?:\\.\\d+)?)\\s*" + unit + "$", "i").exec(token.trim());
  return m ? Number(m[1]) : null;
}

const BADGE = /^(FIRST TIME|PR(?:\s+\d+)?)$/i;

// One exercise line: name | reps | weight | time | rpe | notes...
function parseExerciseLine(line: string, date: string, flags: string[]): FitprosExercise | null {
  const parts = line.split("|").map((p) => p.trim());
  const name = parts[0];
  if (!name || BADGE.test(name)) return null;
  const repsCell = splitList(parts[1] ?? "");
  const weightCell = splitList(parts[2] ?? "");
  const timeCell = splitList(parts[3] ?? "");
  const note = parts.slice(5).filter(Boolean).join(" | ").slice(0, 300) || null;

  const reps: (number | null)[] = repsCell.map((t) => {
    const n = numberOrNull(t);
    if (n != null && !Number.isInteger(n)) {
      flags.push(`${date} ${name}: reps "${t}" is not a whole number (imported rounded to ${Math.round(n)}; check it)`);
      return Math.round(n);
    }
    return n;
  });

  // The weight column can also carry a height ("height 20in") or, for carries, a distance sits in the time column ("25yd").
  const weights: (number | null)[] = [];
  const weightUnits: (WeightUnit | null)[] = [];
  const heights: (number | null)[] = [];
  for (const t of weightCell) {
    const h = parseLabelled(t, "height", "in");
    if (h != null) heights.push(h);
    else {
      const parsed = parseWeightCell(t);
      weights.push(parsed.value);
      weightUnits.push(parsed.unit);
    }
  }
  const times: (number | null)[] = [];
  const distances: (number | null)[] = [];
  for (const t of timeCell) {
    const d = parseLabelled(t, "", "yd");
    if (d != null) distances.push(d);
    else times.push(parseTimeToken(t));
  }

  if (reps.length > 0 && weights.length > reps.length) {
    flags.push(`${date} ${name}: ${weights.length} weights for ${reps.length} sets (${weightCell.join(",")}); the extra weight${weights.length - reps.length === 1 ? "" : "s"} dropped`);
    weights.length = reps.length;
  } else if (reps.length > 0 && weights.length > 0 && weights.length < reps.length) {
    flags.push(`${date} ${name}: ${reps.length} sets but ${weights.length} weight${weights.length === 1 ? "" : "s"} (${weightCell.join(",")}); the missing ones are left blank`);
  }

  const setCount = Math.max(reps.length, weights.length, times.length, heights.length, distances.length);
  if (setCount === 0 && !note) return { name, sets: [], note: null };
  const sets: FitprosSet[] = [];
  for (let i = 0; i < setCount; i++) {
    sets.push({
      reps: reps[i] ?? null,
      weight: weights[i] ?? null,
      weightUnit: weightUnits[i] ?? null,
      timeSeconds: times[i] ?? null,
      height: heights[i] ?? heights[0] ?? null,
      distance: distances[i] ?? null,
    });
  }
  return { name, sets, note };
}

export function parseFitprosExport(text: string, chosenUnit: WeightUnit = "lb"): { workouts: FitprosWorkout[]; skippedLines: number } {
  const workouts: FitprosWorkout[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      const [date, title, duration] = line.slice(3).split("|").map((x) => x.trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        skipped++;
        continue;
      }
      // The rating and the workout note (the 4th and 5th fields) are dropped on purpose.
      let durationSeconds = parseDuration(duration ?? "");
      const flags: string[] = [];
      if (durationSeconds != null && durationSeconds > MAX_DURATION_SECONDS) {
        flags.push(`${date}: duration ${duration} looks like a timer left running (dropped)`);
        durationSeconds = null;
      }
      workouts.push({ date, title: title ?? "", durationSeconds, exercises: [], flags });
      continue;
    }
    const current = workouts[workouts.length - 1];
    if (!current) {
      skipped++;
      continue;
    }
    const ex = parseExerciseLine(line, current.date, current.flags);
    if (ex) current.exercises.push(ex);
  }
  // Pounds or kilograms: what the file's weights say (lb or kg after each weight), else the coach's choice. A weight that names the other unit is flagged, not guessed at.
  const plan = planUnits({ headerUnit: null, cellUnits: workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets.map((x) => x.weightUnit ?? null))), chosen: chosenUnit });
  for (const w of workouts) {
    for (const e of w.exercises) {
      for (const set of e.sets) {
        const converted = weightInPounds({ value: set.weight, unit: set.weightUnit ?? null }, plan);
        set.weight = converted.pounds;
        if (converted.unclearReason) {
          set.unclearReason = converted.unclearReason;
          w.flags.push(`${w.date} ${e.name}: a weight names a different unit than the rest of the file; imported as an unclear data point`);
        }
        delete set.weightUnit;
      }
    }
  }
  return { workouts, skippedLines: skipped };
}

// ---- matching to the program -------------------------------------------------------------------------

export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/\bbw\b/g, "bodyweight")
    .replace(/pull down/g, "pulldown")
    .replace(/[(),-]/g, " ")
    .replace(/\bshoulder overhead press\b/g, "overhead press")
    .replace(/\bbarbell bulgarian split squat\b/g, "bulgarian split squat")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

export interface ProgramWorkoutInfo {
  id: string;
  weekNumber: number;
  dayIndex: number;
  title: string;
  exercises: { id: string; name: string }[];
}

export interface PlannedExercise {
  name: string; // as written in the export
  savedName: string; // the program's own name when it matched a line, else as written
  programExerciseId: string | null;
  sets: FitprosSet[];
  note: string | null;
  inLibrary: boolean | null; // null = not checked
}

export interface PlannedWorkout {
  index: number;
  date: string;
  title: string;
  durationSeconds: number | null;
  dayIndex: number | null;
  score: number;
  weekNumber: number | null;
  programWorkoutId: string | null;
  exercises: PlannedExercise[];
  flags: string[];
}

function dayTemplates(program: ProgramWorkoutInfo[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const w of program) {
    const set = out.get(w.dayIndex) ?? new Set<string>();
    for (const e of w.exercises) set.add(normalizeExerciseName(e.name));
    out.set(w.dayIndex, set);
  }
  return out;
}

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.UTC(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, Number(fromKey.slice(8, 10)));
  const b = Date.UTC(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, Number(toKey.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

// The week a date falls in, counting from the program's start date: the day it starts is the first day of week 1.
export function weekOfDate(startDate: string, date: string): number {
  return Math.floor(daysBetween(startDate, date) / 7) + 1;
}

// `taken` = program workouts that already have a session for this client (the database allows one per workout): those, and a workout two export entries both land on, are linked once only.
export function planFitprosImport(workouts: FitprosWorkout[], program: ProgramWorkoutInfo[], startDate: string | null, taken: Set<string> = new Set()): PlannedWorkout[] {
  const templates = dayTemplates(program);
  const claimed = new Set(taken);
  return workouts.map((w, index) => {
    const names = new Set(w.exercises.map((e) => normalizeExerciseName(e.name)));
    let bestDay: number | null = null;
    let bestScore = 0;
    for (const [day, template] of templates) {
      let hit = 0;
      for (const n of names) if (template.has(n)) hit++;
      const union = new Set([...names, ...template]).size;
      const score = union === 0 ? 0 : hit / union;
      if (score > bestScore) {
        bestScore = score;
        bestDay = day;
      }
    }
    const flags = [...w.flags];
    let dayIndex: number | null = bestScore >= MIN_DAY_MATCH ? bestDay : null;
    let weekNumber: number | null = null;
    let target: ProgramWorkoutInfo | null = null;
    if (dayIndex == null) {
      flags.push(`${w.date}: matches no program day (best match ${Math.round(bestScore * 100)} percent); imported as plain history`);
    } else if (!startDate) {
      flags.push(`${w.date}: the program has no start date, so the week is unknown; imported as plain history`);
      dayIndex = null;
    } else {
      weekNumber = weekOfDate(startDate, w.date);
      target = program.find((p) => p.weekNumber === weekNumber && p.dayIndex === dayIndex) ?? null;
      if (target && claimed.has(target.id)) {
        flags.push(`${w.date}: week ${weekNumber} day ${dayIndex} already has a logged session; imported as plain history`);
        target = null;
        weekNumber = null;
      } else if (target) {
        claimed.add(target.id);
      }
      if (!target && weekNumber != null) {
        flags.push(`${w.date}: week ${weekNumber} day ${dayIndex} is not in the program (the date is before the program starts or after it ends); imported as plain history`);
        weekNumber = null;
      }
    }
    const used = new Set<string>();
    const exercises: PlannedExercise[] = w.exercises.map((e) => {
      const key = normalizeExerciseName(e.name);
      const line = target?.exercises.find((x) => !used.has(x.id) && normalizeExerciseName(x.name) === key) ?? null;
      if (line) used.add(line.id);
      return { name: e.name, savedName: line?.name ?? e.name, programExerciseId: line?.id ?? null, sets: e.sets, note: e.note, inLibrary: null };
    });
    return {
      index,
      date: w.date,
      title: w.title,
      durationSeconds: w.durationSeconds,
      dayIndex: target ? dayIndex : null,
      score: Number(bestScore.toFixed(2)),
      weekNumber: target ? weekNumber : null,
      programWorkoutId: target?.id ?? null,
      exercises,
      flags,
    };
  });
}

// The names an import writes, matched to the coach's own library so the same movement is one exercise in graphs and records. A line that matched the program keeps the program's name. Any other line
// becomes the library exercise it is a spelling of ("Pull Ups" for "Pull-Up"), the same movement under another name (the built-in definitive groups and the coach's saved aliases: "Barbell Back Squat"
// for "Back Squat"), or the library name that differs only by abbreviations ("DB" for "Dumbbell"). A different implement or variation is a different exercise ("Zercher Squat" is not "Back Squat"):
// it stays as written and is marked not in the library. Pure.
export function resolveNamesAgainstLibrary(plan: PlannedWorkout[], libraryNames: string[], aliases: AliasEntry[]): PlannedWorkout[] {
  const merged = mergeAliases(aliases, libraryNames);
  const byNormalized = new Map<string, string>();
  for (const name of libraryNames) if (!byNormalized.has(normalizeExerciseName(name))) byNormalized.set(normalizeExerciseName(name), name);
  return plan.map((w) => ({
    ...w,
    exercises: w.exercises.map((e) => {
      if (e.programExerciseId) return { ...e, inLibrary: byNormalized.has(normalizeExerciseName(e.savedName)) };
      const target = findLibraryVariant(e.name, libraryNames) ?? byNormalized.get(normalizeExerciseName(e.name)) ?? resolveTypedAlias(e.name, libraryNames, merged)?.exerciseName ?? null;
      return target ? { ...e, savedName: target, inLibrary: true } : { ...e, inLibrary: false };
    }),
  }));
}

export function summarizePlan(plan: PlannedWorkout[]) {
  const exerciseLines = plan.reduce((n, w) => n + w.exercises.length, 0);
  const sets = plan.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
  return {
    workouts: plan.length,
    linked: plan.filter((w) => w.programWorkoutId).length,
    unlinked: plan.filter((w) => !w.programWorkoutId).length,
    exerciseLines,
    sets,
    flags: plan.flatMap((w) => w.flags),
  };
}

// ---- how an import is recognised again (no column of its own: a marker in the time stamp) ----------------

// Imported sessions are stamped 12:00:17, 12:00:18 ... on their date (the Nth workout of the same day gets 17 + N). Nothing else writes those seconds, so a re-run skips what is already
// there and "Undo this import" removes exactly these sessions and nothing else (not the coach's other history entries).
export const IMPORT_MARKER_FIRST_SECOND = 17;
export const IMPORT_MARKER_LAST_SECOND = 19;

export function markerTimestamp(date: string, nthOfDay: number): string {
  const second = IMPORT_MARKER_FIRST_SECOND + Math.min(nthOfDay, IMPORT_MARKER_LAST_SECOND - IMPORT_MARKER_FIRST_SECOND);
  // Written as UTC explicitly, so the stored time is the same whatever time zone the database session runs in.
  return `${date}T12:00:${String(second).padStart(2, "0")}Z`;
}

export function isImportMarker(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false;
  // Only the exact stamp the import writes counts: noon, no minutes, and the marker second (so no other historical entry can be mistaken for one).
  const m = /T12:00:(\d{2})(?:\.0+)?(?:Z|[+-]00(?::?00)?)?$/.exec(startedAt);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= IMPORT_MARKER_FIRST_SECOND && second <= IMPORT_MARKER_LAST_SECOND;
}

// "date#nth" keys, so a second workout on the same day is told apart.
export function importKeys(plan: { date: string }[]): string[] {
  const seen = new Map<string, number>();
  return plan.map((w) => {
    const n = seen.get(w.date) ?? 0;
    seen.set(w.date, n + 1);
    return `${w.date}#${n}`;
  });
}
