import Link from "next/link";
import { Play } from "lucide-react";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { scanRows } from "@/lib/gym-machines";
import { loadScanOrg } from "@/lib/scan-org";
import { loadSharedDemos, scanDemo } from "@/lib/machine-catalog-scan";
import { ReportVideoLink } from "@/components/public/report-video-link";

export const metadata = { title: "Scan" };

// A machine's QR code (Ron, Nov 19: "scan that QR code and it'd give you a list of every exercise ... you can do on that machine"). No sign-in needed (/scan/ is on the public list in
// lib/supabase/middleware.ts). Read with the server's key, as the exercise scan page does: the gym's name and logo, the machine's name, and every exercise on it as a big row that opens
// the exercise's own scan page (/scan/<id>), which shows its demo and gives a client the logging shortcut and a visitor the gym's page.
function Message({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-5">
        <p className="font-body text-steel text-center">{text}</p>
        <Link href="/" className="inline-flex items-center justify-center h-11 px-6 bg-rust text-graphite font-display font-bold uppercase tracking-wide">
          Back home
        </Link>
      </div>
    </main>
  );
}

export default async function ScanMachinePage(props: { params: Promise<{ machineId: string }> }) {
  const { machineId } = await props.params;
  const serviceRole = createServiceRoleClient();

  const { data: machine } = await serviceRole.from("gym_machines").select("id, name, created_by, organization_id").eq("id", machineId).maybeSingle();
  if (!machine) return <Message text="This QR code isn't valid anymore." />;

  // With the shared machine list (step 208) each exercise also carries the shared one it came from; before that step the plain columns are read.
  let linkRead = await serviceRole.from("gym_machine_exercises").select("exercise_id, position, catalog_item_id").eq("machine_id", machine.id);
  if (linkRead.error) linkRead = (await serviceRole.from("gym_machine_exercises").select("exercise_id, position").eq("machine_id", machine.id)) as typeof linkRead;
  const linkRows = (linkRead.data ?? []) as { exercise_id: string; position: number; catalog_item_id?: string | null }[];
  const { data: exerciseRows } =
    linkRows.length > 0
      ? await serviceRole.from("exercise_library").select("id, name, video_path, youtube_url").in("id", linkRows.map((l) => l.exercise_id))
      : { data: [] };
  const rows = scanRows(linkRows, (exerciseRows ?? []) as { id: string; name: string; video_path: string | null; youtube_url: string | null }[]);

  // The gym: the organization the machine was made in (while the coach is still in it), else the coach's oldest organization (lib/scan-org.ts).
  const org = await loadScanOrg(serviceRole, machine.created_by, machine.organization_id);
  const orgDisplayName = org?.name ?? "this gym";

  // A machine added from the shared machine list shows the list's demos (read live), else the coach's own. An uploaded demo's first frame is the row's picture (both video buckets are
  // private: short-lived signed links).
  const shared = await loadSharedDemos(serviceRole, rows.map((r) => r.catalogItemId));
  const demos = new Map(rows.map((r) => [r.id, scanDemo(shared.get(r.catalogItemId ?? ""), r)]));
  const signed = new Map<string, string>();
  for (const bucket of ["exercise-media", "machine-demos"] as const) {
    const paths = [...demos.values()].flatMap((d) => (d?.kind === "video" && d.bucket === bucket ? [d.path] : []));
    if (paths.length === 0) continue;
    const { data } = await serviceRole.storage.from(bucket).createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(`${bucket}/${d.path}`, d.signedUrl);
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-16">
      <div className="w-full max-w-sm mx-auto">
        {org?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external org-uploaded logo
          <img src={org.logoUrl} alt="" className="w-16 h-16 mx-auto mb-4 object-contain" />
        )}
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust-ink text-center">{orgDisplayName}</p>
        <h1 className="font-display font-bold text-3xl uppercase leading-tight mt-2 text-center">{machine.name}</h1>

        {rows.length === 0 ? (
          <p className="font-body text-steel text-center mt-8">No exercises on this machine yet.</p>
        ) : (
          <>
            <p className="font-body text-sm text-steel text-center mt-2">
              {rows.length} {rows.length === 1 ? "exercise" : "exercises"} on this machine. Tap one to see how it&apos;s done.
            </p>
            <ul className="mt-6 space-y-3" data-machine-exercises>
              {rows.map((r) => {
                const demo = demos.get(r.id);
                const video = demo?.kind === "video" ? signed.get(`${demo.bucket}/${demo.path}`) : undefined;
                return (
                  <li key={r.id}>
                    <Link href={r.catalogItemId ? `/scan/${r.id}?machine=${machine.id}` : `/scan/${r.id}`} className="flex items-center gap-3 min-h-16 p-2 bg-surface border border-steel/20 active:border-rust">
                      {video ? (
                        <video src={`${video}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" className="w-20 h-14 object-cover bg-graphite shrink-0" />
                      ) : (
                        <span aria-hidden="true" className="w-20 h-14 shrink-0 bg-graphite flex items-center justify-center text-steel">
                          <Play className="w-5 h-5" />
                        </span>
                      )}
                      <span className="font-display font-bold uppercase text-lg leading-tight break-words min-w-0">{r.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/* Ron, Nov 20 (S4): any video shown here can be reported. */}
            <ReportVideoLink videos={rows.filter((r) => demos.get(r.id)).map((r) => ({ id: r.id, name: r.name }))} machineId={machine.id} />
          </>
        )}
      </div>
    </main>
  );
}
