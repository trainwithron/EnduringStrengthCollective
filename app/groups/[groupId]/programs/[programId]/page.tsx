import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProgramBuilderDesktop } from "@/components/coach/desktop/program-builder-desktop";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import {
  computeScheduledDates,
  formatShortDate,
  isSameDay,
  isLocked,
  type VisibilityWindow,
} from "@/lib/program-schedule";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { computeProgramDayProgress } from "@/lib/program-day-progress";
import { ProgramProgressBanner } from "@/components/coach/program-progress-banner";
import { ProgrammingSpotterPanel } from "@/components/coach/desktop/programming-spotter-panel";
import { getProgramBuilderData } from "@/lib/program-builder-data";
import { Lock } from "lucide-react";

export default async function ProgramDetailPage(
  props: {
    params: Promise<{ groupId: string; programId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
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
    .select("id, name, description, start_date, training_days, visibility_window, ai_sequencing_notes, training_intent")
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
    return <CoachProgramBuilder groupId={params.groupId} programId={params.programId} coachId={user.id} />;
  }

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, scheduled_date, group_workout_exercises(count)")
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
      ? computeScheduledDates(
          program.start_date,
          program.training_days,
          (workouts ?? []).map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
        )
      : new Map<string, Date>();
  // This group's coach's real wall-clock day, not the server's own UTC
  // clock — see lib/timezone.ts. Otherwise a day's lock state here reads
  // early or late for anyone not in the UTC zone.
  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const today = nowInZone(timezone);

  // Day-N-of-M cumulative volume summary — only when the program has a
  // real computed calendar span; an unscheduled program has no "M" to
  // count against. Scoped to this athlete's own logged volume, since
  // "you've moved X lbs" reads as personal progress, not the whole
  // group's.
  let dayProgress: { dayNumber: number; totalDays: number } | null = null;
  let totalVolumeLbs = 0;
  if (scheduledDateByDayId.size > 0) {
    const lastScheduledDate = [...scheduledDateByDayId.values()].reduce((max, d) => (d > max ? d : max));
    dayProgress = computeProgramDayProgress(program.start_date!, lastScheduledDate, today);
    if (dayProgress) {
      const workoutIds = (workouts ?? []).map((w) => w.id);
      const { data: logRows } = await supabase
        .from("workout_logs")
        .select("total_volume")
        .eq("athlete_id", user.id)
        .in("workout_id", workoutIds);
      totalVolumeLbs = (logRows ?? []).reduce((sum, r) => sum + (r.total_volume ?? 0), 0);
    }
  }

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
        {dayProgress && (
          <ProgramProgressBanner
            programId={params.programId}
            dayNumber={dayProgress.dayNumber}
            totalDays={dayProgress.totalDays}
            totalVolumeLbs={totalVolumeLbs}
          />
        )}

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
                const locked = isLocked(scheduledDate, today, program.visibility_window);
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
  coachId,
}: {
  groupId: string;
  programId: string;
  coachId: string;
}) {
  const supabase = await createServerClient();
  const data = await getProgramBuilderData(supabase, { groupId, programId, coachId });

  if (!data) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  return (
    <CoachDesktopShell groupId={groupId} groupName={data.groupName} active="programs">
      {data.dayProgress && (
        <ProgramProgressBanner
          programId={programId}
          dayNumber={data.dayProgress.dayNumber}
          totalDays={data.dayProgress.totalDays}
          totalVolumeLbs={data.totalVolumeLbs}
        />
      )}
      <ProgrammingSpotterPanel programId={programId} flags={data.spotterFlags} />
      <ProgramBuilderDesktop
        programId={programId}
        groupId={groupId}
        programName={data.programName}
        programDescription={data.programDescription}
        aiSequencingNotes={data.aiSequencingNotes}
        initialDays={data.initialDays}
        exerciseLibrary={data.exerciseLibrary}
        exerciseAliases={data.exerciseAliases}
        exerciseTierByName={data.exerciseTierByName}
        movementPatterns={data.movementPatterns}
        laddersByPattern={data.laddersByPattern}
        initialStartDate={data.initialStartDate}
        initialTrainingDays={data.initialTrainingDays}
        initialVisibilityWindow={data.initialVisibilityWindow}
        initialTrainingIntent={data.initialTrainingIntent}
      />
    </CoachDesktopShell>
  );
}
