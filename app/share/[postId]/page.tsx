import { BRAND_OG_IMAGES } from "@/lib/brand";
import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getSharedWorkout } from "@/lib/shared-workout";
import { ShareScreen } from "@/components/share/share-screen";
import { pickSeededFunLine, type WorkoutFacts } from "@/lib/workout-fun-line";
import { buildShareImageModel } from "@/lib/share-image";
import { CustomizeSharePanel } from "@/components/share/customize-share-panel";
import { BackgroundPicker } from "@/components/share/background-picker";
import { ScenicBackground } from "@/components/share/scenic-background";
import { pickScenicBackground, SCENIC_BACKGROUNDS } from "@/lib/scenic-backgrounds";
import { pickShareCardStyle } from "@/lib/share-card-style";
import { pickHumorArchetype } from "@/lib/humor-archetypes";
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
    // The line is for the athlete alone, so it uses their own real first name, whatever the public card shows (the card's name can be hidden, and would read "An").
    const { data: ownProfile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
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
          athleteFirstName: firstNameOf(ownProfile?.full_name),
          customMessage: (customRow?.completion_message as string | null | undefined) ?? null,
          hadPr: shared.celebratePrs.length > 0,
        }),
      };
    }
  }

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

  // Some cards (the "humor" style) carry a mascot above the headline: the person's own photo on a cartoon body. The card and the posted picture both show it.
  const humorArchetype = cardStyle === "humor" ? pickHumorArchetype(params.postId) : null;
  const mascotInitial = shared.athleteName === "An athlete" ? null : shared.athleteName;
  // The one-screen card and the picture people post are built from the same model, so they always agree.
  const imageInput = {
    mascot: humorArchetype ? { key: humorArchetype.key, caption: humorArchetype.caption, avatarUrl: shared.athleteAvatarUrl, initial: mascotInitial } : null,
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
  const defaultFunLine = pickSeededFunLine(funFacts, params.postId, { faith: shared.authorFaithOn });
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
          faithOn={shared.authorFaithOn}
          defaultLine={defaultFunLine}
          model={screenModel}
          background={screenBackground}
          coachLine={coachCongrats}
          hasPr={shared.celebratePrs.length > 0}
          imageInput={imageInput}
          title={shareTitle}
          homeHref={user ? `/groups/${shared.groupId}` : null}
          mascot={humorArchetype ? { archetype: humorArchetype, avatarUrl: shared.athleteAvatarUrl, initial: mascotInitial } : null}
        />
      </section>

      {/* ONE card after a workout (Ron, Oct 23: "It's still giving me two post-workout cards ... I want one condensed."). The card above already carries the numbers, the top lifts,
          the PR and the date; the second summary card is gone. The owner can still choose what the card shows, here, under it. */}
      {user?.id === shared.authorId && (
        <section id="customize" className="max-w-md mx-auto px-4 pb-16 space-y-4" data-share-customize>
          <p className="font-body text-xs text-steel uppercase tracking-wide">Customize your card</p>
          {shared.broadcastLevel === "full" && <CustomizeSharePanel postId={params.postId} candidates={shared.top5Candidates} initialSelected={shared.selectedNames} />}
          <BackgroundPicker athleteId={shared.authorId} initialPreference={shared.preferredShareBackground} />
          {viewerSeesFeed && (
            <Link href={`/groups/${shared.groupId}/feed`} className="inline-block font-body text-xs text-steel underline underline-offset-2">
              Team Feed
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
