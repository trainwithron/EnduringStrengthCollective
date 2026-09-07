import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProgramActiveToggle } from "@/components/coach/program-active-toggle";

export default async function ProgramsListPage({
  params,
}: {
  params: { groupId: string };
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
          Only coaches can manage programs.
        </p>
      </main>
    );
  }

  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, description, is_active, workouts(count)")
    .eq("group_id", params.groupId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

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
          Program Builder
        </h1>
      </header>

      <section className="px-5 pt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel">
            Programs
          </h2>
          <Link
            href={`/groups/${params.groupId}/programs/new`}
            className="font-body text-xs text-rust"
          >
            + New program
          </Link>
        </div>

        {!programs || programs.length === 0 ? (
          <p className="font-body text-sm text-steel py-6">
            No programs yet. Create one to start assigning workouts.
          </p>
        ) : (
          <div className="divide-y divide-steel/15">
            {programs.map((p: any) => {
              const workoutCount = p.workouts?.[0]?.count ?? 0;
              return (
                <div key={p.id} className="flex items-center justify-between py-3 min-h-[56px] -mx-1 px-1">
                  <Link
                    href={`/groups/${params.groupId}/programs/${p.id}`}
                    className="min-w-0 flex-1 active:opacity-70 transition-opacity"
                  >
                    <p className="font-body font-medium text-[15px] truncate">{p.name}</p>
                    <p className="font-body text-xs text-steel mt-0.5">
                      {workoutCount} {workoutCount === 1 ? "workout" : "workouts"}
                    </p>
                  </Link>
                  <div className="flex items-center gap-4 shrink-0">
                    <ProgramActiveToggle
                      programId={p.id}
                      groupId={params.groupId}
                      isActive={p.is_active}
                    />
                    <Link
                      href={`/groups/${params.groupId}/programs/${p.id}`}
                      className="font-body text-xs text-rust"
                    >
                      Open &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
