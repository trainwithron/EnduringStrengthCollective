"use client";

import { useEffect, useState } from "react";
import type { AiBudgetView } from "@/app/api/ai/usage/route";

// One simple meter for everything the AI does for a coach this month, in plain words: "AI this month: 62% used". At about 80 percent and when it is used up it also says, in Ron's
// own voice, why extra AI use is a paid top-up. While billing is off there is no buy button (the message says AI resumes on the 1st). `banner` shows only when there is
// something to say, for the top of a working screen; the default `meter` always shows.
export function AiBudgetMeter({ variant = "meter" }: { variant?: "meter" | "banner" }) {
  const [view, setView] = useState<AiBudgetView | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setView((data?.budget as AiBudgetView | null | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!view || view.status.unlimited) return null;
  if (variant === "banner" && !view.message) return null;

  const { status } = view;
  const out = status.level === "out";
  const width = Math.min(100, status.pct);
  return (
    <div className={`border p-4 ${view.message ? (out ? "border-rust/60" : "border-amber-400/50") : "border-steel/20"}`} data-testid="ai-budget-meter">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">AI this month</p>
      <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">{view.line}</p>
      <div className="mt-2 h-1.5 bg-steel/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, status.pct)} aria-label="AI used this month">
        <div className={`h-full ${out ? "bg-rust" : status.level === "low" ? "bg-amber-400" : "bg-steel"}`} style={{ width: `${width}%` }} />
      </div>
      {view.message && <p className="font-body text-xs text-chalk mt-3 leading-relaxed">{view.message}</p>}
    </div>
  );
}
