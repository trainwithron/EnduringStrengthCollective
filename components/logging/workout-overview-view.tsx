import Link from "next/link";
import { StartWorkoutButton } from "@/components/logging/start-workout-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import {
  TARGET_PROP,
  fieldDef,
  orderTrackedFields,
  type TrackedField,
} from "@/lib/exercise-fields";
import { renderNoteBody } from "@/lib/text-note-format";
import type { ExerciseSetTarget } from "@/lib/types";
import type { WorkoutOverviewData } from "@/lib/workout-overview-data";

function targetDisplay(set: ExerciseSetTarget, field: TrackedField): string {
  const v = set[TARGET_PROP[field] as keyof ExerciseSetTarget];
  return v === null || v === undefined ? "—" : String(v);
}

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
          {exercises.map((ex) => {
            const goal = goalByExerciseId.get(ex.id);
            const videoUrl = videoUrlByExerciseId.get(ex.id);
            return (
              <div key={ex.id} className="py-3">
                <p className="font-body font-medium text-[15px]">
                  {ex.exerciseName}
                  {ex.isOverridden && (
                    <span className="font-body text-[11px] text-steel ml-2 align-middle">
                      customized for you
                    </span>
                  )}
                </p>
                {ex.notes && <p className="font-body text-xs text-steel mt-0.5">{ex.notes}</p>}
                {lastTimeByExercise[ex.exerciseName] && (
                  <p className="font-body text-xs text-steel mt-0.5">
                    Last time: {lastTimeByExercise[ex.exerciseName].weight} &times;{" "}
                    {lastTimeByExercise[ex.exerciseName].reps}
                  </p>
                )}

                {(videoUrl || ex.youtubeUrl) && (
                  <div className="mt-2">
                    {videoUrl && (
                      <video src={videoUrl} controls className="w-full max-w-[240px] bg-graphite" />
                    )}
                    {ex.youtubeUrl && (
                      <a
                        href={ex.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-body text-xs text-rust inline-block mt-1"
                      >
                        Watch demo &rarr;
                      </a>
                    )}
                  </div>
                )}

                <div className="overflow-x-auto mt-2">
                  <div className="space-y-1 min-w-fit">
                    {orderTrackedFields(ex.trackedFields).map((field) => (
                      <div key={field} className="flex items-center gap-1.5">
                        <span className="w-14 shrink-0 font-body text-[10px] text-steel uppercase tracking-wide">
                          {fieldDef(field).label}
                        </span>
                        {ex.sets.map((s: ExerciseSetTarget) => (
                          <span
                            key={s.id}
                            className="w-12 h-7 flex items-center justify-center bg-surface/60 font-body text-xs text-chalk shrink-0"
                          >
                            {targetDisplay(s, field)}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {goal && (goal.weight != null || goal.reps != null) && (
                  <p className="font-body text-xs text-rust mt-1.5">
                    Goal: {goal.weight != null ? `${goal.weight} lbs` : ""}
                    {goal.weight != null && goal.reps != null ? " × " : ""}
                    {goal.reps != null ? `${goal.reps} reps` : ""}
                  </p>
                )}
              </div>
            );
          })}
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
