import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import {
  TransformationCardCreator,
  type JournalPhotoOption,
} from "@/components/athlete/transformation-card-creator";

// Card creation — the one deliberate, athlete-chosen step in the whole
// Transformation Cards flow. Detection (the milestone that landed the
// athlete here) already happened automatically; nothing gets published
// until they actually press "Create & share" on this page.
export default async function NewTransformationCardPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ milestone?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const milestoneId = searchParams.milestone;
  if (!milestoneId) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          No milestone selected — head back to your home tab and log a weight to find one.
        </p>
      </main>
    );
  }

  const { data: milestone } = await supabase
    .from("transformation_milestones")
    .select("id, athlete_id, group_id, threshold_lbs, starting_weight, current_weight, detected_at")
    .eq("id", milestoneId)
    .eq("athlete_id", user.id)
    .maybeSingle();

  if (!milestone) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This milestone isn&apos;t available.</p>
      </main>
    );
  }

  const { data: photoRows } = await supabase
    .from("progress_photos")
    .select("id, storage_path, taken_date")
    .eq("athlete_id", user.id)
    .eq("group_id", params.groupId)
    .order("taken_date", { ascending: false });

  const photos: JournalPhotoOption[] = await Promise.all(
    (photoRows ?? []).map(async (p) => {
      const { data: signed } = await supabase.storage
        .from("progress-photos")
        .createSignedUrl(p.storage_path, 3600);
      return { id: p.id, takenDate: p.taken_date, signedUrl: signed?.signedUrl ?? null };
    })
  );

  // Real "from where" reference point — the athlete's own first-ever
  // logged weight, same value the detector used, not the milestone row's
  // own timestamp (which just marks when the threshold was crossed).
  const { data: firstEntry } = await supabase
    .from("body_weight_logs")
    .select("logged_date")
    .eq("athlete_id", user.id)
    .eq("group_id", params.groupId)
    .order("logged_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-16">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          Make Your Card
        </h1>
      </header>

      <section className="px-5 pt-6">
        <TransformationCardCreator
          athleteId={user.id}
          groupId={params.groupId}
          milestoneId={milestone.id}
          startingWeight={milestone.starting_weight}
          currentWeight={milestone.current_weight}
          windowStartDate={firstEntry?.logged_date ?? milestone.detected_at.slice(0, 10)}
          photos={photos}
        />
      </section>
    </main>
  );
}
