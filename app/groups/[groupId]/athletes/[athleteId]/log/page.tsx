import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

// Coach-only: the entry point for logging an in-person session on a
// client's behalf — same week-grouped "Log →" list the athlete themselves
// would see, scoped to the group's one active program (only one can be
// active per group, so there's nothing to pick between).
export default async function LogForClientPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
  }
) {
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
          Only coaches can log sessions for a client.
        </p>
      </main>
    );
  }

  const { data: athleteProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", params.athleteId)
    .single();

  const { data: activeProgram } = await supabase
    .from("programs")
    .select("id, name")
    .eq("group_id", params.groupId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeProgram) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group doesn&apos;t have an active program yet.
        </p>
      </main>
    );
  }

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises(count)")
    .eq("program_id", activeProgram.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const weeks = new Map<number, typeof workouts>();
  for (const w of workouts ?? []) {
    const list = weeks.get(w.week_number) ?? [];
    list.push(w);
    weeks.set(w.week_number, list);
  }
  const weekNumbers = Array.from(weeks.keys()).sort((a, b) => a - b);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/athletes/${params.athleteId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to profile
        </Link>
        <p className="font-body text-xs text-rust uppercase tracking-wide mt-3">
          Logging for {athleteProfile?.full_name ?? "this client"}
        </p>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          {activeProgram.name}
        </h1>
      </header>

      <section className="px-5 pt-6">
        {weekNumbers.length === 0 && (
          <p className="font-body text-sm text-steel py-3">No workouts in this program yet.</p>
        )}

        {weekNumbers.map((weekNum) => (
          <div key={weekNum} className="pt-6 first:pt-0">
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Week {weekNum}
            </h2>
            <div className="divide-y divide-steel/15">
              {weeks.get(weekNum)!.map((w: any) => {
                const exerciseCount = w.group_workout_exercises?.[0]?.count ?? 0;
                return (
                  <div key={w.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-medium text-[15px]">{w.title}</span>
                      <span className="font-body text-xs text-steel">
                        {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"}
                      </span>
                    </div>
                    <Link
                      href={`/groups/${params.groupId}/athletes/${params.athleteId}/log/${w.id}`}
                      className="font-body text-xs text-rust mt-1.5 inline-block"
                    >
                      Log &rarr;
                    </Link>
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
