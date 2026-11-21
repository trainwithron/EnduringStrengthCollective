"use client";

import { useState } from "react";
import { reportReasonLabel } from "@/lib/video-reports";

export interface VideoReportRow {
  id: string;
  what: string;
  where: "shared_list" | "exercise";
  reason: string;
  note: string | null;
  sentAt: string;
  scanHref: string | null;
}

// Reports sent from the public scan pages (Ron, Nov 20, S4), on the Machine requests page: remove the video in one tap, or dismiss the report.
export function VideoReportsList({ initial }: { initial: VideoReportRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "remove" | "dismiss") {
    setBusy(id);
    setError(null);
    const res = await fetch("/api/admin/video-reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setError(out?.error ?? "That didn't save. Try again.");
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <section id="reports" className="mt-10 max-w-2xl scroll-mt-6">
      <h2 className="font-display font-bold text-xl uppercase leading-none">Reported videos</h2>
      {rows.length === 0 ? (
        <p className="font-body text-sm text-steel mt-2">Nothing reported.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="border border-steel/30 bg-surface p-3 space-y-2">
              <p className="font-body text-[15px] text-chalk font-medium break-words">{r.what}</p>
              <p className="font-body text-sm text-chalk">{reportReasonLabel(r.reason)}</p>
              {r.note && <p className="font-body text-sm text-steel break-words">&ldquo;{r.note}&rdquo;</p>}
              <p className="font-body text-xs text-steel">
                {r.where === "shared_list" ? "A demo on the shared machine list (every gym with this machine)." : "A gym's own exercise demo."} Sent {new Date(r.sentAt).toLocaleString()}.
                {r.scanHref && (
                  <>
                    {" "}
                    <a href={r.scanHref} target="_blank" rel="noopener noreferrer" className="underline">
                      See it
                    </a>
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void act(r.id, "remove")} disabled={busy === r.id} className="flex-1 min-h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                  Remove the video
                </button>
                <button type="button" onClick={() => void act(r.id, "dismiss")} disabled={busy === r.id} className="flex-1 min-h-11 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="font-body text-xs text-rust-ink mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
