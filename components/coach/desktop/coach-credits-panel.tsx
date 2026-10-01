"use client";

import { useState } from "react";

// credit_topup_low_tier_monetization_idea.md — the coach's own AI
// credits (program generation, nutrition plans), genuinely separate
// from everything else billed in this app. Mirrors package-picker.tsx's
// exact checkout-call shape, pointed at the new coach-only route.
export function CoachCreditsPanel({
  groupId,
  balance,
  unlimited,
  liftOffActive,
}: {
  groupId: string;
  balance: number;
  unlimited: boolean;
  liftOffActive: boolean;
}) {
  const [loadingKind, setLoadingKind] = useState<"credit_pack" | "lift_off" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(kind: "credit_pack" | "lift_off") {
    if (loadingKind) return;
    setLoadingKind(kind);
    setError(null);
    try {
      const res = await fetch("/api/stripe/coach-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, groupId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start checkout.");
      setLoadingKind(null);
    }
  }

  return (
    <div className="max-w-[60ch]">
      <p className="font-body text-sm text-steel mb-4">
        AI program generation (3 credits) and a full nutrition plan (3 credits, charged once for
        the whole plan) draw from this balance. Nav and UI help are always free.
      </p>

      <div className="border border-steel/20 p-4 mb-4">
        <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">Your balance</p>
        {unlimited ? (
          <p className="font-display text-2xl uppercase text-rust">Unlimited</p>
        ) : (
          <p className="font-display text-2xl uppercase">{balance} credits</p>
        )}
        {liftOffActive && (
          <p className="font-body text-xs text-rust mt-1">Lift Off active — 9 credits every month</p>
        )}
      </div>

      {error && (
        <p className="font-body text-xs text-rust mb-3" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!!loadingKind}
          onClick={() => buy("credit_pack")}
          className="h-10 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
        >
          {loadingKind === "credit_pack" ? "Starting checkout…" : "Buy 5 credits — $5"}
        </button>
        {!liftOffActive && (
          <button
            type="button"
            disabled={!!loadingKind}
            onClick={() => buy("lift_off")}
            className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
          >
            {loadingKind === "lift_off" ? "Starting checkout…" : "Get Lift Off — $5/mo"}
          </button>
        )}
      </div>
      <p className="font-body text-[11px] text-steel mt-2">
        Lift Off is a recurring $5/month bundle — 9 credits of AI access every cycle, only
        available on auto-renew.
      </p>
    </div>
  );
}
