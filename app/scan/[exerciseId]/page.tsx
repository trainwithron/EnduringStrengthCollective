import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extractYoutubeId } from "@/lib/youtube";
import { QrQuickLogStart } from "@/components/public/qr-quick-log-start";
import { GymVisitorLeadForm } from "@/components/public/gym-visitor-lead-form";
import type { TrackedField } from "@/lib/exercise-fields";
import { loadScanOrg } from "@/lib/scan-org";
import { loadSharedDemos, scanDemo } from "@/lib/machine-catalog-scan";
import { ReportVideoLink } from "@/components/public/report-video-link";
import { ScanCounter } from "@/components/public/scan-counter";

export const metadata = { title: "Scan" };

// equipment_qr_decal_scoping_sept19.md — a gym equipment decal deep-
// links here with no login required (added to the public-path
// allowlist in lib/supabase/middleware.ts). Branches on auth state: an
// existing client of the exercise's own coach gets a one-tap logging
// shortcut; everyone else (signed out, or signed in somewhere else
// entirely) gets a real public landing — the exercise's own video plus
// a join-this-gym lead capture, framed to that specific org.
export default async function ScanExercisePage(props: { params: Promise<{ exerciseId: string }>; searchParams: Promise<{ org?: string; machine?: string }> }) {
  const { exerciseId } = await props.params;
  const { org: requestedOrg, machine: fromMachine } = await props.searchParams;
  const serviceRole = createServiceRoleClient();

  const { data: exercise } = await serviceRole
    .from("exercise_library")
    .select("id, name, video_path, youtube_url, category, created_by")
    .eq("id", exerciseId)
    .maybeSingle();

  if (!exercise) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-5">
          <p className="font-body text-steel text-center">This QR code isn&apos;t valid anymore.</p>
          <Link href="/" className="inline-flex items-center justify-center h-11 px-6 bg-rust text-graphite font-display font-bold uppercase tracking-wide">
            Back home
          </Link>
        </div>
      </main>
    );
  }

  // The gym: the one the code was printed in (?org=, only while the coach is still in it), else the coach's oldest organization (lib/scan-org.ts). A coach can be in several
  // (Ron owns three): asking for exactly one membership failed for him and the page said "this gym" with no logo.
  const org = await loadScanOrg(serviceRole, exercise.created_by, requestedOrg ?? null);

  // Opened from a machine's QR page (?machine=): a machine added from the shared machine list shows the list's demo (read live), else the exercise's own, as before.
  let sharedItemId: string | null = null;
  if (fromMachine && /^[0-9a-f-]{36}$/i.test(fromMachine)) {
    const { data: link } = await serviceRole.from("gym_machine_exercises").select("catalog_item_id").eq("machine_id", fromMachine).eq("exercise_id", exercise.id).maybeSingle();
    sharedItemId = (link as { catalog_item_id?: string | null } | null)?.catalog_item_id ?? null;
  }
  const shared = await loadSharedDemos(serviceRole, [sharedItemId]);
  const demo = scanDemo(shared.get(sharedItemId ?? ""), exercise);

  let videoSignedUrl: string | null = null;
  if (demo?.kind === "video") {
    const { data } = await serviceRole.storage.from(demo.bucket).createSignedUrl(demo.path, 3600);
    videoSignedUrl = data?.signedUrl ?? null;
  }
  const youtubeId = demo?.kind === "youtube" ? extractYoutubeId(demo.url) : null;

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

  const orgDisplayName = org?.name ?? "this gym";
  const trackedFields: TrackedField[] = exercise.category === "Cardio/Mobility" ? ["time"] : ["weight", "reps"];

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      {/* One anonymous scan count (Ron, Nov 20: M2); opened from a machine's list it was a tap, not a scan. */}
      {!fromMachine && <ScanCounter exerciseId={exercise.id} />}
      <div className="w-full max-w-sm">
        {org?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external org-uploaded logo
          <img src={org.logoUrl} alt="" className="w-16 h-16 mx-auto mb-4 object-contain" />
        )}
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust-ink text-center">
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
        ) : org ? (
          <GymVisitorLeadForm
            organizationId={org.id}
            exerciseLibraryId={exercise.id}
            orgName={orgDisplayName}
          />
        ) : null}

        {(videoSignedUrl || youtubeId) && (
          <ReportVideoLink videos={[{ id: exercise.id, name: exercise.name }]} machineId={fromMachine && /^[0-9a-f-]{36}$/i.test(fromMachine) ? fromMachine : null} />
        )}
      </div>
    </main>
  );
}
