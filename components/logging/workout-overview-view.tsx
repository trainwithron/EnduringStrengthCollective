import Link from "next/link";
import { StartWorkoutButton } from "@/components/logging/start-workout-button";
import { PreStartExerciseRow } from "@/components/logging/pre-start-exercise-row";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { renderNoteBody } from "@/lib/text-note-format";
import type { WorkoutOverviewData } from "@/lib/workout-overview-data";

// Shared between the athlete's own workout overview and the coach's
// "log for a client" equivalent. `backHref` and `loggingForName` are the
// only things that differ between the two contexts.
export function WorkoutOverviewView({
  data,
  groupId,
  workoutId,
  athleteId,
  backHref,
  loggingForName,
  loggedByCoach,
}: {
  data: WorkoutOverviewData;
  groupId: string;
  workoutId: string;
  athleteId: string;
  backHref: string;
  loggingForName?: string;
  loggedByCoach?: boolean;
}) {
  const { workout, exercises, dayNotes, lastTimeByExercise, videoUrlByExerciseId, goalByExerciseId, existingSession } =
    data;

  // Coach logging a session on a client's behalf sees no tab bar (they
  // aren't navigating their own athlete experience).
  const showTabBar = !loggingForName;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to program
        </Link>
        {loggingForName && (
          <p className="font-body text-xs text-rust uppercase tracking-wide mt-3">
            Logging for {loggingForName}
          </p>
        )}
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          {workout.title}
        </h1>
        {workout.notes && (
          <p className="font-body text-sm text-steel mt-3 max-w-[60ch]">{workout.notes}</p>
        )}
      </header>

      <section className="px-5 pt-6">
        {dayNotes.map((n) => (
          <div key={n.id} className="mb-3 p-3 border border-steel/20 bg-surface/40">
            <p className="font-body text-sm text-chalk whitespace-pre-wrap">
              {renderNoteBody(n.body)}
            </p>
          </div>
        ))}

        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Prescribed
        </h2>
        <div className="divide-y divide-steel/15">
          {exercises.map((ex) => (
            <PreStartExerciseRow
              key={ex.id}
              exercise={ex}
              athleteId={athleteId}
              groupId={groupId}
              videoUrl={videoUrlByExerciseId.get(ex.id) ?? ex.youtubeUrl ?? undefined}
              lastTime={lastTimeByExercise[ex.exerciseName]}
              goal={goalByExerciseId.get(ex.id)}
            />
          ))}
        </div>
      </section>

      <div
        className={`fixed ${
          showTabBar ? "bottom-16" : "bottom-0"
        } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-4`}
      >
        {existingSession ? (
          <Link
            href={`/sessions/${existingSession.id}`}
            className="block w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold text-center leading-[56px] active:bg-rust/80 transition-colors"
          >
            {existingSession.status === "completed" ? "View workout" : "Resume workout"}
          </Link>
        ) : (
          <StartWorkoutButton
            workoutId={workoutId}
            groupId={groupId}
            athleteId={athleteId}
            loggedByCoach={loggedByCoach}
            exercises={exercises.map((ex) => ({
              id: ex.id,
              exerciseName: ex.exerciseName,
              exerciseOrder: ex.exerciseOrder,
              movementPatternId: ex.movementPatternId,
              trackedFields: ex.trackedFields,
              sets: ex.sets,
              goalWeight: goalByExerciseId.get(ex.id)?.weight ?? null,
              goalReps: goalByExerciseId.get(ex.id)?.reps ?? null,
            }))}
          />
        )}
      </div>

      {showTabBar && <BottomTabBar groupId={groupId} activeOverride="workout" />}
    </main>
  );
}
