import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProgressionRow } from "@/components/coach/progression-row";

export default async function ProgressionsPage({
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

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage progressions.
        </p>
      </main>
    );
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, name")
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

  const { data: exerciseRows } = await supabase
    .from("group_workout_exercises")
    .select("exercise_name, workouts!inner ( program_id )")
    .eq("workouts.program_id", params.programId);

  const exerciseNames = Array.from(
    new Set((exerciseRows ?? []).map((r: any) => r.exercise_name as string))
  ).sort((a, b) => a.localeCompare(b));

  const { data: existingProgressions } = await supabase
    .from("exercise_progressions")
    .select("id, exercise_name, model, config")
    .eq("program_id", params.programId);

  const progressionByExercise = new Map(
    (existingProgressions ?? []).map((p: any) => [p.exercise_name, p])
  );

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/programs/${params.programId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to {program.name}
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          Exercise Progressions
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Define how each exercise evolves across weeks. Targets are computed
          from each athlete&apos;s own logged performance in this program.
        </p>
      </header>

      <section className="px-5 pt-6">
        {exerciseNames.length === 0 ? (
          <p className="font-body text-sm text-steel py-6">
            No exercises in this program yet — add workouts first.
          </p>
        ) : (
          <div className="divide-y divide-steel/15">
            {exerciseNames.map((name) => (
              <ProgressionRow
                key={name}
                groupId={params.groupId}
                programId={params.programId}
                exerciseName={name}
                existing={progressionByExercise.get(name) ?? null}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
