import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extractYoutubeId } from "@/lib/youtube";
import { QrQuickLogStart } from "@/components/public/qr-quick-log-start";
import { GymVisitorLeadForm } from "@/components/public/gym-visitor-lead-form";
import type { TrackedField } from "@/lib/exercise-fields";

// equipment_qr_decal_scoping_sept19.md — a gym equipment decal deep-
// links here with no login required (added to the public-path
// allowlist in lib/supabase/middleware.ts). Branches on auth state: an
// existing client of the exercise's own coach gets a one-tap logging
// shortcut; everyone else (signed out, or signed in somewhere else
// entirely) gets a real public landing — the exercise's own video plus
// a join-this-gym lead capture, framed to that specific org.
export default async function ScanExercisePage(props: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await props.params;
  const serviceRole = createServiceRoleClient();

  const { data: exercise } = await serviceRole
    .from("exercise_library")
    .select("id, name, video_path, youtube_url, category, created_by")
    .eq("id", exerciseId)
    .maybeSingle();

  if (!exercise) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This QR code isn&apos;t valid anymore.</p>
      </main>
    );
  }

  // This app already assumes one organization per coach everywhere
  // (every existing query does the same .maybeSingle() lookup) — this
  // page follows that same existing assumption rather than introducing
  // new multi-org handling nothing else in the app has today.
  const { data: coachOrgMembership } = await serviceRole
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", exercise.created_by)
    .maybeSingle();

  const { data: org } = coachOrgMembership?.organization_id
    ? await serviceRole
        .from("organizations")
        .select("id, display_name, name, logo_url")
        .eq("id", coachOrgMembership.organization_id)
        .maybeSingle()
    : { data: null };

  let videoSignedUrl: string | null = null;
  if (exercise.video_path) {
    const { data } = await serviceRole.storage.from("exercise-media").createSignedUrl(exercise.video_path, 3600);
    videoSignedUrl = data?.signedUrl ?? null;
  }
  const youtubeId = exercise.youtube_url ? extractYoutubeId(exercise.youtube_url) : null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let fastPathGroupId: string | null = null;
  if (user) {
    const { data: myGroups } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("profile_id", user.id)
      .eq("role", "athlete");
    const myGroupIds = (myGroups ?? []).map((g) => g.group_id);
    if (myGroupIds.length > 0) {
      const { data: coachMatch } = await supabase
        .from("group_memberships")
        .select("group_id")
        .eq("profile_id", exercise.created_by)
        .eq("role", "coach")
        .in("group_id", myGroupIds)
        .limit(1)
        .maybeSingle();
      fastPathGroupId = coachMatch?.group_id ?? null;
    }
  }

  const orgDisplayName = org?.display_name ?? org?.name ?? "this gym";
  const trackedFields: TrackedField[] = exercise.category === "Cardio/Mobility" ? ["time"] : ["weight", "reps"];

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {org?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- external org-uploaded logo
          <img src={org.logo_url} alt="" className="w-16 h-16 mx-auto mb-4 object-contain" />
        )}
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust text-center">
          {orgDisplayName}
        </p>
        <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-2 text-center">
          {exercise.name}
        </h1>

        {videoSignedUrl ? (
          <video src={videoSignedUrl} controls className="w-full mt-6 bg-surface aspect-video" />
        ) : youtubeId ? (
          <div className="w-full mt-6 aspect-video">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}`}
              title={exercise.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        ) : null}

        {fastPathGroupId ? (
          <QrQuickLogStart
            athleteId={user!.id}
            groupId={fastPathGroupId}
            exerciseName={exercise.name}
            movementPatternId={null}
            trackedFields={trackedFields}
          />
        ) : coachOrgMembership?.organization_id ? (
          <GymVisitorLeadForm
            organizationId={coachOrgMembership.organization_id}
            exerciseLibraryId={exercise.id}
            orgName={orgDisplayName}
          />
        ) : null}
      </div>
    </main>
  );
}
