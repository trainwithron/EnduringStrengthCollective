import { BRAND_OG_IMAGES } from "@/lib/brand";
import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getVolumeEquivalence } from "@/lib/volume-equivalence";
import { pickGymJoke } from "@/lib/gym-jokes";
import { getSharedWorkout } from "@/lib/shared-workout";
import { PrListToggle } from "@/components/share/pr-list-toggle";
import { ShareScreen } from "@/components/share/share-screen";
import { pickSeededFunLine, type WorkoutFacts } from "@/lib/workout-fun-line";
import { buildShareImageModel } from "@/lib/share-image";
import { CustomizeSharePanel } from "@/components/share/customize-share-panel";
import { BackgroundPicker } from "@/components/share/background-picker";
import { VolumeLiftRig } from "@/components/share/volume-lift-rig";
import { ScenicBackground } from "@/components/share/scenic-background";
import { HumorArchetypeCard } from "@/components/share/humor-archetype-card";
import { pickScenicBackground, SCENIC_BACKGROUNDS } from "@/lib/scenic-backgrounds";
import { pickHumorArchetype } from "@/lib/humor-archetypes";
import { pickShareCardStyle } from "@/lib/share-card-style";
import { buildCoachCongrats, firstNameOf } from "@/lib/coach-congrats";

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
  // Same fix as the on-page display below: total_volume is coalesce(...,
  // 0), never null, so a null check here can never actually route a
  // no-sets "checked in" post away from claiming "0 lbs total volume" in
  // the actual link-preview text (iMessage/Slack/Discord unfurl) — the
  // exact bug the on-page branch was fixed for, just left live here too.
  const description =
    shared.totalSetsCompleted != null && shared.totalSetsCompleted > 0
      ? `${Math.round(shared.totalVolume).toLocaleString()} lbs total volume — training with ${shared.groupName}.`
      : `Training with ${shared.groupName}.`;

  return {
    title,
    description,
    openGraph: { title, description, images: BRAND_OG_IMAGES },
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
      <NoAccess>This workout card isn&apos;t available.</NoAccess>
    );
  }

  // A quiet nicety for a logged-in viewer landing here right after their
  // own completion — everyone else (the whole point of this page) sees
  // just the card, no app chrome.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // For the athlete themselves, right after finishing: a line from their coach, in the coach's voice, and the way
  // back to Home. Other viewers of the shared link see only the card.
  const viewerIsAuthor = !!user && user.id === shared.authorId;
  let coachCongrats: { coachFirstName: string; text: string } | null = null;
  let viewerSeesFeed = true;
  if (viewerIsAuthor) {
    const [{ data: coachRow }, { data: viewerMembership }] = await Promise.all([
      supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .eq("group_id", shared.groupId)
        .eq("role", "coach")
        .order("joined_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("group_memberships")
        .select("client_tier")
        .eq("group_id", shared.groupId)
        .eq("profile_id", user.id)
        .maybeSingle(),
    ]);
    // One-on-one clients do not have a Team Feed to continue to.
    viewerSeesFeed = viewerMembership?.client_tier !== "one_on_one";
    if (coachRow) {
      const coachProfile = coachRow.profiles as unknown as { full_name: string | null } | null;
      // Until migration 0249 is applied this select errors and the default line is used.
      const { data: customRow } = await supabase
        .from("coach_profiles")
        .select("completion_message")
        .eq("coach_id", coachRow.profile_id)
        .maybeSingle();
      coachCongrats = {
        coachFirstName: firstNameOf(coachProfile?.full_name) || "Your coach",
        text: buildCoachCongrats({
          athleteFirstName: firstNameOf(shared.athleteName),
          customMessage: (customRow?.completion_message as string | null | undefined) ?? null,
          hadPr: shared.celebratePrs.length > 0,
        }),
      };
    }
  }

  const volumeEquivalence =
    shared.totalSetsCompleted != null && shared.totalSetsCompleted > 0
      ? getVolumeEquivalence(shared.totalVolume, params.postId)
      : null;
  const gymJoke = pickGymJoke(new Date().toISOString().slice(0, 10));

  const shareTitle =
    shared.celebratePrs.length > 0
      ? `${shared.athleteName} just hit a new PR! 🎉`
      : `${shared.athleteName} just finished a workout! 💪`;

  // Card style rotation (post_workout_card_v1_bevel_and_animation.md) —
  // seeded per post, same mechanism as the volume-equivalence jokes, so
  // a share's visual flavor is stable on reload but varies workout to
  // workout. Deliberately only varies the HERO treatment (the group/
  // headline/athlete area) — every style keeps the exact same stats,
  // lifts, PRs, and streak below it, so a coach's real information is
  // never hidden just because a particular card happened to roll
  // "humor" this time.
  // A personal stock pick (share_card_backgrounds_expansion_scoping_sept19.md)
  // overrides the org-wide default_rotation/custom setting entirely; with
  // no personal pick, behavior is exactly what it was before this feature.
  const personalScenicPick = shared.preferredShareBackground
    ? SCENIC_BACKGROUNDS.find((b) => b.key === shared.preferredShareBackground) ?? null
    : null;
  const scenicAvailable =
    !!personalScenicPick ||
    (shared.workoutCardBackgroundMode === "custom" && !!shared.workoutCardBackgroundUrl) ||
    shared.workoutCardBackgroundMode === "default_rotation";
  const cardStyle = pickShareCardStyle(params.postId, scenicAvailable);
  const useOrgCustomImage =
    cardStyle === "scenic" &&
    !personalScenicPick &&
    shared.workoutCardBackgroundMode === "custom" &&
    !!shared.workoutCardBackgroundUrl;
  const scenicBackground =
    cardStyle === "scenic" && !useOrgCustomImage
      ? personalScenicPick ?? pickScenicBackground(params.postId)
      : null;
  const humorArchetype = cardStyle === "humor" ? pickHumorArchetype(params.postId) : null;
  const headline = shared.celebratePrs.length > 0 ? "New PR 🎉" : "Workout Complete 💪";

  // The one-screen card and the picture people post are built from the same model, so they always agree.
  const imageInput = {
    groupName: shared.groupName,
    athleteName: shared.athleteName,
    prCount: shared.celebratePrs.length,
    totalVolume: shared.totalVolume,
    totalSets: shared.totalSetsCompleted,
    durationSeconds: shared.durationSeconds,
    topLifts: shared.topLifts,
    weekStreak: shared.weekStreak,
    totalWorkoutCount: shared.totalWorkoutCount,
    createdAt: shared.createdAt,
    background: scenicBackground?.key ?? null,
  };
  // The light line on the card. The default (what anyone but the client sees, and the server's first render) is picked from this workout's own numbers with a
  // repeatable seed; the client's own device replaces it with a fresh one that is not among their last 20 (components/share/share-screen.tsx).
  const funFacts: WorkoutFacts = {
    totalVolume: shared.totalVolume,
    durationSeconds: shared.durationSeconds,
    totalSets: shared.totalSetsCompleted,
    weekStreak: shared.weekStreak,
    prCount: shared.celebratePrs.length,
    totalWorkoutCount: shared.totalWorkoutCount,
  };
  const defaultFunLine = pickSeededFunLine(funFacts, params.postId);
  const screenModel = buildShareImageModel({ ...imageInput, showName: true });
  const screenBackground = useOrgCustomImage ? (
    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
    <img src={shared.workoutCardBackgroundUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />
  ) : scenicBackground ? (
    <ScenicBackground background={scenicBackground.key} />
  ) : null;

  return (
    <main id="top" className="bg-graphite text-chalk font-body">
      <section className="h-[100dvh] min-h-[540px] max-w-md mx-auto flex flex-col gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]">
        <ShareScreen
          postId={params.postId}
          viewerId={user?.id ?? null}
          isOwner={viewerIsAuthor}
          facts={funFacts}
          defaultLine={defaultFunLine}
          model={screenModel}
          background={screenBackground}
          coachLine={coachCongrats}
          hasPr={shared.celebratePrs.length > 0}
          imageInput={imageInput}
          title={shareTitle}
          homeHref={user ? `/groups/${shared.groupId}` : null}
        />
      </section>

      <section id="full-workout" className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="relative w-full max-w-sm rounded-[22px] overflow-hidden border border-chalk/[0.06] bg-gradient-to-b from-[#2E2B28] to-surface shadow-[0_1px_0_rgba(237,232,224,.05)_inset,0_22px_44px_-18px_rgba(0,0,0,.65),0_2px_10px_rgba(0,0,0,.35)] before:content-[''] before:absolute before:inset-0 before:rounded-[22px] before:shadow-[0_1px_0_rgba(237,232,224,.08)_inset] before:pointer-events-none">
        {cardStyle === "scenic" ? (
          <div className="relative h-[180px] px-7 pt-8 pb-5 flex flex-col justify-end text-center">
            <div className="absolute inset-0">
              {useOrgCustomImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                <img
                  src={shared.workoutCardBackgroundUrl!}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <ScenicBackground background={scenicBackground!.key} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-graphite via-graphite/40 to-transparent" />
            </div>
            <div className="relative">
              <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
                {shared.groupName}
              </p>
              <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-2 drop-shadow-[0_2px_6px_rgba(0,0,0,.6)]">
                {headline}
              </h1>
              <p className="font-body text-lg mt-1">{shared.athleteName}</p>
            </div>
          </div>
        ) : cardStyle === "humor" ? (
          <div className="px-7 pt-6 text-center">
            <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
              {shared.groupName}
            </p>
            <div className="w-[130px] h-[147px] mx-auto mt-3">
              <HumorArchetypeCard archetype={humorArchetype!} avatarUrl={shared.athleteAvatarUrl} />
            </div>
            <p className="font-display font-bold text-2xl uppercase leading-tight mt-1">{headline}</p>
            <p className="font-body text-lg mt-1">{shared.athleteName}</p>
            <p className="font-body text-xs text-steel mt-1">
              {humorArchetype!.caption} — {humorArchetype!.subcaption}
            </p>
          </div>
        ) : (
          <div className="px-7 pt-8 text-center">
            <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
              {shared.groupName}
            </p>
            <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-4">
              {headline}
            </h1>
            <p className="font-body text-lg mt-2">{shared.athleteName}</p>
          </div>
        )}

        <div className="px-7 pb-7">
        <div className="mt-8 pt-[22px] pb-5 border-t border-b border-steel/20">
          {/* Real client feedback (Johann Gorsek, live usage): a session
              with real logged reps but no weight/RPE entered (so no
              set_logs row ever actually reached status='completed') showed
              "0 LBS TOTAL VOLUME · 0 SETS" instead of the "Checked in"
              fallback that's clearly meant for exactly this case. Root
              cause: complete_workout_session's own total_volume is
              coalesce(sum(...), 0) — always a real number, never null — so
              the old `totalVolume != null` check could never actually
              route here. totalSetsCompleted is the real signal for
              "did anything actually finish," so branch on that instead. */}
          {shared.totalSetsCompleted != null && shared.totalSetsCompleted > 0 ? (
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

        {/* Real client feedback (Johann Gorsek, live usage): "at the
            end, I would make the choices more obvious as a user might be
            unsure what to click next" — Share, Choose Your Background,
            and Continue to Team Feed all read with the same low-key
            weight before this. Share stays the one loud, filled primary
            action; "Continue to Team Feed" — the actual next step in a
            logged-in athlete's flow, not a customization option — is now
            a real bordered secondary button of its own, visually
            distinct from both Share above it and the quiet
            customization toggles (background/lift picks) below it. */}
        {coachCongrats && (
          <div className="mt-6 border border-steel/30 p-4">
            <p className="font-body text-xs text-steel uppercase tracking-wide">From {coachCongrats.coachFirstName}</p>
            <p className="font-body text-base text-chalk mt-1.5 leading-snug">{coachCongrats.text}</p>
          </div>
        )}

        <div className="mt-6 space-y-2.5">
          <a
            href="#top"
            className="w-full h-12 flex items-center justify-center bg-rust text-graphite font-display uppercase text-sm font-bold rounded-[14px]"
          >
            Share your picture
          </a>
          {user && (
            <Link
              href={`/groups/${shared.groupId}`}
              className="w-full h-11 flex items-center justify-center border border-steel/30 text-chalk font-body text-sm font-medium active:border-rust active:text-rust transition-colors"
            >
              Back to Home
            </Link>
          )}
          {user && viewerIsAuthor && viewerSeesFeed && (
            <Link
              href={`/groups/${shared.groupId}/feed`}
              className="block text-center font-body text-xs text-steel underline underline-offset-2 pt-1"
            >
              Team Feed
            </Link>
          )}
        </div>

        {user?.id === shared.authorId && shared.broadcastLevel === "full" && (
          <CustomizeSharePanel
            postId={params.postId}
            candidates={shared.top5Candidates}
            initialSelected={shared.selectedNames}
          />
        )}

        {user?.id === shared.authorId && (
          <BackgroundPicker athleteId={shared.authorId} initialPreference={shared.preferredShareBackground} />
        )}

        <p className="font-body text-xs text-steel mt-6 pt-4 border-t border-steel/20">
          Trained with <span className="text-rust">{shared.groupName}</span>
        </p>
        </div>
      </div>
      </section>
    </main>
  );
}
