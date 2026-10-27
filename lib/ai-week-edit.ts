import { clampYouthRows } from "@/lib/youth-block";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";

// The AI Program Builder changing days that are already built (Ron, Oct 26: "the workout was a little short, so I want to add XYZ and then the reps were too high on these two exercises, so drop
// them down to 8. Going forwards, from week 2 on out"). The coach's words name the weeks; the AI names the changes (add, remove, change sets/reps/weight/RPE, swap); the app works out exactly which
// exercises in which days they touch, shows that as a plain list, and writes nothing until the coach presses Apply. A day a client has already started is never changed. Pure, so it is tested.

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12" };
const withDigits = (text: string) => text.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => NUMBER_WORDS[w]);

// The weeks the coach asked about. `to` null = to the last week. "rest" = from the first week nobody has started yet to the end.
export type WeekRange = { kind: "weeks"; from: number; to: number | null } | { kind: "rest" } | { kind: "all" };

export function parseWeekRange(text: string): WeekRange | null {
  const t = withDigits(text);
  const span = /\bweeks?\s*(\d{1,2})\s*(?:-|–|—|to|through|thru|until|and)\s*(?:week\s*)?(\d{1,2})\b/.exec(t);
  if (span) {
    const a = Number(span[1]);
    const b = Number(span[2]);
    if (a >= 1 && b >= a) return { kind: "weeks", from: a, to: b };
  }
  const from = /\b(?:from|starting(?:\s+(?:with|at|in|on))?|beginning(?:\s+(?:with|at|in))?|after)\s+week\s*(\d{1,2})\b/.exec(t);
  if (from) {
    const n = Number(from[1]);
    // "after week 1" starts the week after it.
    const start = /^after/.test(from[0]) ? n + 1 : n;
    if (start >= 1) return { kind: "weeks", from: start, to: null };
  }
  const onward = /\bweek\s*(\d{1,2})\s*(?:\+|on\b|onwards?\b|forwards?\b|and\s+(?:on|up|after|beyond|later)\b)/.exec(t);
  if (onward && Number(onward[1]) >= 1) return { kind: "weeks", from: Number(onward[1]), to: null };
  if (/\b(?:every|all|each)\s+(?:the\s+)?weeks?\b|\b(?:whole|entire|full)\s+program\b|\ball\s+of\s+(?:the|this)\s+program\b/.test(t)) return { kind: "all" };
  if (/\brest of (?:the|this|my|their|his|her) (?:program|block|weeks)\b|\bremaining weeks\b|\bgoing forwards?\b|\bfrom (?:now|here) on\b|\bforward from here\b/.test(t)) return { kind: "rest" };
  // One week, only when the words point at it as the place to change ("change week 3", "for week 3", "week 3 only"), never a week mentioned as the past ("on week one, the workout was short").
  const single = /\b(?:change|edit|update|fix|adjust|in|for|only|just)\s+week\s*(\d{1,2})\b|\bweek\s*(\d{1,2})\s+only\b/.exec(t);
  if (single) {
    const n = Number(single[1] ?? single[2]);
    if (n >= 1) return { kind: "weeks", from: n, to: n };
  }
  return null;
}

export const WHICH_WEEKS_QUESTION = "Which weeks? From week 2 on?";

// A short yes to "Which weeks? From week 2 on?".
export function isYes(text: string): boolean {
  return /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct|right|please|do it|sounds good|that'?s right)\b[\s.!,]*(?:please)?[\s.!]*$/i.test(text);
}

// The weeks the change reaches, in this program: the asked range cut to the weeks it has. "rest of the program" starts after the last week a client has started (week 1 when none has).
export function resolveWeeks(range: WeekRange, weeksInProgram: number[], startedWeeks: number[]): number[] {
  const weeks = [...new Set(weeksInProgram)].sort((a, b) => a - b);
  if (weeks.length === 0) return [];
  const last = weeks[weeks.length - 1];
  let from = 1;
  let to = last;
  if (range.kind === "weeks") {
    from = range.from;
    to = range.to ?? last;
  } else if (range.kind === "rest") {
    from = startedWeeks.length > 0 ? Math.max(...startedWeeks) + 1 : 1;
  }
  return weeks.filter((w) => w >= from && w <= to);
}

// A typed request is a CHANGE to built days (not a build) when the program already has a built day, the words ask to change something, and they do not ask for more days or weeks to be built.
const EDIT_WORDS = /\b(?:add|adding|drop|dropping|remove|removing|cut|take\s+out|get\s+rid\s+of|change|changing|swap|swapping|replace|replacing|switch|(?:lower|raise)\s+(?:the|it|them|his|her|their|all|reps|sets|weights?|loads?|rpe|volume|intensity)|increase|decrease|bump|reduce|instead\s+of|down\s+to|up\s+to|more\s+sets|fewer\s+sets|less\s+sets|more\s+reps|fewer\s+reps|less\s+reps|was\s+(?:a\s+little\s+|a\s+bit\s+|too\s+)?(?:short|long|easy|hard)|too\s+(?:high|low|heavy|light|many|few))\b/;
const BUILD_WORDS = /\b(?:build|make\s+(?:it|me|a|the)\b[^.]{0,20}\bweeks?|finish\s+(?:the\s+|this\s+)?week|fill(?:\s+in)?\s+(?:the\s+)?(?:rest|empty)|continue\s+into|add\s+(?:a|an|another|one\s+more|\d{1,2}|more)\s+(?:more\s+)?(?:weeks?|days?)\b|new\s+(?:week|day)\b)/;
export function isEditRequest(text: string, hasBuiltDay: boolean): boolean {
  if (!hasBuiltDay) return false;
  const t = withDigits(text);
  return EDIT_WORDS.test(t) && !BUILD_WORDS.test(t);
}

// What the AI is asked to return: changes only, each for some days of the week ("days": the day numbers, or "all").
export interface AiChange {
  op: "add" | "remove" | "change" | "swap";
  days: number[] | "all";
  exercise: string;
  newExercise?: string | null;
  sets?: number | null;
  reps?: string | null;
  weight?: number | null;
  rpe?: number | null;
  // add only: where it goes; "end" when not said.
  position?: "start" | "end" | { after: string } | null;
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null);

// The model's answer, read strictly: anything that is not one of the four changes, or has no exercise, is dropped. `question`: the model could not tell what to change.
export function readAiChanges(raw: unknown): { changes: AiChange[]; question: string | null } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { changes?: unknown; question?: unknown };
  const list = Array.isArray(obj.changes) ? obj.changes : [];
  const changes: AiChange[] = [];
  for (const c of list.slice(0, 60)) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const op = r.op;
    if (op !== "add" && op !== "remove" && op !== "change" && op !== "swap") continue;
    const exercise = str(r.exercise, 120);
    if (!exercise) continue;
    const days = r.days === "all" || r.days == null ? "all" : Array.isArray(r.days) ? [...new Set(r.days.map((d) => num(d, 1, 14)).filter((d): d is number => d != null))] : "all";
    if (Array.isArray(days) && days.length === 0) continue;
    let position: AiChange["position"] = null;
    if (r.position === "start" || r.position === "end") position = r.position;
    else if (r.position && typeof r.position === "object" && str((r.position as { after?: unknown }).after, 120)) position = { after: str((r.position as { after?: unknown }).after, 120) as string };
    const change: AiChange = {
      op,
      days,
      exercise,
      newExercise: op === "swap" ? str(r.newExercise, 120) : null,
      sets: num(r.sets, 1, 20),
      reps: str(r.reps, 40),
      weight: num(r.weight, 0, 2000),
      rpe: num(r.rpe, 1, 10),
      position: op === "add" ? (position ?? "end") : null,
    };
    if (op === "swap" && !change.newExercise) continue;
    if (op === "change" && change.sets == null && change.reps == null && change.weight == null && change.rpe == null) continue;
    changes.push(change);
  }
  return { changes, question: str(obj.question, 300) };
}

// A built day as the plan sees it.
export interface PlanSet {
  id: string;
  setOrder: number;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
}
export interface PlanExercise {
  id: string;
  name: string;
  order: number;
  sets: PlanSet[];
}
export interface PlanDay {
  workoutId: string;
  week: number;
  day: number;
  exercises: PlanExercise[];
  // A client has started (or logged) this day: it is never changed.
  started: boolean;
}

// One change to one day, exactly as it will be written.
export type DayOp =
  | { op: "add"; name: string; sets: number; reps: string | null; weight: number | null; rpe: number | null; position: "start" | "end" | { afterId: string } }
  | { op: "remove"; exerciseId: string; name: string }
  | { op: "change"; exerciseId: string; name: string; sets: number | null; reps: string | null; weight: number | null; rpe: number | null; before: { sets: number; reps: string | null; weight: number | null; rpe: number | null } }
  | { op: "swap"; exerciseId: string; name: string; newName: string };

export interface PlannedDay {
  workoutId: string;
  week: number;
  day: number;
  ops: DayOp[];
}

export interface WeekEditPlan {
  days: PlannedDay[];
  skipped: string[];
  flags: string[];
}

// "Goblet squats" finds "Goblet Squat"; a shorter name finds the one exercise in the day that contains it ("rows" -> "Seated Cable Row" when it is the only row). Two candidates: nothing is guessed.
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
export function findExercise(exercises: PlanExercise[], name: string): PlanExercise | null {
  const want = words(name);
  if (want.length === 0) return null;
  const key = want.join(" ");
  const exact = exercises.filter((e) => words(e.name).join(" ") === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const containing = exercises.filter((e) => {
    const have = new Set(words(e.name));
    return want.every((w) => have.has(w));
  });
  return containing.length === 1 ? containing[0] : null;
}

const describeSets = (sets: number, reps: string | null, weight: number | null, rpe: number | null) =>
  `${sets}${reps ? `x${reps}` : " sets"}${weight != null ? ` @ ${weight}` : ""}${rpe != null ? ` RPE ${rpe}` : ""}`;

export function planWeekEdits(input: { changes: AiChange[]; days: PlanDay[]; weeks: number[]; youth: boolean; cleanName?: (name: string) => string }): WeekEditPlan {
  const clean = input.cleanName ?? ((n: string) => cleanExerciseName(n));
  const weekSet = new Set(input.weeks);
  const skipped: string[] = [];
  const flags = new Set<string>();
  const out: PlannedDay[] = [];
  const target = input.days.filter((d) => weekSet.has(d.week) && d.exercises.length > 0).sort((a, b) => a.week - b.week || a.day - b.day);
  for (const d of target) {
    const wanted = input.changes.filter((c) => c.days === "all" || c.days.includes(d.day));
    if (wanted.length === 0) continue;
    if (d.started) {
      skipped.push(`Week ${d.week} Day ${d.day} skipped, already logged`);
      continue;
    }
    const ops: DayOp[] = [];
    const touched = new Set<string>();
    for (const c of wanted) {
      if (c.op === "add") {
        const name = clean(c.exercise);
        if (exerciseNameProblem(name)) continue;
        // Already in the day: not added twice.
        if (findExercise(d.exercises, name)) continue;
        let position: "start" | "end" | { afterId: string } = c.position === "start" ? "start" : "end";
        if (c.position && typeof c.position === "object") {
          const after = findExercise(d.exercises, c.position.after);
          position = after ? { afterId: after.id } : "end";
        }
        ops.push({ op: "add", name, sets: c.sets ?? 3, reps: c.reps ?? null, weight: c.weight ?? null, rpe: c.rpe ?? null, position });
        continue;
      }
      // Only the exercise the coach named, and only once per day.
      const ex = findExercise(d.exercises, c.exercise);
      if (!ex || touched.has(ex.id)) continue;
      touched.add(ex.id);
      if (c.op === "remove") ops.push({ op: "remove", exerciseId: ex.id, name: ex.name });
      else if (c.op === "swap") {
        const newName = clean(c.newExercise ?? "");
        if (!newName || exerciseNameProblem(newName)) continue;
        ops.push({ op: "swap", exerciseId: ex.id, name: ex.name, newName });
      } else {
        const first = ex.sets[0];
        ops.push({
          op: "change",
          exerciseId: ex.id,
          name: ex.name,
          sets: c.sets ?? null,
          reps: c.reps ?? null,
          weight: c.weight ?? null,
          rpe: c.rpe ?? null,
          before: { sets: ex.sets.length, reps: first?.reps ?? null, weight: first?.weight ?? null, rpe: first?.rpe ?? null },
        });
      }
    }
    // A young client (or one with no birthdate on file): edited and added sets never ask for more than RPE 8, and reps outside the moderate range are noted, as when the day was built.
    if (input.youth) {
      const rows = ops.filter((o): o is Extract<DayOp, { op: "add" | "change" }> => o.op === "add" || o.op === "change").map((o) => ({ exerciseName: o.name, reps: o.reps, rpe: o.rpe }));
      const clamped = clampYouthRows(rows);
      let i = 0;
      for (const o of ops) {
        if (o.op !== "add" && o.op !== "change") continue;
        o.rpe = clamped.rows[i].rpe;
        i++;
      }
      for (const f of clamped.flags) flags.add(f);
    }
    if (ops.length > 0) out.push({ workoutId: d.workoutId, week: d.week, day: d.day, ops });
  }
  return { days: out, skipped, flags: [...flags] };
}

export function describeOp(o: DayOp): string {
  if (o.op === "add") {
    const where = o.position === "start" ? " at the start" : o.position === "end" ? " at the end" : "";
    return `add ${o.name} ${describeSets(o.sets, o.reps, o.weight, o.rpe)}${where}`;
  }
  if (o.op === "remove") return `remove ${o.name}`;
  if (o.op === "swap") return `swap ${o.name} for ${o.newName}`;
  const b = o.before;
  const after = { sets: o.sets ?? b.sets, reps: o.reps ?? b.reps, weight: o.weight ?? b.weight, rpe: o.rpe ?? b.rpe };
  return `${o.name} ${describeSets(b.sets, b.reps, b.weight, b.rpe)} -> ${describeSets(after.sets, after.reps, after.weight, after.rpe)}`;
}

// The preview: one line per day, with the same day in neighbouring weeks said once ("Weeks 2-6, Day 1: add Farmer Carry 3x40 yd at the end; Goblet Squat 3x10 -> 3x8").
export function previewLines(plan: WeekEditPlan): string[] {
  const byDay = new Map<number, { week: number; text: string }[]>();
  for (const d of plan.days) {
    const list = byDay.get(d.day) ?? [];
    list.push({ week: d.week, text: d.ops.map(describeOp).join("; ") });
    byDay.set(d.day, list);
  }
  const groups: { from: number; to: number; day: number; text: string }[] = [];
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.week - b.week);
    for (const item of list) {
      const prev = groups[groups.length - 1];
      if (prev && prev.day === day && prev.text === item.text && prev.to === item.week - 1) prev.to = item.week;
      else groups.push({ from: item.week, to: item.week, day, text: item.text });
    }
  }
  groups.sort((a, b) => a.from - b.from || a.day - b.day);
  return groups.map((g) => `${g.from === g.to ? `Week ${g.from}` : `Weeks ${g.from}-${g.to}`}, Day ${g.day}: ${g.text}`);
}

// Writing the plan. All of it or none of it: everything that only adds or updates goes first, and if any of it fails it is put back the way it was; the removals go last, in one request each.
export interface EditDb {
  updateSet(id: string, values: { target_reps?: string | null; target_weight?: number | null; target_rpe?: number | null }): Promise<boolean>;
  insertSets(rows: Record<string, unknown>[]): Promise<string[] | null>;
  insertExercise(row: Record<string, unknown>): Promise<string | null>;
  updateExercise(id: string, values: { exercise_name?: string; display_name?: string | null; exercise_order?: number }): Promise<boolean>;
  deleteExercises(ids: string[]): Promise<boolean>;
  deleteSets(ids: string[]): Promise<boolean>;
}

export interface SnapshotSet extends PlanSet {
  row: Record<string, unknown>;
}
export interface SnapshotExercise {
  id: string;
  name: string;
  displayName: string | null;
  order: number;
  sets: SnapshotSet[];
}

export async function applyWeekEdits(db: EditDb, plan: PlannedDay[], snapshot: Map<string, SnapshotExercise[]>, groupId: string): Promise<{ ok: boolean; changedWorkoutIds: string[] }> {
  const undo: (() => Promise<unknown>)[] = [];
  const removeExercises: string[] = [];
  const removeSets: string[] = [];
  const rollback = async () => {
    for (const u of undo.reverse()) await u();
  };
  for (const day of plan) {
    const current = snapshot.get(day.workoutId) ?? [];
    const byId = new Map(current.map((e) => [e.id, e]));
    // The day's order with the additions placed, then renumbered once.
    const order: ({ kind: "old"; ex: SnapshotExercise } | { kind: "new"; id: string })[] = current.slice().sort((a, b) => a.order - b.order).map((ex) => ({ kind: "old" as const, ex }));
    for (const o of day.ops) {
      if (o.op === "change") {
        const ex = byId.get(o.exerciseId);
        if (!ex) continue;
        const values: { target_reps?: string | null; target_weight?: number | null; target_rpe?: number | null } = {};
        if (o.reps != null) values.target_reps = o.reps;
        if (o.weight != null) values.target_weight = o.weight;
        if (o.rpe != null) values.target_rpe = o.rpe;
        const sets = ex.sets.slice().sort((a, b) => a.setOrder - b.setOrder);
        const keep = o.sets != null ? sets.slice(0, o.sets) : sets;
        if (Object.keys(values).length > 0) {
          for (const s of keep) {
            if (!(await db.updateSet(s.id, values))) return (await rollback(), { ok: false, changedWorkoutIds: [] });
            undo.push(() => db.updateSet(s.id, { target_reps: s.reps, target_weight: s.weight, target_rpe: s.rpe }));
          }
        }
        if (o.sets != null && o.sets > sets.length) {
          const base = (sets[sets.length - 1]?.row ?? {}) as Record<string, unknown>;
          const extra = Array.from({ length: o.sets - sets.length }, (_, i) => {
            const { id: _id, created_at: _c, ...rest } = base;
            void _id;
            void _c;
            return { ...rest, ...values, group_workout_exercise_id: ex.id, set_order: (sets[sets.length - 1]?.setOrder ?? -1) + 1 + i };
          });
          const ids = await db.insertSets(extra);
          if (!ids) return (await rollback(), { ok: false, changedWorkoutIds: [] });
          undo.push(() => db.deleteSets(ids));
        }
        if (o.sets != null && o.sets < sets.length) removeSets.push(...sets.slice(o.sets).map((s) => s.id));
      } else if (o.op === "swap") {
        const ex = byId.get(o.exerciseId);
        if (!ex) continue;
        if (!(await db.updateExercise(ex.id, { exercise_name: o.newName, display_name: null }))) return (await rollback(), { ok: false, changedWorkoutIds: [] });
        undo.push(() => db.updateExercise(ex.id, { exercise_name: ex.name, display_name: ex.displayName }));
      } else if (o.op === "remove") {
        if (byId.has(o.exerciseId)) removeExercises.push(o.exerciseId);
      } else {
        const id = await db.insertExercise({ workout_id: day.workoutId, group_id: groupId, exercise_name: o.name, exercise_order: 0 });
        if (!id) return (await rollback(), { ok: false, changedWorkoutIds: [] });
        undo.push(() => db.deleteExercises([id]));
        const ids = await db.insertSets(Array.from({ length: Math.max(1, o.sets) }, (_, i) => ({ group_workout_exercise_id: id, set_order: i, target_reps: o.reps, target_weight: o.weight, target_rpe: o.rpe })));
        if (!ids) return (await rollback(), { ok: false, changedWorkoutIds: [] });
        const entry = { kind: "new" as const, id };
        if (o.position === "start") order.unshift(entry);
        else if (o.position === "end") order.push(entry);
        else {
          const afterId = o.position.afterId;
          const at = order.findIndex((x) => x.kind === "old" && x.ex.id === afterId);
          if (at >= 0) order.splice(at + 1, 0, entry);
          else order.push(entry);
        }
      }
    }
    // Renumber only when something was added (the others keep their places).
    if (day.ops.some((o) => o.op === "add")) {
      for (let i = 0; i < order.length; i++) {
        const x = order[i];
        if (x.kind === "old" && x.ex.order === i) continue;
        const id = x.kind === "old" ? x.ex.id : x.id;
        if (!(await db.updateExercise(id, { exercise_order: i }))) return (await rollback(), { ok: false, changedWorkoutIds: [] });
        if (x.kind === "old") {
          const was = x.ex.order;
          undo.push(() => db.updateExercise(id, { exercise_order: was }));
        }
      }
    }
  }
  if (removeSets.length > 0 && !(await db.deleteSets(removeSets))) return (await rollback(), { ok: false, changedWorkoutIds: [] });
  if (removeExercises.length > 0 && !(await db.deleteExercises(removeExercises))) {
    // The extra sets above are already gone: they are put back from the snapshot, then everything else.
    const gone = [...snapshot.values()].flat().flatMap((e) => e.sets).filter((s) => removeSets.includes(s.id)).map((s) => s.row);
    if (gone.length > 0) await db.insertSets(gone);
    await rollback();
    return { ok: false, changedWorkoutIds: [] };
  }
  return { ok: true, changedWorkoutIds: plan.map((d) => d.workoutId) };
}

// The plan the browser sends back with Apply is checked against the program as it is now: only this program's days, only exercises in those days, and never a day that has been started since the preview.
export function checkPlanAgainstProgram(plan: PlannedDay[], days: PlanDay[]): { plan: PlannedDay[]; skipped: string[]; foreign: boolean } {
  const byWorkout = new Map(days.map((d) => [d.workoutId, d]));
  const skipped: string[] = [];
  let foreign = false;
  const out: PlannedDay[] = [];
  for (const p of plan) {
    const d = byWorkout.get(p.workoutId);
    if (!d) {
      foreign = true;
      continue;
    }
    if (d.started) {
      skipped.push(`Week ${d.week} Day ${d.day} skipped, already logged`);
      continue;
    }
    const ids = new Set(d.exercises.map((e) => e.id));
    const ops = p.ops.filter((o) => o.op === "add" ? !(typeof o.position === "object" && !ids.has(o.position.afterId)) : ids.has(o.exerciseId));
    if (ops.length !== p.ops.length) foreign = true;
    out.push({ workoutId: d.workoutId, week: d.week, day: d.day, ops });
  }
  return { plan: out, skipped, foreign };
}

// The plan as the browser sends it back with Apply, read strictly (names and numbers checked again; the youth cap is applied again on the server).
export function readPlan(raw: unknown, youth: boolean): PlannedDay[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedDay[] = [];
  for (const d of raw.slice(0, 200)) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (typeof r.workoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(r.workoutId)) continue;
    const week = num(r.week, 1, 52);
    const day = num(r.day, 1, 14);
    if (week == null || day == null || !Array.isArray(r.ops)) continue;
    const ops: DayOp[] = [];
    for (const o of r.ops.slice(0, 60)) {
      if (!o || typeof o !== "object") continue;
      const x = o as Record<string, unknown>;
      const id = typeof x.exerciseId === "string" && /^[0-9a-f-]{36}$/i.test(x.exerciseId) ? x.exerciseId : null;
      const name = cleanExerciseName(str(x.name, 120));
      let rpe = num(x.rpe, 1, 10);
      if (youth && rpe != null && rpe > 8) rpe = 8;
      if (x.op === "remove" && id) ops.push({ op: "remove", exerciseId: id, name });
      else if (x.op === "swap" && id) {
        const newName = cleanExerciseName(str(x.newName, 120));
        if (newName && !exerciseNameProblem(newName)) ops.push({ op: "swap", exerciseId: id, name, newName });
      } else if (x.op === "change" && id) {
        const b = (x.before && typeof x.before === "object" ? x.before : {}) as Record<string, unknown>;
        ops.push({ op: "change", exerciseId: id, name, sets: num(x.sets, 1, 20), reps: str(x.reps, 40), weight: num(x.weight, 0, 2000), rpe, before: { sets: num(b.sets, 0, 50) ?? 0, reps: str(b.reps, 40), weight: num(b.weight, 0, 2000), rpe: num(b.rpe, 1, 10) } });
      } else if (x.op === "add" && name && !exerciseNameProblem(name)) {
        const p = x.position;
        const position: "start" | "end" | { afterId: string } =
          p === "start" ? "start" : p && typeof p === "object" && typeof (p as { afterId?: unknown }).afterId === "string" ? { afterId: (p as { afterId: string }).afterId } : "end";
        ops.push({ op: "add", name, sets: num(x.sets, 1, 20) ?? 3, reps: str(x.reps, 40), weight: num(x.weight, 0, 2000), rpe, position });
      }
    }
    if (ops.length > 0) out.push({ workoutId: r.workoutId, week, day, ops });
  }
  return out;
}

export const EDIT_SYSTEM_PROMPT = `You change an existing training program the coach already built. You do NOT build days. Return ONLY JSON:
{"changes":[{"op":"add|remove|change|swap","days":[1,2] or "all","exercise":"exercise name","newExercise":"for swap only","sets":3,"reps":"8","weight":null,"rpe":null,"position":"end" or "start" or {"after":"exercise name"}}],"question":null}
Rules:
- One entry per change the coach asked for. "days" are the day numbers of the week the change belongs to ("all" when the coach means every day).
- "exercise" is the exercise exactly as it appears in the days listed (for add: the new exercise's name).
- For change, give only the fields the coach asked to change (for "drop the reps to 8" give "reps":"8" and nothing else).
- For add, give sets and reps; "position" is "end" unless the coach said where.
- Never invent changes the coach did not ask for. Never change weeks; the app decides the weeks.
- If you cannot tell what to change, return {"changes":[],"question":"one short question"}.
Keep the answer compact.`;

export function editUserText(input: { instruction: string; corrections: string[]; days: PlanDay[]; youthBlock: string | null }): string {
  const lines: string[] = [];
  // The days the change is about, as the first week in range has them (later weeks usually repeat them; each change is matched by name in every week).
  const firstWeek = Math.min(...input.days.map((d) => d.week));
  for (const d of input.days.filter((x) => x.week === firstWeek).sort((a, b) => a.day - b.day)) {
    const ex = d.exercises
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((e) => `${e.name} ${describeSets(e.sets.length, e.sets[0]?.reps ?? null, e.sets[0]?.weight ?? null, e.sets[0]?.rpe ?? null)}`);
    lines.push(`Day ${d.day}: ${ex.join("; ")}`);
  }
  return [
    `The coach said: "${input.instruction}"`,
    input.corrections.length > 0 ? `Then corrected: ${input.corrections.map((c) => `"${c}"`).join(" ")}` : "",
    "The days (as they are now):",
    ...lines,
    input.youthBlock ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

// The charge itself: one of the free uses (on the free tier), then the credits. When the credits cannot be spent the free use is given back: the coach was not charged, so it must not count.
export async function spendFreeUseThenCredits(steps: {
  takeFree: () => Promise<{ ok: true; free: boolean; useId?: string } | { ok: false; error: string }>;
  spendCredits: () => Promise<{ ok: boolean; error?: string }>;
  giveBack: (useId: string) => Promise<void>;
}): Promise<{ ok: boolean; error?: string }> {
  const free = await steps.takeFree();
  if (!free.ok) return { ok: false, error: free.error };
  const spent = await steps.spendCredits();
  if (!spent.ok && free.free && free.useId) await steps.giveBack(free.useId);
  return spent;
}

// One AI use per preview, charged like a program build: checked first (nothing is called when it cannot be paid for), spent only once a preview with changes is really back. A failed call or a preview
// with nothing to change (or only a question) is never charged. Cancel after a preview is not given back (the use was made).
export async function chargedPreview<T>(steps: {
  canRun: () => Promise<{ ok: boolean; error?: string }>;
  ask: () => Promise<T | null>;
  hasChanges: (result: T) => boolean;
  spend: () => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ ok: true; result: T; charged: boolean } | { ok: false; error: string; status: number }> {
  const can = await steps.canRun();
  if (!can.ok) return { ok: false, error: can.error ?? "Not enough AI uses left.", status: 402 };
  const result = await steps.ask();
  if (result == null) return { ok: false, error: "Couldn't work out those changes. Try saying it another way.", status: 502 };
  if (!steps.hasChanges(result)) return { ok: true, result, charged: false };
  const spent = await steps.spend();
  if (!spent.ok) return { ok: false, error: spent.error ?? "Couldn't process credits. Try again.", status: 402 };
  return { ok: true, result, charged: true };
}
