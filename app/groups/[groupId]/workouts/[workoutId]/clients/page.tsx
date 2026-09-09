import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ClientPicker } from "@/components/coach/client-picker";
import { ClientSlotRow } from "@/components/coach/client-slot-row";

export default async function WorkoutClientsPage(
  props: {
    params: Promise<{ groupId: string; workoutId: string }>;
    searchParams: Promise<{ athlete?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can view client versions of a workout.
        </p>
      </main>
    );
  }

  const { data: workout } = await supabase
    .from("workouts")
    .select(
      `
      id, title,
      group_workout_exercises ( id, exercise_name, exercise_order, movement_pattern_id, group_workout_exercise_sets ( id ) )
    `
    )
    .eq("id", params.workoutId)
    .eq("group_id", params.groupId)
    .single();

  if (!workout) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This workout isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");

  const athletes = (memberships ?? [])
    .map((m: any) => ({ id: m.profile_id, fullName: m.profiles?.full_name ?? "Unknown" }))
    .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));

  const slots = (workout.group_workout_exercises ?? []).slice().sort(
    (a: any, b: any) => a.exercise_order - b.exercise_order
  );

  const selectedAthleteId = searchParams.athlete ?? null;

  let resolvedSlots: Array<{
    id: string;
    exerciseName: string;
    setsCount: number;
    isOverridden: boolean;
    ladder: { exerciseName: string }[];
    lastLogged: { weight: number; reps: number } | null;
  }> = [];

  if (selectedAthleteId && slots.length > 0) {
    const slotIds = slots.map((s: any) => s.id);

    const { data: overrides } = await supabase
      .from("athlete_exercise_overrides")
      .select("group_workout_exercise_id, exercise_name")
      .eq("athlete_id", selectedAthleteId)
      .in("group_workout_exercise_id", slotIds);

    const overrideBySlot = new Map(
      (overrides ?? []).map((o: any) => [o.group_workout_exercise_id, o])
    );

    const patternIds = Array.from(
      new Set(slots.map((s: any) => s.movement_pattern_id).filter(Boolean))
    );

    const laddersByPattern = new Map<string, { exerciseName: string }[]>();
    if (patternIds.length > 0) {
      const { data: ladderRows } = await supabase
        .from("movement_pattern_exercises")
        .select("movement_pattern_id, exercise_name, difficulty_rank")
        .in("movement_pattern_id", patternIds)
        .order("difficulty_rank", { ascending: true });

      for (const row of ladderRows ?? []) {
        const list = laddersByPattern.get(row.movement_pattern_id) ?? [];
        list.push({ exerciseName: row.exercise_name });
        laddersByPattern.set(row.movement_pattern_id, list);
      }
    }

    resolvedSlots = await Promise.all(
      slots.map(async (s: any) => {
        const override = overrideBySlot.get(s.id);
        const resolvedName = override?.exercise_name ?? s.exercise_name;

        const { data: priorSets } = await supabase
          .from("set_logs")
          .select(
            `
            weight, reps, completed_at,
            session_exercises!inner (
              exercise_name,
              athlete_sessions!inner ( athlete_id )
            )
          `
          )
          .eq("session_exercises.exercise_name", resolvedName)
          .eq("session_exercises.athlete_sessions.athlete_id", selectedAthleteId)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1);

        const last = priorSets?.[0] as any;

        return {
          id: s.id,
          exerciseName: resolvedName,
          setsCount: (s.group_workout_exercise_sets ?? []).length,
          isOverridden: Boolean(override),
          ladder: s.movement_pattern_id ? laddersByPattern.get(s.movement_pattern_id) ?? [] : [],
          lastLogged: last ? { weight: last.weight, reps: last.reps } : null,
        };
      })
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/workouts/${params.workoutId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to {workout.title}
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          Client Versions
        </h1>
        <p className="font-body text-sm text-steel mt-2">{workout.title}</p>
      </header>

      <section className="px-5 pt-6">
        <ClientPicker athletes={athletes} selectedAthleteId={selectedAthleteId} />

        {selectedAthleteId && (
          <div className="mt-6 divide-y divide-steel/15">
            {resolvedSlots.map((slot) => (
              <ClientSlotRow
                key={slot.id}
                groupWorkoutExerciseId={slot.id}
                athleteId={selectedAthleteId}
                groupId={params.groupId}
                resolvedExerciseName={slot.exerciseName}
                setsCount={slot.setsCount}
                isOverridden={slot.isOverridden}
                ladder={slot.ladder}
                lastLogged={slot.lastLogged}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
