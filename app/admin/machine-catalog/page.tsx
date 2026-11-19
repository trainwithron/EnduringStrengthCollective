import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MACHINE_DEMOS_BUCKET, REQUEST_SELECT, requestFromRow } from "@/lib/machine-catalog";
import { youtubeEmbedUrl } from "@/lib/exercise-demo";
import { MachineCatalogReview, type ReviewRequest } from "@/components/admin/machine-catalog-review";

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

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-4 py-8 md:px-10">
      <Link href="/dashboard" className="inline-flex items-center min-h-11 font-body text-xs text-steel uppercase tracking-wide">
        &larr; Home
      </Link>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-1">Machine requests</h1>
      <p className="font-body text-sm text-steel mt-2 max-w-[65ch]">What coaches sent for the shared machine list. Approve puts it on the list for every gym; Deny keeps it off. Your note is shown to the coach.</p>
      {error ? (
        <p className="font-body text-sm text-steel mt-6">The shared machine list isn&apos;t set up yet.</p>
      ) : (
        <MachineCatalogReview requests={list} />
      )}
    </main>
  );
}
