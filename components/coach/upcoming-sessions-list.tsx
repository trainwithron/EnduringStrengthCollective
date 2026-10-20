"use client";

import { useState } from "react";

export const UPCOMING_SHOWN = 3;

// The coach's phone Calendar, under the month (Ron, Oct 19: "the upcoming sessions is it's long and could be collapsed"): the first 3, then one quiet
// row that shows the rest in place, and "Show fewer" folds them back.
export function UpcomingSessionsList({ rows }: { rows: { id: string; name: string; when: string }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, UPCOMING_SHOWN);
  return (
    <div className="divide-y divide-steel/15 border-t border-steel/15" data-upcoming-sessions>
      {shown.map((r) => (
        <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
          <span className="font-body text-sm">{r.name}</span>
          <span className="font-body text-xs text-steel shrink-0">{r.when}</span>
        </div>
      ))}
      {rows.length > UPCOMING_SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="w-full min-h-11 text-left font-body text-xs text-steel underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${rows.length} upcoming`}
        </button>
      )}
    </div>
  );
}
