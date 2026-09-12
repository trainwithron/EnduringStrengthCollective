import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getVolumeEquivalence } from "@/lib/volume-equivalence";
import { pickGymJoke } from "@/lib/gym-jokes";
import { getSharedWorkout } from "@/lib/shared-workout";
import { PrListToggle } from "@/components/share/pr-list-toggle";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";
import { CustomizeSharePanel } from "@/components/share/customize-share-panel";

// Deliberately public — no auth check. Every completed workout gets a
// shareable card now, not just PRs, so a client can post it (and tag the
// gym) right after finishing. RLS on the anon role is scoped narrowly to
// workout_summary posts only — see migration 0028_public_share_any_workout.

export async function generateMetadata(
  props: {
    params: Promise<{ postId: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const shared = await getSharedWorkout(params.postId);
  if (!shared) return { title: "Workout not found" };

  const title =
    shared.celebratePrs.length > 0
      ? `${shared.athleteName} just hit a new PR! 🎉`
      : `${shared.athleteName} just finished a workout! 💪`;
  const description =
    shared.totalVolume != null
      ? `${Math.round(shared.totalVolume).toLocaleString()} lbs total volume — training with ${shared.groupName}.`
      : `Training with ${shared.groupName}.`;

  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default async function ShareWorkoutPage(
  props: {
    params: Promise<{ postId: string }>;
  }
) {
  const params = await props.params;
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
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const volumeEquivalence =
    shared.totalVolume != null ? getVolumeEquivalence(shared.totalVolume, params.postId) : null;
  const gymJoke = pickGymJoke(new Date().toISOString().slice(0, 10));

  const shareTitle =
    shared.celebratePrs.length > 0
      ? `${shared.athleteName} just hit a new PR! 🎉`
      : `${shared.athleteName} just finished a workout! 💪`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm border border-rust/40 bg-surface/40 p-8 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {shared.groupName}
        </p>

        <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-4">
          {shared.celebratePrs.length > 0 ? "New PR 🎉" : "Workout Complete 💪"}
        </h1>
        <p className="font-body text-lg mt-2">{shared.athleteName}</p>

        <div className="mt-8 pb-6 border-b border-steel/20">
          {shared.totalVolume != null ? (
            <>
              <p className="font-display text-5xl leading-none">
                {Math.round(shared.totalVolume).toLocaleString()}
              </p>
              <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
                lbs total volume &middot; {shared.totalSetsCompleted} sets
              </p>
              {volumeEquivalence && (
                <p className="font-body text-sm text-rust mt-2">{volumeEquivalence.text}</p>
              )}
              {shared.weekStreak >= 2 && (
                <p className="font-body text-sm text-rust mt-1">
                  🔥 {shared.weekStreak} week streak
                </p>
              )}
            </>
          ) : (
            <p className="font-body text-sm text-steel uppercase tracking-wide">
              {shared.celebratePrs.length > 0 ? "New personal record" : "Checked in"}
            </p>
          )}
        </div>

        <p className="font-body text-xs text-steel mt-4">😂 {gymJoke}</p>

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

        {shared.celebratePrs.length > 0 && <PrListToggle items={shared.celebratePrs} />}

        {shared.baselinePrs.length > 0 && (
          <div className="mt-6 pt-4 border-t border-steel/20">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
              Establishing your baseline
            </p>
            <p className="font-body text-sm text-steel">
              {shared.baselinePrs.map((p) => p.name).join(", ")} —{" "}
              {shared.baselinePrs.length === 1 ? "this is a new one" : "these are new"}, so there&apos;s
              no history to compare against yet. Keep logging and the real records will show up
              here soon.
            </p>
            {shared.totalWorkoutCount != null && shared.celebratePrs.length === 0 && (
              <p className="font-body text-sm text-rust mt-2">
                💪 Workout #{shared.totalWorkoutCount} in the books
              </p>
            )}
          </div>
        )}

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

        {user?.id === shared.authorId && shared.broadcastLevel === "full" && (
          <CustomizeSharePanel
            postId={params.postId}
            candidates={shared.top5Candidates}
            initialSelected={shared.selectedNames}
          />
        )}

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
