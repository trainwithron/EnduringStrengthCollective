// The review of a filled team sheet: what each box says (read by the cell reader), checked against what the group has NOW (is the athlete still in it, is the exercise still there, does the athlete already have a
// session for that workout). It is built twice with the same code: once to show the coach, and again on the server from the text the coach confirmed, so what is saved is never what a browser claims it parsed.
import { chunk } from "@/lib/chunk";
import { readRowsByIds } from "@/lib/read-by-ids";
import { zonedTimeToUtc } from "@/lib/timezone";
import { describeCell, readBox, type ParsedCell, type SheetUnit } from "@/lib/team-sheet/cell-parser";
import type { ParsedRack } from "@/lib/team-sheet/read-upload";
import { describePrescription, dayLabel, shortName } from "@/lib/team-sheet/sheet-model";
import { encodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";

export type ExerciseKind = "load" | "reps" | "unread";

export interface ReviewExercise {
  id: string;
  name: string;
  prescription: string;
  kind: ExerciseKind;
  /** how many set boxes the sheet had, and the reps a weight written alone is read at (for reading an edited box) */
  sets: number;
  reps: number | null;
  workoutId: string | null;
  /** the exercise is not in the group any more */
  missing: boolean;
}

export interface ReviewCell {
  exerciseId: string;
  text: string;
  /** what the reader made of it */
  result: ParsedCell | { kind: "unread" } | { kind: "missing" };
  described: string;
}

export interface ReviewRow {
  athleteId: string;
  name: string;
  printedName: string;
  /** the printed name is not the one the seat has now: the row may be for someone else */
  nameChanged: boolean;
  /** not an athlete of the group any more */
  gone: boolean;
  /** per day: this athlete already has a session for this workout */
  existing: boolean[];
  days: ReviewCell[][];
  notes: string;
}

export interface ReviewDay {
  date: string;
  label: string;
  title: string;
  exercises: ReviewExercise[];
}

export interface ReviewSheet {
  rack: number;
  code: SheetCode;
  /** the sheet code as printed; it goes back with the save so the server can check it */
  codeText: string;
  days: ReviewDay[];
  rows: ReviewRow[];
}

export interface Review {
  groupId: string;
  unit: SheetUnit;
  sheets: ReviewSheet[];
  summary: { athletes: number; filledRows: number; filledCells: number; unsure: number; existing: number; gone: number };
}

interface GweRow {
  id: string;
  workout_id: string;
  exercise_name: string;
  display_name: string | null;
  tracked_fields: string[] | null;
  group_workout_exercise_sets: { set_order: number | null; target_reps: string | null }[] | null;
}

export interface Context {
  exercises: Map<string, GweRow>;
  workoutTitles: Map<string, string>;
  /** athlete id -> full name, for athletes currently in the group */
  roster: Map<string, string>;
  /** "workoutId:athleteId" of every session that already exists */
  sessions: Set<string>;
}

export const CONTEXT_READS = {
  exercises: "id, workout_id, exercise_name, display_name, tracked_fields, group_workout_exercise_sets ( set_order, target_reps )",
  workouts: "id, title",
  roster: "profile_id, profiles ( full_name )",
  sessions: "workout_id, athlete_id",
} as const;

/** Reads what the review needs from the database, as the signed-in coach. A failed read is an error, never "nothing there". */
export async function loadContext(supabase: any, groupId: string, racks: { code: SheetCode }[]): Promise<{ ok: true; context: Context } | { ok: false; error: string }> {
  const exerciseIds = Array.from(new Set(racks.flatMap((r) => r.code.days.flatMap((d) => d.exercises))));
  const athleteIds = Array.from(new Set(racks.flatMap((r) => r.code.athletes)));
  const exRead = await readRowsByIds(exerciseIds, (ids: string[]) => (from: number, to: number) => supabase.from("group_workout_exercises").select(CONTEXT_READS.exercises).eq("group_id", groupId).in("id", ids).order("id").range(from, to));
  if (exRead.error) return { ok: false, error: "Couldn't read the exercises. Try again." };
  const exercises = new Map<string, GweRow>((exRead.data as GweRow[]).map((e) => [e.id, e]));
  const workoutIds = Array.from(new Set(Array.from(exercises.values()).map((e) => e.workout_id)));
  const wRead = await readRowsByIds(workoutIds, (ids: string[]) => (from: number, to: number) => supabase.from("workouts").select(CONTEXT_READS.workouts).eq("group_id", groupId).in("id", ids).order("id").range(from, to));
  if (wRead.error) return { ok: false, error: "Couldn't read the workouts. Try again." };
  const rosterRows: { profile_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[] = [];
  for (const ids of chunk(athleteIds, 100)) {
    const { data, error } = await supabase.from("group_memberships").select(CONTEXT_READS.roster).eq("group_id", groupId).eq("role", "athlete").in("profile_id", ids);
    if (error) return { ok: false, error: "Couldn't read the roster. Try again." };
    rosterRows.push(...(data ?? []));
  }
  const sRead = await readRowsByIds(workoutIds, (ids: string[]) => (from: number, to: number) => supabase.from("athlete_sessions").select(CONTEXT_READS.sessions).eq("group_id", groupId).in("workout_id", ids).order("id").range(from, to));
  if (sRead.error) return { ok: false, error: "Couldn't read the sessions. Try again." };
  return {
    ok: true,
    context: {
      exercises,
      workoutTitles: new Map((wRead.data as { id: string; title: string | null }[]).map((w) => [w.id, (w.title ?? "").trim()])),
      roster: new Map(rosterRows.map((r) => [r.profile_id, ((Array.isArray(r.profiles) ? r.profiles[0] : r.profiles)?.full_name as string | null) ?? ""])),
      sessions: new Set((sRead.data as { workout_id: string; athlete_id: string }[]).map((s) => `${s.workout_id}:${s.athlete_id}`)),
    },
  };
}

function kindOf(row: GweRow): ExerciseKind {
  const tracked = row.tracked_fields && row.tracked_fields.length > 0 ? row.tracked_fields : ["reps", "weight"];
  if (tracked.includes("weight")) return "load";
  return tracked.includes("reps") ? "reps" : "unread";
}

export function buildReview(groupId: string, racks: ParsedRack[], context: Context, unit: SheetUnit): Review {
  const sheets: ReviewSheet[] = racks
    .slice()
    .sort((a, b) => a.code.rack - b.code.rack)
    .map((rack) => {
      const days: ReviewDay[] = rack.code.days.map((d) => {
        const exercises: ReviewExercise[] = d.exercises.map((id) => {
          const row = context.exercises.get(id);
          if (!row) return { id, name: "(removed exercise)", prescription: "", kind: "unread", sets: 0, reps: null, workoutId: null, missing: true };
          const sets = [...(row.group_workout_exercise_sets ?? [])].sort((a, b) => (a.set_order ?? 0) - (b.set_order ?? 0));
          const p = describePrescription({ sets: sets.map((s) => ({ target_reps: s.target_reps })) });
          const kind = kindOf(row);
          return { id, name: (row.display_name ?? "").trim() || row.exercise_name, prescription: kind === "reps" ? `${p.text} reps` : p.text, kind, sets: p.sets, reps: p.reps, workoutId: row.workout_id, missing: false };
        });
        const workoutIds = Array.from(new Set(exercises.map((e) => e.workoutId).filter((x): x is string => !!x)));
        return { date: d.date, label: dayLabel(d.date), title: workoutIds.map((w) => context.workoutTitles.get(w) ?? "").filter(Boolean).join(" / ").slice(0, 40), exercises };
      });
      const rows: ReviewRow[] = rack.rows.map((r) => {
        const fullName = context.roster.get(r.athleteId);
        const gone = fullName === undefined;
        const nowName = gone ? "" : shortName(fullName);
        const dayCells: ReviewCell[][] = rack.code.days.map((d, di) =>
          d.exercises.map((exId, ei) => {
            const ex = days[di].exercises[ei];
            const text = (r.cells[di]?.[ei] ?? "").trim();
            if (ex.missing) return { exerciseId: exId, text, result: { kind: "missing" as const }, described: "" };
            if (ex.kind === "unread") return { exerciseId: exId, text, result: { kind: "unread" as const }, described: text };
            const result = readBox(ex.kind, text, { unit, sets: ex.sets, reps: ex.reps });
            return { exerciseId: exId, text, result, described: result.kind === "unread" ? text : describeCell(result, unit) };
          })
        );
        const existing = days.map((day) => {
          const wids = Array.from(new Set(day.exercises.map((e) => e.workoutId).filter((x): x is string => !!x)));
          return wids.some((w) => context.sessions.has(`${w}:${r.athleteId}`));
        });
        return { athleteId: r.athleteId, name: gone ? r.printedName || "(not in the group)" : nowName, printedName: r.printedName, nameChanged: !gone && r.printedName !== "" && r.printedName !== nowName && !r.printedName.startsWith(nowName), gone, existing, days: dayCells, notes: r.notes };
      });
      return { rack: rack.code.rack, code: rack.code, codeText: encodeSheetCode(rack.code), days, rows };
    });

  let filledRows = 0;
  let filledCells = 0;
  let unsure = 0;
  let existing = 0;
  let gone = 0;
  for (const s of sheets) {
    for (const row of s.rows) {
      const cells = row.days.flat();
      const filled = cells.filter((c) => c.result.kind === "sets" || c.result.kind === "skipped");
      if (filled.length > 0 || cells.some((c) => c.result.kind === "unsure")) filledRows++;
      filledCells += cells.filter((c) => c.result.kind === "sets").length;
      unsure += cells.filter((c) => c.result.kind === "unsure").length;
      existing += row.existing.filter(Boolean).length;
      if (row.gone) gone++;
    }
  }
  return { groupId, unit, sheets, summary: { athletes: sheets.reduce((n, s) => n + s.rows.length, 0), filledRows, filledCells, unsure, existing, gone } };
}

export interface SaveRow {
  athlete_id: string;
  workout_id: string;
  day: string;
  at: string;
  exercises: { id: string; sets: { weight: number | null; reps: number | null }[] }[];
}

/** The rows team_sheet_save takes: one per athlete, per workout, with only the boxes the reader understood. An unsure box saves nothing; a skipped one saves nothing; a gone athlete is left out. */
export function toSaveRows(review: Review, timeZone: string, skipAthletes: Set<string> = new Set()): { rows: SaveRow[]; droppedUnsure: number } {
  const rows: SaveRow[] = [];
  let droppedUnsure = 0;
  for (const sheet of review.sheets) {
    sheet.rows.forEach((row) => {
      if (row.gone || skipAthletes.has(`${sheet.rack}:${row.athleteId}`)) return;
      sheet.days.forEach((day, di) => {
        const byWorkout = new Map<string, SaveRow>();
        row.days[di].forEach((cell, ei) => {
          const ex = day.exercises[ei];
          if (cell.result.kind === "unsure") droppedUnsure++;
          if (cell.result.kind !== "sets" || !ex.workoutId) return;
          let entry = byWorkout.get(ex.workoutId);
          if (!entry) {
            entry = { athlete_id: row.athleteId, workout_id: ex.workoutId, day: day.date, at: zonedTimeToUtc(day.date, "12:00", timeZone).toISOString(), exercises: [] };
            byWorkout.set(ex.workoutId, entry);
          }
          entry.exercises.push({ id: ex.id, sets: cell.result.sets.map((s) => ({ weight: s.weight, reps: s.reps })) });
        });
        rows.push(...byWorkout.values());
      });
    });
  }
  return { rows, droppedUnsure };
}
