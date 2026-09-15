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
  variant = "flat",
  children,
}: {
  title: React.ReactNode;
  summary: string;
  needsAttentionCount?: number;
  defaultExpanded?: boolean;
  // "glow" per v3_visual_polish_mockup_sept15.md's "Finished Picture" —
  // reserved for the rare one-time-setup block (Suggestion Settings) that
  // should read as a distinct, intentional card rather than blend into
  // the flat background behind it. Every roster listing (clients,
  // groups) stays "flat" — the glow language is spent on things that
  // deserve attention, not on every collapsible section.
  variant?: "flat" | "glow";
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const glow = variant === "glow";

  return (
    <div
      className={
        glow
          ? "border border-rust/30 bg-surface rounded-token-lg shadow-[0_0_0_1px_rgb(var(--rust)/0.15),0_0_20px_rgb(var(--rust)/0.10)]"
          : "border border-steel/20 bg-surface"
      }
    >
      {/* A plain div, not a <button> — the title can contain a real
          SwappableTerm button (word-swap terminology), and nested
          buttons are invalid HTML. SwappableTerm stops its own click
          from propagating, so picking a term doesn't also toggle this
          section. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
        className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className={`w-4 h-4 shrink-0 ${glow ? "text-rust" : "text-steel"}`} />
          ) : (
            <ChevronRight className={`w-4 h-4 shrink-0 ${glow ? "text-rust" : "text-steel"}`} />
          )}
          <div>
            {glow && (
              <p className="font-body text-[10px] text-rust uppercase tracking-wide mb-0.5">
                One-time setup
              </p>
            )}
            <p
              className={`font-display uppercase text-sm tracking-wide ${
                glow ? "text-chalk" : "text-steel"
              }`}
            >
              {title}
            </p>
            <p className="font-body text-xs text-steel mt-0.5">{summary}</p>
          </div>
        </div>
        {!!needsAttentionCount && needsAttentionCount > 0 && (
          <span className="font-body text-[10px] text-rust border border-rust/40 px-2 py-0.5 uppercase tracking-wide">
            {needsAttentionCount} need{needsAttentionCount === 1 ? "s" : ""} attention
          </span>
        )}
      </div>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
