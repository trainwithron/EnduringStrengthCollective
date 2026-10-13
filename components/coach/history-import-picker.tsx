"use client";

import { useState } from "react";
import { FitprosHistoryImport } from "@/components/coach/fitpros-history-import";

// ONE "Import" button on the History page. Pressing it asks where the history comes from; only sources that exist are listed (FitPros now; a spreadsheet uses the upload below). More sources
// are added to this list as they are built, so the page stays uncluttered.
export function HistoryImportPicker({ athleteId, groupId, athleteName }: { athleteId: string; groupId: string; athleteName: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"fitpros" | null>(null);

  if (source === "fitpros") {
    return (
      <div className="mt-8">
        <button type="button" onClick={() => setSource(null)} className="min-h-11 font-body text-sm text-steel underline underline-offset-2">
          &larr; Choose another source
        </button>
        <FitprosHistoryImport athleteId={athleteId} groupId={groupId} athleteName={athleteName} />
      </div>
    );
  }

  return (
    <div className="mt-8 max-w-3xl">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-5">
        Import
      </button>
      {open && (
        <div className="mt-3 border border-steel/25 bg-surface/40 p-3" aria-label="Where is the history from?">
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Where is the history from?</p>
          <ul className="divide-y divide-steel/15">
            <li>
              <button type="button" onClick={() => setSource("fitpros")} className="w-full text-left min-h-11 px-1 font-body text-sm text-chalk hover:bg-graphite/50">
                FitPros
              </button>
            </li>
            <li>
              <a href="#history-upload" onClick={() => setOpen(false)} className="flex items-center min-h-11 px-1 font-body text-sm text-chalk hover:bg-graphite/50">
                Other (CSV or Excel)
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
