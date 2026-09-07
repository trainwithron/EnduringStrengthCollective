import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProgramBuilderDesktop } from "@/components/coach/desktop/program-builder-desktop";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { DEFAULT_TRACKED_FIELDS, mapSetRow } from "@/lib/exercise-fields";
import { computeScheduledDates, formatShortDate, isSameDay, isLocked } from "@/lib/program-schedule";
import { Lock } from "lucide-react";
import type { BuilderDay, BuilderExercise, BuilderNote } from "@/lib/types";

export default async function ProgramDetailPage({
  params,
}: {
  params: { groupId: string; programId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, description, start_date, training_days")
    .eq("id", params.programId)
    .eq("group_id", params.groupId)
    .single();

  if (!program) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  // Coach gets the full inline kanban builder (day columns, per-set
  // targets, tracked variables, video). Athletes get a simple week-grouped
  // "Log →" list — the builder treatment doesn't help logging.
  if (membership.role === "coach") {
    return (
      <CoachProgramBuilder
        groupId={params.groupId}
        programId={params.programId}
        programName={program.name}
        programDescription={program.description}
        coachId={user.id}
        startDate={program.start_date}
        trainingDays={program.training_days}
      />
    );
  }

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises(count)")
    .eq("program_id", params.programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const weeks = new Map<number, typeof workouts>();
  for (const w of workouts ?? []) {
    const list = weeks.get(w.week_number) ?? [];
    list.push(w);
    weeks.set(w.week_number, list);
  }
  const weekNumbers = Array.from(weeks.keys()).sort((a, b) => a - b);

  const scheduledDateByDayId =
    program.start_date && program.training_days && program.training_days.length > 0
      ? computeScheduledDates(program.start_date, program.training_days, workouts ?? [])
      : new Map<string, Date>();
  const today = new Date();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          {program.name}
        </h1>
        {program.description && (
          <p className="font-body text-sm text-steel mt-3 max-w-[60ch]">
            {program.description}
          </p>
        )}
        {program.start_date && program.training_days && program.training_days.length > 0 && (
          <Link
            href={`/groups/${params.groupId}/programs/${params.programId}/calendar`}
            className="inline-flex items-center h-9 mt-4 font-body text-xs text-rust border border-rust px-3"
          >
            View as calendar &rarr;
          </Link>
        )}
      </header>

      <section className="px-5 pt-6">
        {weekNumbers.length === 0 && (
          <p className="font-body text-sm text-steel py-3">No workouts assigned yet.</p>
        )}

        {weekNumbers.map((weekNum) => (
          <div key={weekNum} className="pt-6 first:pt-0">
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Week {weekNum}
            </h2>
            <div className="divide-y divide-steel/15">
              {weeks.get(weekNum)!.map((w: any) => {
                const exerciseCount = w.group_workout_exercises?.[0]?.count ?? 0;
                const scheduledDate = scheduledDateByDayId.get(w.id);
                const isToday = scheduledDate ? isSameDay(scheduledDate, today) : false;
                const locked = isLocked(scheduledDate, today);
                return (
                  <div key={w.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-medium text-[15px]">
                        {w.title}
                        {isToday && (
                          <span className="font-display text-[10px] uppercase tracking-wide text-rust ml-2 align-middle">
                            Today
                          </span>
                        )}
                      </span>
                      <span className="font-body text-xs text-steel">
                        {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"}
                      </span>
                    </div>
                    {scheduledDate && (
                      <p className="font-body text-[11px] text-steel mt-0.5">
                        {formatShortDate(scheduledDate)}
                      </p>
                    )}
                    {locked ? (
                      <span className="font-body text-xs text-steel mt-1.5 inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Unlocks {formatShortDate(scheduledDate!)}
                      </span>
                    ) : (
                      <Link
                        href={`/groups/${params.groupId}/workouts/${w.id}`}
                        className="font-body text-xs text-rust mt-1.5 inline-block"
                      >
                        Log &rarr;
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

async function CoachProgramBuilder({
  groupId,
  programId,
  programName,
  programDescription,
  coachId,
  startDate,
  trainingDays,
}: {
  groupId: string;
  programId: string;
  programName: string;
  programDescription: string | null;
  coachId: string;
  startDate: string | null;
  trainingDays: number[] | null;
}) {
  const supabase = createServerClient();

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .single();

  const { data: workoutRows } = await supabase
    .from("workouts")
    .select(
      `
      id, title, week_number, day_index,
      group_workout_exercises (
        id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes,
        group_workout_exercise_sets ( id, set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance )
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

  const { data: patternRows } = await supabase
    .from("movement_patterns")
    .select("id, name")
    .eq("created_by", coachId)
    .order("name");
  const movementPatterns = patternRows ?? [];

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
    };
  });

  return (
    <CoachDesktopShell groupId={groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <ProgramBuilderDesktop
        programId={programId}
        groupId={groupId}
        programName={programName}
        programDescription={programDescription}
        initialDays={days}
        exerciseLibrary={exerciseLibrary}
        movementPatterns={movementPatterns}
        initialStartDate={startDate}
        initialTrainingDays={trainingDays}
      />
    </CoachDesktopShell>
  );
}
