"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// One section of the expandable roster wall — collapsed to a single
// summary row by default, expanding in place (no modal, no navigation)
// on click (coach_dashboard_redesign_scoping.md). A quiet-count badge on
// the collapsed row lets a coach spot a section worth opening without
// expanding every one of them first.
export function RosterSection({
  title,
  summary,
  needsAttentionCount,
  defaultExpanded = false,
  children,
}: {
  title: string;
  summary: string;
  needsAttentionCount?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-steel/20 bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-steel shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-steel shrink-0" />
          )}
          <div>
            <p className="font-display uppercase text-sm tracking-wide text-steel">{title}</p>
            <p className="font-body text-xs text-steel mt-0.5">{summary}</p>
          </div>
        </div>
        {!!needsAttentionCount && needsAttentionCount > 0 && (
          <span className="font-body text-[10px] text-rust border border-rust/40 px-2 py-0.5 uppercase tracking-wide">
            {needsAttentionCount} need{needsAttentionCount === 1 ? "s" : ""} attention
          </span>
        )}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
