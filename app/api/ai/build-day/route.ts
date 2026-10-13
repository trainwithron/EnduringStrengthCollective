import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError, AiTimeoutError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { checkAndSpendCoachCredits, canRunAiAction } from "@/lib/coach-credits";
import { hasFlaggedMusculoskeletalConcern } from "@/lib/athlete-injury-flag";
import { athleteIsMinor, YOUTH_PROMPT_BLOCK } from "@/lib/youth-block";
import { libraryContext, rankLibrary, type LibraryItem } from "@/lib/builder-context";
import { matchExercise } from "@/lib/exercise-matching";
import { scanConstraints } from "@/lib/constraint-scan";
import { parseRestSeconds } from "@/lib/workout-import-parser";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import type { TrackedField } from "@/lib/exercise-fields";
import { buildDaySystemPrompt, buildDayUserText, checkRunToken, issueRunToken, readDayResult, type BuiltDay } from "@/lib/ai-day-run";

// ONE workout per call (about 10 to 20 seconds), so a long program is many short calls and none of them can hit a time limit.
export const maxDuration = 60;

const MAX_TEXT_CHARS = 2000;

// The AI Program Builder, one day at a time. Writes the day straight into the program (the builder saves as it goes, nothing reaches the client until the program is assigned) and returns
// where it went. In "build" mode it only fills a day that has no exercises (it never wipes a day); in "fix" mode it replaces the one day the coach pointed at.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ error: "The AI program builder isn't available yet." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  const week = Number(body.week);
  const day = Number(body.day);
  const mode = body.mode === "fix" ? "fix" : "build";
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, MAX_TEXT_CHARS) : "";
  const corrections: string[] = Array.isArray(body.corrections) ? body.corrections.filter((c: unknown) => typeof c === "string").map((c: string) => c.slice(0, 500)).slice(0, 20) : [];
  if (!programId || !Number.isInteger(week) || !Number.isInteger(day) || week < 1 || week > 52 || day < 1 || day > 14) {
    return NextResponse.json({ error: "Missing or invalid program, week or day." }, { status: 400 });
  }

  const { data: program } = await supabase.from("programs").select("id, group_id, athlete_id, name").eq("id", programId).maybeSingle();
  if (!program) return NextResponse.json({ error: "Program not found." }, { status: 404 });
  const groupId = program.group_id as string;
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can build programs." }, { status: 403 });

  // A run is charged once, on its first day. Later days carry the signed token instead.
  const run = checkRunToken(typeof body.runToken === "string" ? body.runToken : null, user.id, programId);
  if (!run.ok) {
    const canRun = await canRunAiAction(supabase, user.id, "program_generation");
    if (!canRun.ok) return NextResponse.json({ error: canRun.error }, { status: 402 });
  }

  // The days already in the program (so a new day knows them and does not repeat them).
  const { data: workoutRows } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises ( id, exercise_name, exercise_order, group_workout_exercise_sets ( target_reps ) )")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  const built: BuiltDay[] = [];
  let target: { id: string; title: string; hasExercises: boolean } | null = null;
  let targetBuilt: BuiltDay | null = null;
  for (const w of (workoutRows ?? []) as any[]) {
    const exs = ((w.group_workout_exercises ?? []) as any[]).slice().sort((a, b) => a.exercise_order - b.exercise_order);
    const entry: BuiltDay = {
      workoutId: w.id,
      week: w.week_number,
      day: w.day_index,
      title: w.title,
      exercises: exs.map((e) => `${e.exercise_name} ${(e.group_workout_exercise_sets ?? []).length || ""}${(e.group_workout_exercise_sets ?? [])[0]?.target_reps ? "x" + (e.group_workout_exercise_sets ?? [])[0].target_reps : ""}`.trim()),
    };
    if (w.week_number === week && w.day_index === day) {
      target = { id: w.id, title: w.title, hasExercises: exs.length > 0 };
      targetBuilt = entry;
    }
    if (exs.length > 0 && !(w.week_number === week && w.day_index === day)) built.push(entry);
  }
  if (mode === "build" && target?.hasExercises) {
    return NextResponse.json({ error: "That day already has exercises, so it was left as it is." }, { status: 409 });
  }
  if (mode === "fix" && !targetBuilt?.exercises.length) {
    return NextResponse.json({ error: "There is nothing in that day to change yet." }, { status: 409 });
  }

  // The client's injury and age context, the same rules the whole-program builder follows.
  let injuryContext: string | null = null;
  let youthBlock: string | null = null;
  const athleteId = program.athlete_id as string | null;
  if (athleteId) {
    const [{ data: intakeRow }, { data: noteRow }] = await Promise.all([
      supabase.from("client_intake").select("par_q_answers").eq("athlete_id", athleteId).maybeSingle(),
      supabase.from("athlete_notes").select("body").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    ]);
    const flagged = hasFlaggedMusculoskeletalConcern((intakeRow?.par_q_answers as any[]) ?? []);
    const noteText = noteRow?.body?.trim() || null;
    if (flagged || noteText) {
      injuryContext = `This client has flagged a musculoskeletal or health concern${flagged ? " on their intake screening" : ""}.${noteText ? ` The coach's own note: "${noteText}"` : ""}`;
    }
    if (await athleteIsMinor(supabase, athleteId)) youthBlock = YOUTH_PROMPT_BLOCK;
  }

  const [{ data: libraryRows }, { data: aliasRows }] = await Promise.all([
    supabase.from("exercise_library").select("name, category").eq("created_by", user.id).order("name").limit(3000),
    supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id),
  ]);
  const libraryItems: LibraryItem[] = (libraryRows ?? []).map((r: any) => ({ name: r.name as string, category: (r.category as string | null) ?? null, pattern: null, tier: null }));
  const shown = rankLibrary(libraryItems, `${instruction} ${corrections.join(" ")}`);
  const libraryText = libraryContext(shown, libraryItems.length);

  try {
    const text = await callClaude({
      meta: { feature: "program_day", userId: user.id },
      system: buildDaySystemPrompt({ youthBlock, hasInjury: injuryContext !== null }),
      userText: buildDayUserText({ slot: { week, day }, instruction, corrections, built, fixing: mode === "fix" ? targetBuilt : null, youthBlock, injuryContext, libraryText }),
      maxTokens: 3500,
      timeoutMs: 50_000,
    });
    const result = readDayResult(JSON.parse(extractJson(text)), `Day ${day}`);
    if (!result) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 502 });

    // Names are snapped to the coach's library when they match; a name the coach typed that is not in the library stays as written.
    const libraryList = libraryItems.map((i) => ({ name: i.name }));
    const aliases = (aliasRows ?? []).map((a: any) => ({ rawName: a.raw_name as string, exerciseName: a.exercise_name as string }));
    const rows = result.exercises.map((e) => {
      const m = matchExercise(e.exerciseName, libraryList, aliases);
      return { ...e, exerciseName: m.exerciseName ?? e.exerciseName };
    });

    // Spend once per run, only after a day really came back.
    if (!run.ok) {
      const spend = await checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation");
      if (!spend.ok) return NextResponse.json({ error: spend.error }, { status: 402 });
    }

    // Write the day: an empty day is filled, a missing day is made, a day being fixed has its exercises replaced.
    let workoutId = target?.id ?? null;
    if (!workoutId) {
      const { data: created, error: createError } = await supabase
        .from("workouts")
        .insert({ program_id: programId, group_id: groupId, title: result.title, week_number: week, day_index: day })
        .select("id")
        .single();
      if (createError || !created) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 500 });
      workoutId = created.id as string;
    }
    // A day being fixed keeps its old exercises until the new ones are safely in; only then are the old ones removed (so a failed write never leaves the day empty).
    const oldIds: string[] =
      mode === "fix" && target
        ? (((await supabase.from("group_workout_exercises").select("id").eq("workout_id", workoutId)).data ?? []) as { id: string }[]).map((r) => r.id)
        : [];
    const newIds: string[] = [];

    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const usesTime = r.timeSeconds != null;
      const usesReps = r.reps != null && r.reps !== "";
      const usesRest = parseRestSeconds(r.rest) != null;
      const trackedFields: TrackedField[] = [
        ...(usesTime && !usesReps ? DEFAULT_TRACKED_FIELDS.filter((f) => f !== "reps") : DEFAULT_TRACKED_FIELDS),
        ...(usesTime ? (["time"] as TrackedField[]) : []),
        ...(usesRest ? (["rest"] as TrackedField[]) : []),
      ];
      const { data: ex, error: exError } = await supabase
        .from("group_workout_exercises")
        .insert({ workout_id: workoutId, group_id: groupId, exercise_name: r.exerciseName, exercise_order: i, tracked_fields: trackedFields })
        .select("id")
        .single();
      if (exError || !ex) {
        failed++;
        continue;
      }
      newIds.push(ex.id as string);
      const sets = Array.from({ length: Math.max(1, r.sets) }, (_, setOrder) => ({
        group_workout_exercise_id: ex.id,
        set_order: setOrder,
        target_reps: r.reps,
        target_weight: r.weight,
        target_rpe: r.rpe,
        target_time_seconds: r.timeSeconds,
        target_rest_seconds: parseRestSeconds(r.rest) ?? null,
      }));
      const { error: setError } = await supabase.from("group_workout_exercise_sets").insert(sets);
      if (setError) failed++;
    }
    if (failed === rows.length) {
      // Nothing usable was written: remove what part-way rows there are and leave the day as it was.
      if (newIds.length > 0) await supabase.from("group_workout_exercises").delete().in("id", newIds);
      return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 500 });
    }
    if (oldIds.length > 0) await supabase.from("group_workout_exercises").delete().in("id", oldIds);

    const flags = scanConstraints(`${instruction}. ${corrections.join(". ")}`, rows.map((r) => ({ week: `Week ${week}`, day: `Day ${day}`, exerciseName: r.exerciseName, sets: r.sets, reps: r.reps, weight: r.weight, rpe: r.rpe, rest: r.rest, timeSeconds: r.timeSeconds }) as never));
    return NextResponse.json({
      workoutId,
      week,
      day,
      title: result.title,
      exerciseCount: rows.length - failed,
      flags,
      runToken: issueRunToken(user.id, programId, (run.ok ? run.days : 0) + 1, Date.now(), run.ok ? run.issuedAt : Date.now()),
    });
  } catch (err) {
    if (err instanceof AiRateLimitedError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof AiTimeoutError) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 504 });
    if (err instanceof AiTruncatedError) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 502 });
    return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 502 });
  }
}
