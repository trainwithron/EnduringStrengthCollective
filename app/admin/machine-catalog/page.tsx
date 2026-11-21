import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MACHINE_DEMOS_BUCKET, REQUEST_SELECT, requestFromRow } from "@/lib/machine-catalog";
import { youtubeEmbedUrl } from "@/lib/exercise-demo";
import { MachineCatalogReview, type ReviewRequest } from "@/components/admin/machine-catalog-review";
import { VideoReportsList, type VideoReportRow } from "@/components/admin/video-reports-list";
import { MachineCatalogCurate } from "@/components/admin/machine-catalog-curate";

export const metadata = { title: "Machine requests" };

// The platform admin's review of what coaches sent for the shared machine list (Ron, Nov 19: "send a request and I could approve or deny it depending on the video quality"). Each
// waiting request with its video playable; Approve puts it on the list, Deny keeps it off; the note is shown to the coach. Only the platform admin: checked here, by the table's own
// row security, and again by review_catalog_request() on the server.
export default async function AdminMachineCatalogPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!me?.is_platform_admin) return <NoAccess>You don&apos;t have access to this page.</NoAccess>;

  const { data: rows, error } = await supabase.from("catalog_requests").select(REQUEST_SELECT + ", submitted_by").eq("status", "pending").order("created_at").limit(200);
  const requests = ((rows ?? []) as unknown as (Parameters<typeof requestFromRow>[0] & { submitted_by: string })[]).map((r) => ({ ...requestFromRow(r), submittedBy: r.submitted_by }));

  // Who sent each one (names only), and what each demo is for.
  const serviceRole = createServiceRoleClient();
  const people = [...new Set(requests.map((r) => r.submittedBy))];
  const { data: names } = people.length > 0 ? await serviceRole.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map(((names ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const itemIds = [...new Set(requests.flatMap((r) => (r.itemId ? [r.itemId] : [])))];
  const { data: items } =
    itemIds.length > 0 ? await supabase.from("catalog_machine_exercises").select("id, video_path, youtube_url, catalog_machines ( brand, model ), exercise_catalog ( name )").in("id", itemIds) : { data: [] };
  const itemOf = new Map(
    ((items ?? []) as unknown as { id: string; video_path: string | null; youtube_url: string | null; catalog_machines: { brand: string; model: string } | null; exercise_catalog: { name: string } | null }[]).map((i) => [i.id, i]),
  );

  // The waiting videos, playable here (the bucket is private; the admin may read it).
  const paths = requests.flatMap((r) => (r.videoPath ? [r.videoPath] : []));
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(MACHINE_DEMOS_BUCKET).createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
  }

  const list: ReviewRequest[] = requests.map((r) => {
    const item = r.itemId ? itemOf.get(r.itemId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      from: nameOf.get(r.submittedBy) ?? "A coach",
      sentAt: r.createdAt,
      machine: r.kind === "machine" ? `${r.brand ?? ""} ${r.model ?? ""}`.trim() : item?.catalog_machines ? `${item.catalog_machines.brand} ${item.catalog_machines.model}` : null,
      exercises: r.exercises?.map((e) => e.name) ?? [],
      exercise: item?.exercise_catalog?.name ?? null,
      videoUrl: r.videoPath ? (signed.get(r.videoPath) ?? null) : null,
      youtubeEmbed: r.youtubeUrl ? youtubeEmbedUrl(r.youtubeUrl) : null,
      youtubeUrl: r.youtubeUrl,
      replaces: !!item && (!!item.video_path || !!item.youtube_url),
    };
  });

  // Videos reported from the public scan pages (Ron, Nov 20, S4; step 211). Before the step is applied the read fails and the section says nothing is reported.
  const { data: reportRows } = await supabase
    .from("video_reports")
    .select("id, exercise_id, machine_id, catalog_item_id, reason, note, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  const reports = (reportRows ?? []) as { id: string; exercise_id: string | null; machine_id: string | null; catalog_item_id: string | null; reason: string; note: string | null; created_at: string }[];
  const reportExerciseIds = [...new Set(reports.flatMap((r) => (r.exercise_id ? [r.exercise_id] : [])))];
  const reportMachineIds = [...new Set(reports.flatMap((r) => (r.machine_id ? [r.machine_id] : [])))];
  const [{ data: reportExercises }, { data: reportMachines }] = await Promise.all([
    reportExerciseIds.length > 0 ? serviceRole.from("exercise_library").select("id, name").in("id", reportExerciseIds) : Promise.resolve({ data: [] }),
    reportMachineIds.length > 0 ? serviceRole.from("gym_machines").select("id, name").in("id", reportMachineIds) : Promise.resolve({ data: [] }),
  ]);
  const exerciseName = new Map(((reportExercises ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
  const machineName = new Map(((reportMachines ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const reportList: VideoReportRow[] = reports.map((r) => {
    const ex = r.exercise_id ? (exerciseName.get(r.exercise_id) ?? "An exercise") : "A video that was since deleted";
    const m = r.machine_id ? machineName.get(r.machine_id) : undefined;
    return {
      id: r.id,
      what: m ? `${ex} on ${m}` : ex,
      where: r.catalog_item_id ? "shared_list" : "exercise",
      reason: r.reason,
      note: r.note,
      sentAt: r.created_at,
      scanHref: r.exercise_id ? `/scan/${r.exercise_id}${r.machine_id ? `?machine=${r.machine_id}` : ""}` : null,
    };
  });

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-4 py-8 md:px-10">
      <div className="flex flex-wrap items-center gap-x-5">
        <Link href="/dashboard" className="inline-flex items-center min-h-11 font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <Link href="/admin/nutrition-ingredients" className="inline-flex items-center min-h-11 font-body text-xs text-steel uppercase tracking-wide">
          Recipe ingredients
        </Link>
      </div>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-1">Machine requests</h1>
      <p className="font-body text-sm text-steel mt-2 max-w-[65ch]">What coaches sent for the shared machine list. Approve puts it on the list for every gym; Deny keeps it off. Your note is shown to the coach.</p>
      {error ? (
        <p className="font-body text-sm text-steel mt-6">The shared machine list isn&apos;t set up yet.</p>
      ) : (
        <>
          <MachineCatalogReview requests={list} />
          {/* the list itself, curated directly (DK1: no longer on the coach's Exercise library) */}
          <MachineCatalogCurate adminId={user.id} />
        </>
      )}
      <VideoReportsList initial={reportList} />
    </main>
  );
}
