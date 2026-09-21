import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TRACKED_FIELDS, mapSetRow } from "./exercise-fields";
import { computeScheduledDates, type VisibilityWindow } from "./program-schedule";
import { getGroupCoachTimezone, nowInZone } from "./timezone";
import { computeProgramDayProgress } from "./program-day-progress";
import { gatherProgrammingSpotterFlags, type SpotterFlag } from "./programming-spotter-gather";
import type { BuilderDay, BuilderExercise, BuilderNote } from "./types";
import type { TrainingIntent } from "./training-intent";
import type { AliasEntry } from "./exercise-matching";
import type { MovementPatternOption } from "@/components/coach/exercise-builder-card";

// Extracted from app/groups/[groupId]/programs/[programId]/page.tsx's
// CoachProgramBuilder — the real ~15-query data assembly the coach
// builder page needs, pulled into one shared, reusable function so a
// second consumer (the embedded builder inside ShellListPanel,
// via the /api/coach/program-builder-data route) doesn't have to
// duplicate it. Byte-for-byte the same queries/shape the page already
// used; the page itself now just calls this.
export interface ProgramBuilderData {
  groupId: string;
  groupName: string;
  programId: string;
  programName: string;
  programDescription: string | null;
  aiSequencingNotes: string | null;
  initialDays: BuilderDay[];
  exerciseLibrary: string[];
  exerciseAliases: AliasEntry[];
  exerciseTierByName: Record<string, "A" | "B" | "C" | null>;
  movementPatterns: MovementPatternOption[];
  laddersByPattern: Record<string, { exerciseName: string }[]>;
  initialStartDate: string | null;
  initialTrainingDays: number[] | null;
  initialVisibilityWindow: VisibilityWindow;
  initialTrainingIntent: TrainingIntent | null;
  dayProgress: { dayNumber: number; totalDays: number } | null;
  totalVolumeLbs: number;
  spotterFlags: SpotterFlag[];
}

export async function getProgramBuilderData(
  supabase: SupabaseClient,
  { groupId, programId, coachId }: { groupId: string; programId: string; coachId: string }
): Promise<ProgramBuilderData | null> {
  const { data: program } = await supabase
    .from("programs")
    .select("id, name, description, start_date, training_days, visibility_window, ai_sequencing_notes, training_intent")
    .eq("id", programId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!program) return null;

  const startDate = program.start_date;
  const trainingDays = program.training_days;
  const visibilityWindow = program.visibility_window as VisibilityWindow;
  const trainingIntent = program.training_intent as TrainingIntent | null;

  const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).single();

  const { data: workoutRows } = await supabase
    .from("workouts")
    .select(
      `
      id, title, week_number, day_index, scheduled_date,
      group_workout_exercises (
        id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes,
        group_workout_exercise_sets ( id, set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max )
      ),
      workout_notes ( id, body, position )
    `
    )
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("name, video_path, youtube_url")
    .eq("created_by", coachId);

  const mediaByName = new Map<string, { videoPath: string | null; youtubeUrl: string | null }>();
  for (const row of libraryRows ?? []) {
    mediaByName.set(row.name, { videoPath: row.video_path, youtubeUrl: row.youtube_url });
  }
  const exerciseLibrary = Array.from(mediaByName.keys()).sort();

  const { data: aliasRows } = await supabase
    .from("exercise_aliases")
    .select("raw_name, exercise_name")
    .eq("coach_id", coachId);
  const exerciseAliases = (aliasRows ?? []).map((a) => ({
    rawName: a.raw_name,
    exerciseName: a.exercise_name,
  }));

  const { data: patternRows } = await supabase
    .from("movement_patterns")
    .select("id, name")
    .eq("created_by", coachId)
    .order("name");
  const movementPatterns = patternRows ?? [];

  const { data: tierRows } = await supabase
    .from("movement_pattern_exercises")
    .select("exercise_name, tier, movement_patterns!inner ( created_by )")
    .eq("movement_patterns.created_by", coachId);
  const tierByName = new Map<string, "A" | "B" | "C" | null>();
  for (const row of (tierRows ?? []) as any[]) {
    if (!tierByName.has(row.exercise_name)) tierByName.set(row.exercise_name, row.tier);
  }

  const laddersByPattern: Record<string, { exerciseName: string }[]> = {};
  const patternIds = (patternRows ?? []).map((p) => p.id);
  if (patternIds.length > 0) {
    const { data: ladderRows } = await supabase
      .from("movement_pattern_exercises")
      .select("movement_pattern_id, exercise_name, difficulty_rank")
      .in("movement_pattern_id", patternIds)
      .order("difficulty_rank", { ascending: true });
    for (const row of ladderRows ?? []) {
      const list = laddersByPattern[row.movement_pattern_id] ?? [];
      list.push({ exerciseName: row.exercise_name });
      laddersByPattern[row.movement_pattern_id] = list;
    }
  }

  const days: BuilderDay[] = (workoutRows ?? []).map((w: any) => {
    const exerciseItems: BuilderExercise[] = (w.group_workout_exercises ?? []).map((ex: any) => {
      const media = mediaByName.get(ex.exercise_name);
      return {
        kind: "exercise" as const,
        id: ex.id,
        order: ex.exercise_order,
        exerciseName: ex.exercise_name,
        movementPatternId: ex.movement_pattern_id,
        trackedFields: ex.tracked_fields ?? DEFAULT_TRACKED_FIELDS,
        notes: ex.notes,
        videoPath: media?.videoPath ?? null,
        youtubeUrl: media?.youtubeUrl ?? null,
        tier: tierByName.get(ex.exercise_name) ?? null,
        sets: (ex.group_workout_exercise_sets ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map(mapSetRow),
      };
    });

    const noteItems: BuilderNote[] = (w.workout_notes ?? []).map((n: any) => ({
      kind: "note" as const,
      id: n.id,
      order: n.position,
      body: n.body,
    }));

    return {
      id: w.id,
      title: w.title,
      weekNumber: w.week_number,
      dayIndex: w.day_index,
      items: [...exerciseItems, ...noteItems],
      scheduledDate: w.scheduled_date,
    };
  });

  let dayProgress: { dayNumber: number; totalDays: number } | null = null;
  let totalVolumeLbs = 0;
  if (startDate && trainingDays && trainingDays.length > 0 && workoutRows && workoutRows.length > 0) {
    const scheduledDateByDayId = computeScheduledDates(
      startDate,
      trainingDays,
      workoutRows.map((w: any) => ({ id: w.id, scheduledDate: w.scheduled_date }))
    );
    if (scheduledDateByDayId.size > 0) {
      const lastScheduledDate = [...scheduledDateByDayId.values()].reduce((max, d) => (d > max ? d : max));
      const timezone = await getGroupCoachTimezone(supabase, groupId);
      dayProgress = computeProgramDayProgress(startDate, lastScheduledDate, nowInZone(timezone));
      if (dayProgress) {
        const workoutIds = workoutRows.map((w) => w.id);
        const { data: logRows } = await supabase
          .from("workout_logs")
          .select("total_volume")
          .in("workout_id", workoutIds);
        totalVolumeLbs = (logRows ?? []).reduce((sum, r) => sum + (r.total_volume ?? 0), 0);
      }
    }
  }

  const spotterFlags = await gatherProgrammingSpotterFlags(supabase, {
    programId,
    programName: program.name,
    coachId,
  });

  return {
    groupId,
    groupName: group?.name ?? "Coaching",
    programId,
    programName: program.name,
    programDescription: program.description,
    aiSequencingNotes: program.ai_sequencing_notes,
    initialDays: days,
    exerciseLibrary,
    exerciseAliases,
    exerciseTierByName: Object.fromEntries(tierByName),
    movementPatterns,
    laddersByPattern,
    initialStartDate: startDate,
    initialTrainingDays: trainingDays,
    initialVisibilityWindow: visibilityWindow,
    initialTrainingIntent: trainingIntent,
    dayProgress,
    totalVolumeLbs,
    spotterFlags,
  };
}
