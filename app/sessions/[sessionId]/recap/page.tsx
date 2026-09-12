import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionRecap } from "@/lib/session-recap-data";
import { getWorkoutOverviewData, type WorkoutOverviewExercise } from "@/lib/workout-overview-data";
import { findMostRecentCoachNoteForExercise } from "@/lib/exercise-note-history";
import { RecapAndUpNext } from "@/components/coach/desktop/recap-and-up-next";

// Coach-only. The athlete's own completed-session view
// (app/sessions/[sessionId]/page.tsx) is a separate, unchanged route —
// this is purely additive, reached from the client profile's logged-
// workout history, never linked from anything an athlete sees.
export default async function SessionRecapPage(props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("athlete_sessions")
    .select("id, group_id, athlete_id, status")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (!session) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">That session doesn&apos;t exist.</p>
      </main>
    );
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", session.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view this.</p>
      </main>
    );
  }

  if (session.status !== "completed") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This session isn&apos;t completed yet — recap is only available once it&apos;s finished.
        </p>
      </main>
    );
  }

  const recap = await getSessionRecap(supabase, params.sessionId);
  if (!recap) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Couldn&apos;t load this session.</p>
      </main>
    );
  }

  // "Next" resolved the same way lib/todays-workout.ts does (active
  // program, personal wins over shared, first workout this athlete
  // hasn't logged yet, in week/day order) — not hardcoded to "tomorrow",
  // since training days can put it several days out. Deliberately
  // ignores that resolver's own athlete-facing visibility-window lock:
  // a coach planning ahead here isn't subject to the same pacing gate a
  // client's own app view is.
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("id")
    .eq("group_id", session.group_id)
    .eq("athlete_id", session.athlete_id)
    .eq("is_active", true)
    .maybeSingle();

  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("id")
        .eq("group_id", session.group_id)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();

  const program = personalProgram ?? sharedProgram;
  let nextWorkoutId: string | null = null;

  if (program) {
    const { data: workouts } = await supabase
      .from("workouts")
      .select("id")
      .eq("program_id", program.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if (workouts && workouts.length > 0) {
      const { data: logs } = await supabase
        .from("workout_logs")
        .select("workout_id")
        .eq("athlete_id", session.athlete_id)
        .in(
          "workout_id",
          workouts.map((w) => w.id)
        );
      const loggedIds = new Set((logs ?? []).map((l) => l.workout_id));
      nextWorkoutId = workouts.find((w) => !loggedIds.has(w.id))?.id ?? null;
    }
  }

  let nextWorkoutTitle: string | null = null;
  let nextWorkoutExercises: WorkoutOverviewExercise[] = [];
  const carriedForwardNoteByExerciseName = new Map<string, { body: string; date: string }>();

  if (nextWorkoutId) {
    const overview = await getWorkoutOverviewData(supabase, {
      groupId: session.group_id,
      workoutId: nextWorkoutId,
      athleteId: session.athlete_id,
    });
    if (overview) {
      nextWorkoutTitle = overview.workout.title;
      nextWorkoutExercises = overview.exercises;

      await Promise.all(
        overview.exercises.map(async (ex) => {
          const note = await findMostRecentCoachNoteForExercise(supabase, {
            athleteId: session.athlete_id,
            groupId: session.group_id,
            exerciseName: ex.exerciseName,
          });
          if (note) carriedForwardNoteByExerciseName.set(ex.exerciseName, note);
        })
      );
    }
  }

  return (
    <RecapAndUpNext
      recap={recap}
      nextWorkout={
        nextWorkoutId && nextWorkoutTitle
          ? { workoutId: nextWorkoutId, title: nextWorkoutTitle, exercises: nextWorkoutExercises }
          : null
      }
      carriedForwardNotes={Object.fromEntries(carriedForwardNoteByExerciseName)}
      groupId={session.group_id}
    />
  );
}
