import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { PrListToggle } from "@/components/share/pr-list-toggle";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";

// Deliberately public — no auth check. Every completed workout gets a
// shareable card now, not just PRs, so a client can post it (and tag the
// gym) right after finishing. RLS on the anon role is scoped narrowly to
// workout_summary posts only — see migration 0028_public_share_any_workout.
async function getSharedWorkout(postId: string) {
  const supabase = createServerClient();

  const { data: post } = await supabase
    .from("posts")
    .select(
      `
      id, post_type, created_at, group_id,
      profiles!posts_author_id_fkey ( full_name ),
      workout_logs ( session_id, new_prs, total_volume, total_sets_completed )
    `
    )
    .eq("id", postId)
    .eq("post_type", "workout_summary")
    .maybeSingle();

  const workoutLog = post?.workout_logs as any;
  if (!post || !workoutLog) return null;

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", post.group_id)
    .maybeSingle();

  const newPrs: string[] = workoutLog.new_prs ?? [];

  // Best completed set per exercise, from the session behind this post —
  // powers both "top lifts" and the PR list's estimated 1RM.
  const bestByExercise = new Map<string, { weight: number; reps: number }>();
  if (workoutLog.session_id) {
    const { data: sets } = await supabase
      .from("set_logs")
      .select("weight, reps, status, session_exercises!inner ( session_id, exercise_name )")
      .eq("session_exercises.session_id", workoutLog.session_id)
      .eq("status", "completed");

    for (const row of (sets ?? []) as any[]) {
      const name = row.session_exercises.exercise_name;
      const weight = row.weight ?? 0;
      const existing = bestByExercise.get(name);
      if (!existing || weight > existing.weight) {
        bestByExercise.set(name, { weight, reps: row.reps ?? 1 });
      }
    }
  }

  const topLifts = Array.from(bestByExercise.entries())
    .map(([name, best]) => ({ name, ...best }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const prList = newPrs
    .map((name) => {
      const best = bestByExercise.get(name);
      if (!best) return null;
      return {
        name,
        weight: best.weight,
        reps: best.reps,
        oneRepMax: estimateOneRepMax(best.weight, best.reps),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    groupId: post.group_id,
    athleteName: (post.profiles as any)?.full_name ?? "An athlete",
    groupName: group?.name ?? "The Enduring Strength Collective",
    totalVolume: workoutLog.total_volume ?? 0,
    totalSetsCompleted: workoutLog.total_sets_completed ?? 0,
    topLifts,
    prList,
    createdAt: post.created_at,
  };
}

export async function generateMetadata({
  params,
}: {
  params: { postId: string };
}): Promise<Metadata> {
  const shared = await getSharedWorkout(params.postId);
  if (!shared) return { title: "Workout not found" };

  const title =
    shared.prList.length > 0
      ? `${shared.athleteName} just hit a new PR! 🎉`
      : `${shared.athleteName} just finished a workout! 💪`;
  const description = `${Math.round(shared.totalVolume).toLocaleString()} lbs total volume — training with ${shared.groupName}.`;

  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default async function ShareWorkoutPage({
  params,
}: {
  params: { postId: string };
}) {
  const shared = await getSharedWorkout(params.postId);

  if (!shared) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This workout card isn&apos;t available.
        </p>
      </main>
    );
  }

  // A quiet nicety for a logged-in viewer landing here right after their
  // own completion — everyone else (the whole point of this page) sees
  // just the card, no app chrome.
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shareTitle =
    shared.prList.length > 0
      ? `${shared.athleteName} just hit a new PR! 🎉`
      : `${shared.athleteName} just finished a workout! 💪`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm border border-rust/40 bg-surface/40 p-8 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {shared.groupName}
        </p>

        <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-4">
          {shared.prList.length > 0 ? "New PR 🎉" : "Workout Complete 💪"}
        </h1>
        <p className="font-body text-lg mt-2">{shared.athleteName}</p>

        <div className="mt-8 pb-6 border-b border-steel/20">
          <p className="font-display text-5xl leading-none">
            {Math.round(shared.totalVolume).toLocaleString()}
          </p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
            lbs total volume &middot; {shared.totalSetsCompleted} sets
          </p>
        </div>

        {shared.topLifts.length > 0 && (
          <div className="mt-6">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
              Top lifts today
            </p>
            <div className="space-y-2">
              {shared.topLifts.map((lift) => (
                <div key={lift.name} className="flex items-center justify-between">
                  <span className="font-display text-base uppercase">{lift.name}</span>
                  <span className="font-body text-sm text-steel">
                    {lift.weight} lbs &times; {lift.reps}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {shared.prList.length > 0 && <PrListToggle items={shared.prList} />}

        <p className="font-body text-xs text-steel mt-8">
          {new Date(shared.createdAt).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>

        <div className="mt-6">
          <ShareWorkoutButton postId={params.postId} title={shareTitle} size="large" />
        </div>

        <p className="font-body text-xs text-steel mt-6 pt-4 border-t border-steel/20">
          Trained with <span className="text-rust">{shared.groupName}</span>
        </p>

        {user && (
          <Link
            href={`/groups/${shared.groupId}/feed`}
            className="inline-block mt-6 font-body text-xs text-steel uppercase tracking-wide"
          >
            Continue to Team Feed &rarr;
          </Link>
        )}
      </div>
    </main>
  );
}
