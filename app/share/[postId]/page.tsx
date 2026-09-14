import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getVolumeEquivalence } from "@/lib/volume-equivalence";
import { pickGymJoke } from "@/lib/gym-jokes";
import { getSharedWorkout } from "@/lib/shared-workout";
import { PrListToggle } from "@/components/share/pr-list-toggle";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";
import { CustomizeSharePanel } from "@/components/share/customize-share-panel";
import { VolumeLiftRig } from "@/components/share/volume-lift-rig";

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
      <div className="relative w-full max-w-sm rounded-[22px] border border-chalk/[0.06] bg-gradient-to-b from-[#2E2B28] to-surface pt-8 pb-7 px-7 text-center shadow-[0_1px_0_rgba(237,232,224,.05)_inset,0_22px_44px_-18px_rgba(0,0,0,.65),0_2px_10px_rgba(0,0,0,.35)] before:content-[''] before:absolute before:inset-0 before:rounded-[22px] before:shadow-[0_1px_0_rgba(237,232,224,.08)_inset] before:pointer-events-none">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {shared.groupName}
        </p>

        <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-4">
          {shared.celebratePrs.length > 0 ? "New PR 🎉" : "Workout Complete 💪"}
        </h1>
        <p className="font-body text-lg mt-2">{shared.athleteName}</p>

        <div className="mt-8 pt-[22px] pb-5 border-t border-b border-steel/20">
          {shared.totalVolume != null ? (
            <>
              <p className="font-display text-5xl leading-none [font-variant-numeric:tabular-nums]">
                {Math.round(shared.totalVolume).toLocaleString()}
              </p>
              <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
                lbs total volume &middot; {shared.totalSetsCompleted} sets
              </p>
              {volumeEquivalence && (
                <>
                  <VolumeLiftRig emoji={volumeEquivalence.emoji} />
                  <p className="font-body text-sm text-rust -mt-1">{volumeEquivalence.text}</p>
                </>
              )}
              {shared.weekStreak >= 2 && (
                <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-rust/[0.14] border border-rust/30 rounded-full font-body text-xs font-semibold text-rust">
                  🔥 {shared.weekStreak} week streak
                </span>
              )}
            </>
          ) : (
            <p className="font-body text-sm text-steel uppercase tracking-wide">
              {shared.celebratePrs.length > 0 ? "New personal record" : "Checked in"}
            </p>
          )}
        </div>

        {shared.relativeStrengthMilestones.length > 0 && (
          <div className="mt-6 space-y-1">
            {shared.relativeStrengthMilestones.map((m) => (
              <p
                key={m.exerciseName}
                className="font-display text-xl text-rust text-center leading-tight"
              >
                💪 {m.multiple}&times; bodyweight {m.exerciseName}!
              </p>
            ))}
          </div>
        )}

        {shared.compoundCelebration && (
          <p className="font-display text-lg text-rust text-center mt-6 leading-snug">
            {shared.compoundCelebration}
          </p>
        )}

        <p className="font-body text-xs text-steel mt-4">😂 {gymJoke}</p>

        {shared.topLifts.length > 0 && (
          <div className="mt-6">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
              Top lifts today
            </p>
            <div className="space-y-1.5">
              {shared.topLifts.map((lift) => (
                <div
                  key={lift.name}
                  className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-chalk/[0.03]"
                >
                  <span className="font-display text-base uppercase">{lift.name}</span>
                  <span className="font-body text-sm text-steel [font-variant-numeric:tabular-nums]">
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
