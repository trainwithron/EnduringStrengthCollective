"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { InbodyScanFlow } from "@/components/body/inbody-scan-flow";
import { canDeleteScan, parseScanRows, scanSeries, scanSummary, type ScanRow } from "@/lib/inbody-series";

const dayLabel = (key: string) => new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// A person's InBody scans: add one from a photo (the person or their coach), the scans so far with the photo of each sheet, and a graph each for weight, percent body fat, skeletal muscle and fat mass.
// Used on the client's own screen next to their weigh-ins and on the coach's Progress tab: the same rows, read through row security.
export function InbodyScansSection({ athleteId, groupId, viewerId, athleteName }: { athleteId: string; groupId: string; viewerId: string; athleteName: string }) {
  const [scans, setScans] = useState<ScanRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await createBrowserClient()
      .from("body_scans")
      .select("id, athlete_id, uploaded_by, scan_date, weight_lb, skeletal_muscle_lb, body_fat_mass_lb, percent_body_fat, lean_mass_lb, photo_path, source")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("scan_date", { ascending: false })
      .limit(200);
    setScans(parseScanRows(data));
  }, [athleteId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const series = useMemo(() => scanSeries(scans ?? []), [scans]);

  async function viewSheet(path: string) {
    const { data } = await createBrowserClient().storage.from("inbody-scans").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else setError("Couldn't open the photo. Try again.");
  }

  async function remove(row: ScanRow) {
    if (busyId) return;
    const sure = await confirmDialog({
      message: "Delete this scan and its photo? A weigh-in made from it stays in the weight log.",
      confirmLabel: "Delete scan",
      destructive: true,
    });
    if (!sure) return;
    setBusyId(row.id);
    setError(null);
    const supabase = createBrowserClient();
    if (row.photo_path) {
      const gone = await supabase.storage.from("inbody-scans").remove([row.photo_path]);
      if (gone.error) {
        setBusyId(null);
        setError("Couldn't delete the photo. Try again.");
        return;
      }
    }
    const { data, error: problem } = await supabase.from("body_scans").delete().eq("id", row.id).select("id");
    setBusyId(null);
    if (problem || !data || data.length === 0) {
      setError("Couldn't delete the scan. Try again.");
      return;
    }
    await load();
  }

  return (
    <section aria-labelledby={`inbody-heading-${athleteId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h2 id={`inbody-heading-${athleteId}`} className="font-display uppercase text-sm tracking-wide text-steel">
          InBody scans
        </h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 font-body text-sm text-rust underline underline-offset-2">
            Scan an InBody sheet
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4">
          <InbodyScanFlow
            athleteId={athleteId}
            groupId={groupId}
            viewerId={viewerId}
            athleteName={athleteName}
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void load();
            }}
          />
        </div>
      )}

      {scans === null ? (
        <p className="font-body text-sm text-steel py-2">Loading…</p>
      ) : scans.length === 0 ? (
        !adding && <p className="font-body text-sm text-steel py-2">No InBody scans yet. Take a photo of a result sheet and the numbers are kept here, with the photo.</p>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 mb-4">
            {series.map((s) => (
              <div key={s.key}>
                <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">{s.title}</p>
                <TrendChart points={s.points} unit={s.unit} emptyLabel={s.points.length === 0 ? "Not on any scan yet." : "Needs a second scan to draw a graph."} />
              </div>
            ))}
          </div>
          <ul className="divide-y divide-steel/15">
            {scans.map((row) => (
              <li key={row.id} className="py-3 font-body text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-chalk">{dayLabel(row.scan_date)}</span>
                  <span className="text-steel">{scanSummary(row)}</span>
                </div>
                {row.source === "photo" && <p className="text-xs text-steel mt-0.5">Imported from a photo, check the numbers.</p>}
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {row.photo_path && (
                    <button type="button" onClick={() => void viewSheet(row.photo_path as string)} className="min-h-11 text-xs text-rust underline underline-offset-2">
                      View the sheet
                    </button>
                  )}
                  {canDeleteScan(row, viewerId) && (
                    <button type="button" disabled={busyId === row.id} onClick={() => void remove(row)} className="min-h-11 text-xs text-steel underline underline-offset-2 disabled:opacity-40">
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
