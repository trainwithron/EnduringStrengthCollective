"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export const UPCOMING_SHOWN = 3;

// The coach's phone Calendar, under the month (Ron, Oct 19: "the upcoming sessions is it's long and could be collapsed"): the first 3, then one quiet
// row that shows the rest in place, and "Show fewer" folds them back.
// Each row opens its day (Ron, Nov 21: the rows were only text), where the session's menu, profile and logging are.
export function UpcomingSessionsList({ rows }: { rows: { id: string; name: string; when: string; href?: string }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, UPCOMING_SHOWN);
  return (
    <div className="divide-y divide-steel/15 border-t border-steel/15" data-upcoming-sessions>
      {shown.map((r) =>
        r.href ? (
          <Link key={r.id} href={r.href} prefetch={false} className="py-2.5 min-h-11 flex items-center justify-between gap-3" data-upcoming-row>
            <span className="font-body text-sm min-w-0 truncate">{r.name}</span>
            <span className="font-body text-xs text-steel shrink-0 inline-flex items-center gap-1">
              {r.when}
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          </Link>
        ) : (
          <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-body text-sm">{r.name}</span>
            <span className="font-body text-xs text-steel shrink-0">{r.when}</span>
          </div>
        )
      )}
      {rows.length > UPCOMING_SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="w-full min-h-11 text-left font-body text-xs text-steel underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${rows.length} upcoming`}
        </button>
      )}
    </div>
  );
}
