"use client";

import { useEffect, useState } from "react";
import type { AiBudgetView } from "@/app/api/ai/usage/route";

// One simple meter for everything the AI does for a coach this month, in plain words: "AI this month: 62% used". At about 80 percent and when it is used up it also says, in Ron's
// own voice, why extra AI use is a paid top-up. While billing is off there is no buy button (the message says AI resumes on the 1st). `banner` shows only when there is
// something to say, for the top of a working screen; the default `meter` always shows.
export function AiBudgetMeter({ variant = "meter", groupId }: { variant?: "meter" | "banner"; groupId?: string }) {
  const [view, setView] = useState<AiBudgetView | null | undefined>(undefined);
  const [buying, setBuying] = useState<number | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  // Opens the payment page for one pack; the pack's dollars are added by the payment webhook, never by this page.
  async function buy(cents: number) {
    if (!groupId) return;
    setBuying(cents);
    setBuyError(null);
    try {
      const res = await fetch("/api/stripe/coach-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ai_topup", groupId, pack: cents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setBuyError(data.error ?? "Couldn't open the payment page. Try again in a minute.");
        setBuying(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setBuyError("Couldn't open the payment page. Try again in a minute.");
      setBuying(null);
    }
  }

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
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">AI</p>
      <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">{view.line}</p>
      <div className="mt-2 h-1.5 bg-steel/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, status.pct)} aria-label="AI used this month">
        <div className={`h-full ${out ? "bg-rust" : status.level === "low" || status.level === "balance" ? "bg-amber-400" : "bg-steel"}`} style={{ width: `${width}%` }} />
      </div>
      {view.balanceLine && <p className="font-body text-sm text-chalk mt-2 [font-variant-numeric:tabular-nums]" data-testid="ai-balance-line">{view.balanceLine}</p>}
      {view.message && <p className="font-body text-xs text-chalk mt-3 leading-relaxed">{view.message}</p>}
      {view.message && view.canBuy && groupId && (
        <div className="flex flex-wrap gap-2 mt-3">
          {view.packs.map((p) => (
            <button
              key={p.cents}
              type="button"
              disabled={buying !== null}
              onClick={() => buy(p.cents)}
              className="min-h-[44px] px-4 py-2 border border-rust text-rust font-body text-sm hover:bg-rust hover:text-chalk transition-colors disabled:opacity-50"
            >
              {buying === p.cents ? "Opening…" : `Add $${p.cents / 100} top-up (+$${p.addUsd.toFixed(2).replace(/\.00$/, "")} of AI)`}
            </button>
          ))}
        </div>
      )}
      {buyError && <p className="font-body text-xs text-rust mt-2" role="alert">{buyError}</p>}
    </div>
  );
}
