import { NextResponse } from "next/server";
import { isBadExerciseName, cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";
import { existingLibraryName } from "@/lib/exercise-search";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError, AiTimeoutError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { checkAndSpendCoachCredits, canRunAiAction } from "@/lib/coach-credits";
import { hasFlaggedMusculoskeletalConcern } from "@/lib/athlete-injury-flag";
import { athleteAgeStatus, clampYouthRows, effectiveAgeStatus, UNKNOWN_AGE_BANNER_TEXT, YOUTH_PROMPT_BLOCK } from "@/lib/youth-block";
import { libraryContext, rankLibrary, type LibraryItem } from "@/lib/builder-context";
import { scanConstraints } from "@/lib/constraint-scan";
import { parseRestSpan } from "@/lib/rest-time";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import type { TrackedField } from "@/lib/exercise-fields";
import { learnedBlock, linesFor, loadApplicableRules, toApplied } from "@/lib/learned-for-prompt";
import { loadNotesBlock } from "@/lib/client-notes-server";
import { loadReferenceBlock } from "@/lib/reference-context";
import { resolveAiExerciseName, exercisesWanted, allowsRepeats, applyTimedConsistency, dedupeDay, isMobilityTitle, longDayFlag, mobilityDaysWanted, mobilityInstruction, mobilityRole, plainLibraryName, ruleKey } from "@/lib/ai-day-rules";
import { DAY_MAX_TOKENS, TOO_LONG_MESSAGE, TRUNCATED_RETRY_NOTE, buildDaySystemPrompt, buildDayUserText, checkRunToken, issueRunToken, readDayResult, runTokenIsStale, truncatedRetryTimeoutMs, type BuiltDay } from "@/lib/ai-day-run";

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

  // A run is charged once, on its first day. Later days carry the signed token instead. A token is also checked against the log: if more days were built under it than it counts (it was used again
  // after a newer one was issued) it is stale, and the run is charged as a new one.
  const startedAt = Date.now();
  let run = checkRunToken(typeof body.runToken === "string" ? body.runToken : null, user.id, programId);
  if (run.ok) {
    const { count } = await createServiceRoleClient()
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("feature", "program_day")
      .neq("status", "error")
      // A day that came back cut off was never built, so it is not a day under this token.
      .neq("status", "truncated")
      .gte("created_at", new Date(run.issuedAt).toISOString());
    if (runTokenIsStale(count ?? 0, run.days)) run = { ok: false };
  }
  if (!run.ok) {
    const canRun = await canRunAiAction(supabase, user.id, "program_generation");
    if (!canRun.ok) return NextResponse.json({ error: canRun.error }, { status: 402 });
  }

  // The days already in the program (so a new day knows them and does not repeat them).
  const { data: workoutRows } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises ( id, exercise_name, exercise_order, group_workout_exercise_sets ( target_reps, target_time_seconds ) )")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  const built: BuiltDay[] = [];
  const knownTimes = new Map<string, number>();
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
    if (!(w.week_number === week && w.day_index === day)) {
      for (const e of exs) {
        const t = ((e.group_workout_exercise_sets ?? [])[0]?.target_time_seconds as number | null | undefined) ?? null;
        if (t && t > 0 && !knownTimes.has(ruleKey(e.exercise_name))) knownTimes.set(ruleKey(e.exercise_name), t);
      }
    }
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

  // How many of this week's days the coach wants as mobility days, and so whether this one must be, must not be, or is free.
  const sayings = `${instruction}. ${corrections.join(". ")}`;
  const wantedMobility = mobilityDaysWanted(sayings);
  const weekRowsAll = ((workoutRows ?? []) as any[]).filter((w) => w.week_number === week);
  const builtMobility = weekRowsAll.filter((w) => !(w.day_index === day) && (w.group_workout_exercises ?? []).length > 0 && isMobilityTitle(w.title ?? "")).length;
  const daysLeft = weekRowsAll.filter((w) => w.day_index !== day && (w.group_workout_exercises ?? []).length === 0).length + 1;
  const role = mobilityRole({ wanted: wantedMobility, builtMobility, daysLeft });
  const mobilityNote = mobilityInstruction(role, wantedMobility);

  // The client's injury and age context, the same rules the whole-program builder follows.
  let injuryContext: string | null = null;
  let youthBlock: string | null = null;
  let youthUnknownAge = false;
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
    // Under 18, or no birthdate on file: the youth protections apply (an unknown age is never treated as an adult).
    const ageStatus = effectiveAgeStatus(await athleteAgeStatus(supabase, athleteId), athleteId === user.id);
    if (ageStatus !== "adult") youthBlock = YOUTH_PROMPT_BLOCK;
    if (ageStatus === "unknown") youthUnknownAge = true;
  }

  // What the coach has taught the AI that fits THIS client (the client's notes, level and age band decide which rules reach it).
  const taughtRules = await loadApplicableRules(supabase, user.id, athleteId);
  const taught = learnedBlock(linesFor(taughtRules));
  const notes = await loadNotesBlock(supabase, user.id, athleteId);
  const referenceId = typeof body.referenceClientId === "string" && /^[0-9a-f-]{36}$/i.test(body.referenceClientId) ? body.referenceClientId : null;
  const reference = await loadReferenceBlock(supabase, user.id, referenceId, groupId);
  const [{ data: libraryRows }, { data: aliasRows }] = await Promise.all([
    supabase.from("exercise_library").select("name, category").eq("created_by", user.id).order("name").limit(3000),
    supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id),
  ]);
  const libraryItems: LibraryItem[] = (libraryRows ?? []).filter((r: any) => !isBadExerciseName(r.name as string)).map((r: any) => ({ name: r.name as string, category: (r.category as string | null) ?? null, pattern: null, tier: null }));
  const shown = rankLibrary(libraryItems, `${instruction} ${corrections.join(" ")}`);
  const libraryText = libraryContext(shown, libraryItems.length);

  // Names are snapped to the coach's library when they match (to its plainest name for the movement); a name the coach typed that is not in the library stays as written.
  const libraryList = libraryItems.map((i) => ({ name: i.name }));
  const libraryNames = libraryItems.map((i) => i.name);
  const aliases = (aliasRows ?? []).map((a: any) => ({ rawName: a.raw_name as string, exerciseName: a.exercise_name as string }));
  const allowRepeat = allowsRepeats(sayings);

  async function attempt(retryNote: string | null, timeoutMs: number) {
    const text = await callClaude({
      meta: { feature: "program_day", userId: user!.id },
      system: buildDaySystemPrompt({ youthBlock, hasInjury: injuryContext !== null }),
      userText: buildDayUserText({ slot: { week, day }, instruction, corrections, built, fixing: mode === "fix" ? targetBuilt : null, youthBlock, injuryContext, libraryText, mobilityNote, retryNote, learnedBlock: taught, notesBlock: notes, referenceBlock: reference }),
      maxTokens: DAY_MAX_TOKENS,
      timeoutMs,
    });
    const parsed = readDayResult(JSON.parse(extractJson(text)), `Day ${day}`);
    if (!parsed) return null;
    // An exercise the coach named stays exactly as named (the library never renames it); only the ones the AI chose are snapped to the library, and only on a confident match.
    const snapped = parsed.exercises
      .map((e) => {
        const r = resolveAiExerciseName(e, sayings, libraryList, aliases, (n) => plainLibraryName(n, libraryNames));
        // No control characters in a name, spaces tidied; a name that is empty, only numbers or carrying sets and reps is not an exercise and is left out (it would be refused when saved).
        return { ...e, exerciseName: cleanExerciseName(r.name.replace(/[\u0000-\u001f\u007f]/g, " ")), coachNamed: r.coachNamed };
      })
      .filter((e) => !exerciseNameProblem(e.exerciseName));
    const timed = applyTimedConsistency(dedupeDay(snapped, allowRepeat).rows, knownTimes);
    // A young client (or one with no birthdate on file) never gets more than RPE 8 whatever the model wrote; reps outside the moderate range are noted for the coach.
    const youthPass = youthBlock ? clampYouthRows(timed) : { rows: timed, flags: [] as string[] };
    const tidy = youthPass.rows;
    // The coach's own named exercises are never flagged or replaced by the "worth a look" checks.
    const scan = scanConstraints(sayings, tidy.filter((r) => !r.coachNamed).map((r) => ({ week: `Week ${week}`, day: `Day ${day}`, exerciseName: r.exerciseName, sets: r.sets, reps: r.reps, weight: r.weight, rpe: r.rpe, rest: r.rest, timeSeconds: r.timeSeconds }) as never));
    return { result: { ...parsed, exercises: tidy }, rows: tidy, scan, youthFlags: youthPass.flags };
  }
  // A flag that says a chosen exercise breaks something the coach said to leave out (not the softer "check this" notes).
  const isHard = (flag: string) => /conflicts with "no |which your description said to leave out/.test(flag);

  try {
    let first;
    try {
      first = await attempt(null, 50_000);
    } catch (err) {
      // Cut off at the length limit: write the day once more, shorter (never charged; the coach is charged only after a day really comes back).
      if (!(err instanceof AiTruncatedError)) throw err;
      const retryTimeout = truncatedRetryTimeoutMs(Date.now() - startedAt);
      if (retryTimeout === null) return NextResponse.json({ error: TOO_LONG_MESSAGE }, { status: 502 });
      first = await attempt(TRUNCATED_RETRY_NOTE, retryTimeout);
    }
    if (!first) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 502 });
    // One automatic retry when the day breaks something the coach said to leave out, if there is time left in this request.
    const hard = first.scan.filter(isHard);
    const elapsed = Date.now() - startedAt;
    if (hard.length > 0 && elapsed <= 28_000) {
      try {
        const second = await attempt(`Your last try for this day broke what the coach said to leave out: ${hard.join(" ")} Write the day again without those.`, Math.max(15_000, 55_000 - elapsed - 4_000));
        if (second && second.scan.filter(isHard).length <= hard.length) first = second;
      } catch {
        // the first try stands, with its notes
      }
    }
    const result = first.result;
    const rows = first.rows;
    const dayTitle = role === "must" && !isMobilityTitle(result.title) ? "Mobility" : result.title;

    // Write the day: an empty day is filled, a missing day is made, a day being fixed has its exercises replaced.
    let workoutId = target?.id ?? null;
    let madeWorkout = false;
    if (!workoutId) {
      const { data: created, error: createError } = await supabase
        .from("workouts")
        .insert({ program_id: programId, group_id: groupId, title: dayTitle, week_number: week, day_index: day })
        .select("id")
        .single();
      if (createError || !created) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 500 });
      workoutId = created.id as string;
      madeWorkout = true;
    }
    // An empty day that already exists with a placeholder name ("Day 2") takes the purpose name the day was given.
    if (target && mode === "build" && /^(day\s*\d*)?$/i.test((target.title ?? "").trim()) && !/^day\s*\d*$/i.test(dayTitle.trim())) {
      await supabase.from("workouts").update({ title: dayTitle }).eq("id", workoutId);
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
      const restSpan = parseRestSpan(r.rest);
      const usesRest = restSpan != null;
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
        target_rest_seconds: restSpan?.low ?? null,
        target_rest_max_seconds: restSpan?.high ?? null,
      }));
      const { error: setError } = await supabase.from("group_workout_exercise_sets").insert(sets);
      if (setError) failed++;
    }
    // Put the day back the way it was: what this try wrote is removed, and a day this try made is removed too. The old exercises of a day being fixed are never touched until everything new is in.
    const undoWrite = async () => {
      if (newIds.length > 0) await supabase.from("group_workout_exercises").delete().in("id", newIds);
      if (madeWorkout && workoutId) await supabase.from("workouts").delete().eq("id", workoutId);
    };
    if (failed > 0) {
      await undoWrite();
      return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 500 });
    }
    // The credit is spent once per run, only now that the whole day is really written.
    if (!run.ok) {
      const spend = await checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation");
      if (!spend.ok) {
        await undoWrite();
        return NextResponse.json({ error: spend.error }, { status: 402 });
      }
    }
    if (oldIds.length > 0) await supabase.from("group_workout_exercises").delete().in("id", oldIds);

    const longDay = longDayFlag(week, day, rows.length, exercisesWanted(sayings));
    const flags = scanConstraints(`${instruction}. ${corrections.join(". ")}`, rows.filter((r) => !r.coachNamed).map((r) => ({ week: `Week ${week}`, day: `Day ${day}`, exerciseName: r.exerciseName, sets: r.sets, reps: r.reps, weight: r.weight, rpe: r.rpe, rest: r.rest, timeSeconds: r.timeSeconds }) as never));
    if (longDay) flags.push(longDay);
    flags.push(...(first.youthFlags ?? []));
    // Exercises the AI chose that are not in the coach's library are said so (they are kept as written; the coach decides).
    for (const r of rows) {
      if (!r.coachNamed && !existingLibraryName(r.exerciseName, libraryNames)) flags.push(`${r.exerciseName} is not in your library.`);
    }
    if (youthUnknownAge) flags.push(UNKNOWN_AGE_BANNER_TEXT);
    return NextResponse.json({
      workoutId,
      week,
      day,
      title: dayTitle,
      exerciseCount: rows.length,
      flags,
      // The rules used for this day, shown to the coach with their reason and an Undo.
      applied: toApplied(taughtRules),
      runToken: issueRunToken(user.id, programId, (run.ok ? run.days : 0) + 1, Date.now(), run.ok ? run.issuedAt : startedAt),
    });
  } catch (err) {
    if (err instanceof AiRateLimitedError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof AiTimeoutError) return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 504 });
    if (err instanceof AiTruncatedError) return NextResponse.json({ error: TOO_LONG_MESSAGE }, { status: 502 });
    return NextResponse.json({ error: "Couldn't build that day. Try Resume, or tell it what to change." }, { status: 502 });
  }
}
