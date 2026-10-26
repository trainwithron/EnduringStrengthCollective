import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError, AiTimeoutError } from "@/lib/anthropic-client";
import { AiRateLimitedError, freeTierOutMessage } from "@/lib/ai-usage";
import { checkAndSpendCoachCredits, canRunAiAction } from "@/lib/coach-credits";
import { freeTierMeter, takeFreeTierUse } from "@/lib/free-tier-server";
import { athleteAgeStatus, effectiveAgeStatus, UNKNOWN_AGE_BANNER_TEXT, YOUTH_PROMPT_BLOCK } from "@/lib/youth-block";
import { resolveAiExerciseName, plainLibraryName } from "@/lib/ai-day-rules";
import { isBadExerciseName } from "@/lib/exercise-name-guard";
import { existingLibraryName } from "@/lib/exercise-search";
import { chunk } from "@/lib/chunk";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import {
  EDIT_SYSTEM_PROMPT,
  applyWeekEdits,
  chargedPreview,
  checkPlanAgainstProgram,
  editUserText,
  planWeekEdits,
  previewLines,
  readAiChanges,
  readPlan,
  resolveWeeks,
  type EditDb,
  type PlanDay,
  type SnapshotExercise,
  type WeekRange,
} from "@/lib/ai-week-edit";

export const maxDuration = 60;

const MAX_TEXT_CHARS = 2000;
const COULDNT = "Couldn't work out those changes. Try saying it another way.";

// The AI Program Builder changing days that are already built (lib/ai-week-edit.ts). "preview": the AI reads the coach's words and the app works out every change, day by day; NOTHING is written.
// "apply": the plan the coach saw is checked again against the program as it is now (only this program's days, never a day a client has started since) and written, all of it or none of it.
// A program clients already follow can be changed here (unlike the day builder, which writes as it goes): the coach sees every change and presses Apply, and a day a client has started is never touched.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  const mode = body.mode === "apply" ? "apply" : "preview";
  if (!programId) return NextResponse.json({ error: "Missing program." }, { status: 400 });

  const { data: program } = await supabase.from("programs").select("id, group_id, athlete_id").eq("id", programId).maybeSingle();
  if (!program) return NextResponse.json({ error: "Program not found." }, { status: 404 });
  const groupId = program.group_id as string;
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can change programs." }, { status: 403 });

  // This program's days as they are now, with every set, and which days a client has started.
  const read = await readProgramDays(supabase, programId);
  if (!read) return NextResponse.json({ error: "Couldn't read the program. Try again." }, { status: 503 });
  const { days, snapshot } = read;

  // A young client (or one with no birthdate on file): edited sets never go above RPE 8, as when the days were built.
  const athleteId = program.athlete_id as string | null;
  let youth = false;
  let unknownAge = false;
  if (athleteId) {
    const status = effectiveAgeStatus(await athleteAgeStatus(supabase, athleteId), athleteId === user.id);
    youth = status !== "adult";
    unknownAge = status === "unknown";
  }

  if (mode === "apply") {
    const checked = checkPlanAgainstProgram(readPlan(body.plan, youth), days);
    if (checked.foreign) return NextResponse.json({ error: "The program changed since the preview. Ask again to see the changes." }, { status: 409 });
    if (checked.plan.length === 0) return NextResponse.json({ error: checked.skipped.length > 0 ? "Every day in the preview has been started since, so nothing was changed." : "Nothing to change." , skipped: checked.skipped }, { status: 409 });
    const result = await applyWeekEdits(supabaseEditDb(supabase), checked.plan, snapshot, groupId);
    if (!result.ok) return NextResponse.json({ error: "Couldn't save those changes, so nothing was changed. Try Apply again." }, { status: 500 });
    return NextResponse.json({ changedWorkoutIds: result.changedWorkoutIds, skipped: checked.skipped });
  }

  if (!isAiConfigured()) return NextResponse.json({ error: "The AI program builder isn't available yet." }, { status: 503 });
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, MAX_TEXT_CHARS) : "";
  const corrections: string[] = Array.isArray(body.corrections) ? body.corrections.filter((c: unknown) => typeof c === "string").map((c: string) => c.slice(0, 500)).slice(0, 10) : [];
  const range = readRange(body.range);
  if (!instruction.trim() || !range) return NextResponse.json({ error: "Say what to change and which weeks." }, { status: 400 });
  // The weeks it reaches: "rest of the program" starts after the last week a client has started.
  const weeks = resolveWeeks(range, days.map((d) => d.week), days.filter((d) => d.started).map((d) => d.week));
  const inRange = days.filter((d) => weeks.includes(d.week) && d.exercises.length > 0);
  if (inRange.length === 0) return NextResponse.json({ error: "Those weeks have no built days to change." }, { status: 409 });

  const sayings = `${instruction}. ${corrections.join(". ")}`;
  const [{ data: libraryRows }, { data: aliasRows }] = await Promise.all([
    supabase.from("exercise_library").select("name").eq("created_by", user.id).order("name").limit(3000),
    supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id),
  ]);
  const libraryNames = ((libraryRows ?? []) as { name: string }[]).map((r) => r.name).filter((n) => !isBadExerciseName(n));
  const libraryList = libraryNames.map((name) => ({ name }));
  const aliases = ((aliasRows ?? []) as { raw_name: string; exercise_name: string }[]).map((a) => ({ rawName: a.raw_name, exerciseName: a.exercise_name }));
  // A new exercise's name is snapped to the coach's library the way the day builder does (the coach's own words stay as written unless the library has the very same exercise).
  const cleanName = (name: string) => resolveAiExerciseName({ exerciseName: name }, sayings, libraryList, aliases, (n) => plainLibraryName(n, libraryNames)).name;

  try {
    const outcome = await chargedPreview({
      canRun: async () => {
        const can = await canRunAiAction(supabase, user.id, "program_generation");
        if (!can.ok) return can;
        const meter = await freeTierMeter(createServiceRoleClient(), user.id);
        return meter.freeTier && meter.left <= 0 ? { ok: false, error: freeTierOutMessage() } : { ok: true };
      },
      ask: async () => {
        const text = await callClaude({
          meta: { feature: "program_edit", userId: user.id },
          system: EDIT_SYSTEM_PROMPT,
          userText: editUserText({ instruction, corrections, days: inRange, youthBlock: youth ? YOUTH_PROMPT_BLOCK : null }),
          maxTokens: 3000,
          timeoutMs: 45_000,
        });
        const answer = readAiChanges(JSON.parse(extractJson(text)));
        const plan = planWeekEdits({ changes: answer.changes, days, weeks, youth, cleanName });
        return { answer, plan };
      },
      hasChanges: (r) => r.plan.days.length > 0,
      spend: async () => {
        const free = await takeFreeTierUse(createServiceRoleClient(), user.id, "program");
        if (!free.ok) return { ok: false, error: free.error };
        return checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation");
      },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const { answer, plan } = outcome.result;
    if (plan.days.length === 0) {
      // Nothing to change (or only a question back): never charged.
      const why = answer.question ?? (plan.skipped.length > 0 ? "Every day those changes touch has already been started, so there is nothing to change." : "I couldn't find those exercises in those weeks. Name them as they appear in the program.");
      return NextResponse.json({ question: why, skipped: plan.skipped, lines: [], plan: [] });
    }
    const flags = [...plan.flags];
    for (const d of plan.days) {
      for (const o of d.ops) {
        const n = o.op === "add" ? o.name : o.op === "swap" ? o.newName : null;
        if (n && !existingLibraryName(n, libraryNames)) flags.push(`${n} is not in your library.`);
      }
    }
    if (unknownAge) flags.push(UNKNOWN_AGE_BANNER_TEXT);
    return NextResponse.json({ lines: previewLines(plan), skipped: plan.skipped, flags: [...new Set(flags)].slice(0, 8), plan: plan.days });
  } catch (err) {
    if (err instanceof AiRateLimitedError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof AiTimeoutError || err instanceof AiTruncatedError) return NextResponse.json({ error: COULDNT }, { status: 504 });
    return NextResponse.json({ error: COULDNT }, { status: 502 });
  }
}

// The weeks as the browser sends them (read from the coach's words there, lib/ai-week-edit.ts parseWeekRange).
function readRange(raw: unknown): WeekRange | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; from?: unknown; to?: unknown };
  if (r.kind === "all" || r.kind === "rest") return { kind: r.kind };
  if (r.kind !== "weeks") return null;
  const from = Number(r.from);
  const to = r.to == null ? null : Number(r.to);
  if (!Number.isInteger(from) || from < 1 || from > 52) return null;
  if (to != null && (!Number.isInteger(to) || to < from || to > 52)) return null;
  return { kind: "weeks", from, to };
}

async function readProgramDays(supabase: Awaited<ReturnType<typeof createServerClient>>, programId: string): Promise<{ days: PlanDay[]; snapshot: Map<string, SnapshotExercise[]> } | null> {
  const { data: rows, error } = await supabase
    .from("workouts")
    .select("id, week_number, day_index, group_workout_exercises ( id, exercise_name, display_name, exercise_order, group_workout_exercise_sets ( * ) )")
    .eq("program_id", programId);
  if (error) return null;
  const workoutIds = ((rows ?? []) as { id: string }[]).map((w) => w.id);
  // A day any client has started (or logged) is never changed. Read as the server, not as the coach: a session the coach's own view does not show (another organization's header, another group)
  // must still count as started. Only after the coach check above, read only, only these days' ids. Asked 100 days at a time; a failed read means nothing is changed.
  const admin = createServiceRoleClient();
  const started = new Set<string>();
  for (const part of chunk(workoutIds, 100)) {
    const { data, error: sessionError } = await admin.from("athlete_sessions").select("workout_id").in("workout_id", part);
    if (sessionError) return null;
    for (const s of (data ?? []) as { workout_id: string }[]) started.add(s.workout_id);
  }
  const days: PlanDay[] = [];
  const snapshot = new Map<string, SnapshotExercise[]>();
  for (const w of (rows ?? []) as any[]) {
    const exercises: SnapshotExercise[] = ((w.group_workout_exercises ?? []) as any[]).map((e) => ({
      id: e.id as string,
      name: e.exercise_name as string,
      displayName: (e.display_name as string | null) ?? null,
      order: (e.exercise_order as number | null) ?? 0,
      sets: ((e.group_workout_exercise_sets ?? []) as any[])
        .map((s) => ({ id: s.id as string, setOrder: (s.set_order as number | null) ?? 0, reps: (s.target_reps as string | null) ?? null, weight: (s.target_weight as number | null) ?? null, rpe: (s.target_rpe as number | null) ?? null, row: s as Record<string, unknown> }))
        .sort((a, b) => a.setOrder - b.setOrder),
    }));
    snapshot.set(w.id, exercises);
    days.push({ workoutId: w.id, week: w.week_number, day: w.day_index, started: started.has(w.id), exercises: exercises.map((e) => ({ id: e.id, name: e.name, order: e.order, sets: e.sets })) });
  }
  return { days, snapshot };
}

function supabaseEditDb(supabase: Awaited<ReturnType<typeof createServerClient>>): EditDb {
  return {
    async updateSet(id, values) {
      const { error } = await supabase.from("group_workout_exercise_sets").update(values).eq("id", id);
      return !error;
    },
    async insertSets(rows) {
      const { data, error } = await supabase.from("group_workout_exercise_sets").insert(rows).select("id");
      return error ? null : ((data ?? []) as { id: string }[]).map((r) => r.id);
    },
    async insertExercise(row) {
      const { data, error } = await supabase.from("group_workout_exercises").insert({ tracked_fields: DEFAULT_TRACKED_FIELDS, ...row }).select("id").single();
      return error || !data ? null : (data.id as string);
    },
    async updateExercise(id, values) {
      const { error } = await supabase.from("group_workout_exercises").update(values).eq("id", id);
      return !error;
    },
    async deleteExercises(ids) {
      const { error } = await supabase.from("group_workout_exercises").delete().in("id", ids);
      return !error;
    },
    async deleteSets(ids) {
      const { error } = await supabase.from("group_workout_exercise_sets").delete().in("id", ids);
      return !error;
    },
  };
}
