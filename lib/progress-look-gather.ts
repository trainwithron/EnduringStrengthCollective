import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInactiveKeys, inactiveKey } from "./inactive-ids";
import {
  buildCards,
  cardKey,
  hintEnabled,
  isHidden,
  mentionsPain,
  progressThreshold,
  type ExerciseHistory,
  type ProgressCard,
  type ProgressEvent,
  type ProgressPoint,
  type Tier,
} from "./progress-look";

// Everything the "time to progress?" row on Home needs, read with the coach's own access (so a coach only ever sees their own clients) and never shown to a
// client. No database change: the coach's answers are kept in their own spotter_recommendation_feedback rows (kind "progress"), which already exist.
//
// Suppressions, so a card is never a false alarm: a client set aside as inactive, one who has not trained in 21 days, a deliberate deficit phase, a deload
// workout or program, and a pain or injury note in the last 14 days. Per exercise: a missed set, or a program that is already raising the weight.

const DAY = 86400000;
export const LOOKBACK_DAYS = 84;
export const QUIET_DAYS = 21;
export const PAIN_NOTE_DAYS = 14;
const PAGE = 1000;
const MAX_PAGES = 25;
const IN_CHUNK = 150;

export interface NextSlot {
  exerciseId: string;
  workoutId: string;
  notes: string | null;
  sets: { id: string; setOrder: number; targetWeight: number | null; targetReps: string | null }[];
}

export interface ProgressCardData extends ProgressCard {
  clientName: string;
  // True when the client's program is their own copy, so changing it changes nobody else's; applying an option is only offered then.
  programIsPersonal: boolean;
  // The client's next not-yet-done workout of this program, per flagged or other exercise (null when there is none left).
  nextSlotByExercise: Record<string, NextSlot | null>;
  harderByExercise: Record<string, string | null>;
}

export interface ProgressLookData {
  cards: ProgressCardData[];
  threshold: number;
  hintOn: boolean;
  // True when the history was cut short by the page limit (a very large roster), so the panel can say so honestly.
  truncated: boolean;
}

const chunk = <T,>(items: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
};

// The lowest number in a target such as "8", "8-10" or "8 to 10": the reps the client was asked for at the least.
export function minTargetReps(text: string | null | undefined): number | null {
  const m = text ? text.match(/\d+/) : null;
  return m ? Number(m[0]) : null;
}

export async function gatherProgressLook(
  supabase: SupabaseClient,
  input: { coachId: string; groupIds: string[]; now: Date }
): Promise<ProgressLookData> {
  const { coachId, groupIds, now } = input;
  const empty: ProgressLookData = { cards: [], threshold: 3, hintOn: true, truncated: false };
  if (groupIds.length === 0) return empty;
  const sinceIso = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString();

  // The coach's own earlier answers (soft: if the lookup fails the row simply shows with the starting threshold).
  const { data: feedbackRows } = await supabase
    .from("spotter_recommendation_feedback")
    .select("dismissal_key, action, edit_detail, created_at")
    .eq("coach_id", coachId)
    .eq("spotter_kind", "progress")
    .order("created_at", { ascending: false })
    .limit(500);
  const events: ProgressEvent[] = ((feedbackRows ?? []) as any[]).map((r) => ({ key: r.dismissal_key, action: r.action, detail: r.edit_detail ?? null, at: r.created_at }));
  const threshold = progressThreshold(events);
  const hintOn = hintEnabled(events);

  // Clients, minus anyone the coach has set aside.
  const { data: memberRows } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id, profiles ( full_name )")
    .in("group_id", groupIds)
    .eq("role", "athlete");
  const inactive = await fetchInactiveKeys(supabase, groupIds);
  const clients = new Map<string, { groupId: string; name: string }>();
  for (const r of (memberRows ?? []) as any[]) {
    if (inactive.has(inactiveKey(r.group_id, r.profile_id))) continue;
    if (!clients.has(r.profile_id)) clients.set(r.profile_id, { groupId: r.group_id, name: r.profiles?.full_name ?? "Client" });
  }
  if (clients.size === 0) return { ...empty, threshold, hintOn };

  // Every logged set in the window, with its session, read a page at a time. A set that was skipped has no completion time, so the window is the session's.
  const sets: any[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("set_logs")
      .select(
        `set_order, weight, reps, rpe, status,
         session_exercises!inner ( id, exercise_name, group_workout_exercise_id, athlete_note,
           athlete_sessions!inner ( id, athlete_id, group_id, workout_id, status, completed_at ) )`
      )
      .in("session_exercises.athlete_sessions.group_id", groupIds)
      .eq("session_exercises.athlete_sessions.status", "completed")
      .gte("session_exercises.athlete_sessions.completed_at", sinceIso)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { ...empty, threshold, hintOn };
    sets.push(...((data ?? []) as any[]));
    if ((data ?? []).length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // The workouts these sessions were for (a workout is "Tuesday lower" in a program), and their programs.
  const workoutIds = Array.from(new Set(sets.map((s) => s.session_exercises?.athlete_sessions?.workout_id).filter(Boolean))) as string[];
  const workoutRows: any[] = [];
  for (const ids of chunk(workoutIds, IN_CHUNK)) {
    const { data } = await supabase.from("workouts").select("id, program_id, week_number, day_index, title").in("id", ids);
    workoutRows.push(...((data ?? []) as any[]));
  }
  const workoutById = new Map<string, any>(workoutRows.map((w) => [w.id, w]));
  const programIds = Array.from(new Set(workoutRows.map((w) => w.program_id).filter(Boolean))) as string[];
  const { data: programRows } = programIds.length > 0 ? await supabase.from("programs").select("id, name, athlete_id").in("id", programIds) : { data: [] as any[] };
  const programById = new Map<string, any>(((programRows ?? []) as any[]).map((p) => [p.id, p]));

  // The program's own targets for the sets that were done (reps, to tell a short set from a full one).
  const slotIds = Array.from(new Set(sets.map((s) => s.session_exercises?.group_workout_exercise_id).filter(Boolean))) as string[];
  const targetReps = new Map<string, number | null>();
  for (const ids of chunk(slotIds, IN_CHUNK)) {
    const { data } = await supabase.from("group_workout_exercise_sets").select("group_workout_exercise_id, set_order, target_reps").in("group_workout_exercise_id", ids);
    for (const t of (data ?? []) as any[]) targetReps.set(`${t.group_workout_exercise_id}:${t.set_order}`, minTargetReps(t.target_reps));
  }

  // One point per (client, workout, exercise, session): the heaviest completed set that day, and whether any set was missed.
  interface Acc { athleteId: string; groupId: string; workoutId: string; sessionId: string; completedAt: string; name: string; best: { weight: number; reps: number; rpe: number | null } | null; missed: boolean; targetRepsOfBest: number | null }
  const accs = new Map<string, Acc>();
  const painAt = new Map<string, number>();
  for (const s of sets) {
    const se = s.session_exercises;
    const sess = se?.athlete_sessions;
    if (!se || !sess || !clients.has(sess.athlete_id)) continue;
    const key = `${sess.id}::${se.exercise_name}`;
    let a = accs.get(key);
    if (!a) {
      a = { athleteId: sess.athlete_id, groupId: sess.group_id, workoutId: sess.workout_id, sessionId: sess.id, completedAt: sess.completed_at, name: se.exercise_name, best: null, missed: false, targetRepsOfBest: null };
      accs.set(key, a);
    }
    if (mentionsPain(se.athlete_note)) painAt.set(sess.athlete_id, Math.max(painAt.get(sess.athlete_id) ?? 0, new Date(sess.completed_at).getTime()));
    const target = se.group_workout_exercise_id ? targetReps.get(`${se.group_workout_exercise_id}:${s.set_order}`) ?? null : null;
    if (s.status !== "completed") {
      a.missed = true;
      continue;
    }
    if (s.weight == null || s.reps == null) continue;
    if (target != null && s.reps < target) a.missed = true;
    if (!a.best || s.weight > a.best.weight || (s.weight === a.best.weight && s.reps > a.best.reps)) {
      a.best = { weight: Number(s.weight), reps: Number(s.reps), rpe: s.rpe == null ? null : Number(s.rpe), };
      a.targetRepsOfBest = target;
    }
  }

  // Tiers and the next harder variation, from the coach's own movement patterns.
  const { data: tierRows } = await supabase
    .from("movement_pattern_exercises")
    .select("exercise_name, tier, difficulty_rank, movement_pattern_id, movement_patterns!inner ( created_by )")
    .eq("movement_patterns.created_by", coachId);
  const tierByName = new Map<string, Tier | null>();
  const ladders = new Map<string, { name: string; rank: number }[]>();
  const patternOf = new Map<string, string>();
  for (const r of (tierRows ?? []) as any[]) {
    if (!tierByName.has(r.exercise_name)) tierByName.set(r.exercise_name, r.tier);
    if (!patternOf.has(r.exercise_name)) patternOf.set(r.exercise_name, r.movement_pattern_id);
    const list = ladders.get(r.movement_pattern_id) ?? [];
    list.push({ name: r.exercise_name, rank: r.difficulty_rank ?? 0 });
    ladders.set(r.movement_pattern_id, list);
  }
  const harderOf = (name: string): string | null => {
    const pid = patternOf.get(name);
    if (!pid) return null;
    const ladder = (ladders.get(pid) ?? []).sort((a, b) => a.rank - b.rank);
    const i = ladder.findIndex((l) => l.name === name);
    return i >= 0 && i < ladder.length - 1 ? ladder[i + 1].name : null;
  };

  // A client in a deliberate deficit phase is expected to show less.
  const { data: phaseRows } = await supabase.from("nutrition_checkins").select("athlete_id, phase, created_at").in("group_id", groupIds).order("created_at", { ascending: false });
  const phaseOf = new Map<string, string>();
  for (const r of (phaseRows ?? []) as any[]) if (!phaseOf.has(r.athlete_id)) phaseOf.set(r.athlete_id, r.phase);

  // Group the points by client and workout (program + day).
  interface WorkoutAcc { athleteId: string; groupId: string; programId: string; dayIndex: number; title: string; weekNumber: number; lastAt: string; lastWorkoutId: string; byExercise: Map<string, { at: string; point: ProgressPoint; targetReps: number | null }[]> }
  const workouts = new Map<string, WorkoutAcc>();
  const doneWorkoutIds = new Map<string, Set<string>>();
  for (const a of accs.values()) {
    const w = workoutById.get(a.workoutId);
    if (!w || !a.best) continue;
    const set = doneWorkoutIds.get(a.athleteId) ?? new Set<string>();
    set.add(a.workoutId);
    doneWorkoutIds.set(a.athleteId, set);
    const key = `${a.athleteId}::${w.program_id}::${w.day_index}`;
    let acc = workouts.get(key);
    if (!acc) {
      acc = { athleteId: a.athleteId, groupId: a.groupId, programId: w.program_id, dayIndex: w.day_index, title: w.title, weekNumber: w.week_number, lastAt: a.completedAt, lastWorkoutId: a.workoutId, byExercise: new Map() };
      workouts.set(key, acc);
    }
    if (new Date(a.completedAt).getTime() >= new Date(acc.lastAt).getTime()) {
      acc.lastAt = a.completedAt;
      acc.title = w.title;
      acc.weekNumber = w.week_number;
      acc.lastWorkoutId = a.workoutId;
    }
    const list = acc.byExercise.get(a.name) ?? [];
    list.push({ at: a.completedAt, targetReps: a.targetRepsOfBest, point: { date: a.completedAt, weight: a.best.weight, reps: a.best.reps, rpe: a.best.rpe, missed: a.missed } });
    acc.byExercise.set(a.name, list);
  }

  // The next not-yet-done workout of each program day, with its exercises, so the program's next target (and where to apply an option) is known.
  const nextWorkoutByKey = new Map<string, string>();
  const laterWorkoutRows: any[] = [];
  for (const ids of chunk(programIds, IN_CHUNK)) {
    const { data } = await supabase.from("workouts").select("id, program_id, week_number, day_index").in("program_id", ids);
    laterWorkoutRows.push(...((data ?? []) as any[]));
  }
  for (const acc of workouts.values()) {
    const done = doneWorkoutIds.get(acc.athleteId) ?? new Set<string>();
    const later = laterWorkoutRows
      .filter((w) => w.program_id === acc.programId && w.day_index === acc.dayIndex && w.week_number > acc.weekNumber && !done.has(w.id))
      .sort((a, b) => a.week_number - b.week_number)[0];
    if (later) nextWorkoutByKey.set(`${acc.athleteId}::${acc.programId}::${acc.dayIndex}`, later.id);
  }
  const nextIds = Array.from(new Set(nextWorkoutByKey.values()));
  const nextExercises = new Map<string, any[]>();
  for (const ids of chunk(nextIds, IN_CHUNK)) {
    const { data } = await supabase
      .from("group_workout_exercises")
      .select("id, workout_id, exercise_name, notes, group_workout_exercise_sets ( id, set_order, target_weight, target_reps )")
      .in("workout_id", ids);
    for (const e of (data ?? []) as any[]) nextExercises.set(e.workout_id, [...(nextExercises.get(e.workout_id) ?? []), e]);
  }

  const cards: ProgressCardData[] = [];
  for (const acc of workouts.values()) {
    const client = clients.get(acc.athleteId);
    if (!client) continue;
    // Client-level and workout-level suppressions.
    if (now.getTime() - new Date(acc.lastAt).getTime() > QUIET_DAYS * DAY) continue;
    const lastTrained = Math.max(...Array.from(workouts.values()).filter((w) => w.athleteId === acc.athleteId).map((w) => new Date(w.lastAt).getTime()));
    if (now.getTime() - lastTrained > QUIET_DAYS * DAY) continue;
    const phase = phaseOf.get(acc.athleteId);
    if (phase === "fat_loss" || phase === "reverse_diet") continue;
    const pain = painAt.get(acc.athleteId);
    if (pain && now.getTime() - pain < PAIN_NOTE_DAYS * DAY) continue;
    const program = programById.get(acc.programId);
    if (/deload/i.test(acc.title) || /deload/i.test(program?.name ?? "")) continue;

    const nextId = nextWorkoutByKey.get(`${acc.athleteId}::${acc.programId}::${acc.dayIndex}`) ?? null;
    const nextForName = (name: string) => (nextId ? (nextExercises.get(nextId) ?? []).find((e) => e.exercise_name === name) ?? null : null);

    const histories: ExerciseHistory[] = [];
    for (const [name, list] of acc.byExercise) {
      const ordered = [...list].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
      const next = nextForName(name);
      const nextWeights = ((next?.group_workout_exercise_sets ?? []) as any[]).map((s) => s.target_weight).filter((w) => w != null).map(Number);
      histories.push({
        exerciseName: name,
        tier: tierByName.get(name) ?? null,
        points: ordered.map((o) => o.point),
        nextTargetWeight: nextWeights.length > 0 ? Math.max(...nextWeights) : null,
        lastTargetReps: ordered[ordered.length - 1]?.targetReps ?? null,
      });
    }
    const key = `${acc.athleteId}::${acc.programId}::${acc.dayIndex}`;
    const built = buildCards({ key, athleteId: acc.athleteId, groupId: acc.groupId, title: acc.title, lastSessionAt: acc.lastAt, histories }, threshold, hintOn);
    for (const card of built) {
      const answerKey = cardKey(acc.athleteId, acc.groupId, `${acc.programId}::${acc.dayIndex}`, card.kind);
      if (isHidden(answerKey, events, now)) continue;
      const names = Array.from(new Set([...card.flagged, ...card.others].map((l) => l.exerciseName)));
      const nextSlotByExercise: Record<string, NextSlot | null> = {};
      const harderByExercise: Record<string, string | null> = {};
      for (const n of names) {
        const e = nextForName(n);
        nextSlotByExercise[n] = e
          ? {
              exerciseId: e.id,
              workoutId: e.workout_id,
              notes: e.notes ?? null,
              sets: ((e.group_workout_exercise_sets ?? []) as any[])
                .map((s) => ({ id: s.id as string, setOrder: s.set_order as number, targetWeight: s.target_weight == null ? null : Number(s.target_weight), targetReps: (s.target_reps as string | null) ?? null }))
                .sort((x, y) => x.setOrder - y.setOrder),
            }
          : null;
        harderByExercise[n] = harderOf(n);
      }
      cards.push({ ...card, key: answerKey, clientName: client.name, programIsPersonal: program?.athlete_id === acc.athleteId, nextSlotByExercise, harderByExercise });
    }
  }
  return { cards, threshold, hintOn, truncated };
}
