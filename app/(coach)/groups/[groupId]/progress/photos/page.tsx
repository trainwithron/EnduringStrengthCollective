import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { PhotoCompare, type CompareInputPhoto } from "@/components/athlete/progress/photo-compare";
import { readMeasurements } from "@/lib/body-measurements";
import { loadLiftUnit } from "@/lib/lift-unit-server";

export const metadata = { title: "Compare photos" };

// Side-by-side progress photos (wave 2, P5; Ron approved the mockup Nov 20). The same privacy rule as the photo journal (progress-photos/page.tsx): always the
// REAL signed-in user's own photos, never the "View as Client" effective athlete. A coach standing in for a client can log a set for them; browsing someone
// else's private progress photos is a different thing, and this page does not offer it. Read-only: nothing here writes.
export default async function ComparePhotosPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (!membership) return <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>;

  const [{ data: photoRows, error: photoError }, { data: weightRows }, measurements, unit] = await Promise.all([
    supabase.from("progress_photos").select("id, storage_path, taken_date, caption").eq("athlete_id", user.id).eq("group_id", params.groupId).order("taken_date", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("body_weight_logs").select("logged_date, weight").eq("athlete_id", user.id).eq("group_id", params.groupId).order("logged_date", { ascending: true }).limit(2000),
    readMeasurements(supabase, user.id, params.groupId),
    loadLiftUnit(supabase, user.id),
  ]);
  if (isReadFailure(photoError)) return <LoadFailedPage />;

  // One batch of signed links from the private bucket the journal uses (an hour, like the journal's).
  const rows = (photoRows ?? []) as { id: string; storage_path: string; taken_date: string; caption: string | null }[];
  let urlByPath = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await supabase.storage.from("progress-photos").createSignedUrls(rows.map((r) => r.storage_path), 3600);
    urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]));
  }
  const photos: CompareInputPhoto[] = rows.map((r) => ({ id: r.id, takenDate: String(r.taken_date), storagePath: r.storage_path, caption: r.caption, url: urlByPath.get(r.storage_path) ?? null }));
  const weighIns = ((weightRows ?? []) as { logged_date: string; weight: number }[]).map((w) => ({ date: String(w.logged_date), weight: Number(w.weight) }));
  const waists = measurements.filter((m) => m.waist != null).map((m) => ({ date: m.date, weight: m.waist as number }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-3 pt-3 h-14 flex items-center gap-2">
        <Link
          href={`/groups/${params.groupId}/progress`}
          aria-label="Back to My progress"
          className="w-11 h-11 shrink-0 rounded-full bg-surface text-chalk inline-flex items-center justify-center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1 className="font-display font-semibold text-[22px] leading-tight">Compare photos</h1>
      </header>

      <section className="px-5 pt-3">
        <PhotoCompare photos={photos} weighIns={weighIns} waists={waists} weightUnit={unit} addHref={`/groups/${params.groupId}/progress-photos`} />
      </section>

      {membership.role === "athlete" && <BottomTabBar groupId={params.groupId} activeOverride="settings" />}
    </main>
  );
}
