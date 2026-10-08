"use client";

import { useState } from "react";
import { LIFT_OFF_MONTHLY_CREDITS } from "@/lib/coach-credits";
import { AiUsageMeter } from "@/components/coach/ai-usage-meter";
import { AiBudgetMeter } from "@/components/coach/ai-budget-meter";

// credit_topup_low_tier_monetization_idea.md — the coach's own AI
// credits (program generation, nutrition plans), genuinely separate
// from everything else billed in this app. The Lift Off subscription is
// retired (the plan now includes AI each month): its purchase UI is hidden
// here, the code and any existing subscriber display are kept. Mirrors package-picker.tsx's
// exact checkout-call shape, pointed at the new coach-only route.
export function CoachCreditsPanel({
  groupId,
  balance,
  unlimited,
  liftOffActive,
  purchaseAvailable = true,
}: {
  groupId: string;
  balance: number;
  unlimited: boolean;
  liftOffActive: boolean;
  // False when payments are not set up yet: there is nothing to buy, so no buy button is shown.
  purchaseAvailable?: boolean;
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
      <div className="mb-4">
        <AiBudgetMeter groupId={groupId} />
      </div>
      <AiUsageMeter groupId={groupId} />

      <p className="font-body text-sm text-steel mb-4">
        AI program generation and full nutrition plans are included in your plan each month. Past
        the included amount, each program generation (3 credits) and each nutrition plan (3
        credits, charged once for the whole plan) draws from this balance. Nav and UI help are
        always free.
      </p>

      <div className="border border-steel/20 p-4 mb-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Your balance</p>
        {unlimited ? (
          <p className="font-display text-2xl uppercase text-rust">Unlimited</p>
        ) : (
          <p className="font-display text-2xl uppercase">{balance} credits</p>
        )}
        {liftOffActive && (
          <p className="font-body text-xs text-rust mt-1">
            Lift Off active — {LIFT_OFF_MONTHLY_CREDITS} credits every month
          </p>
        )}
      </div>

      {error && (
        <p className="font-body text-xs text-rust mb-3" role="alert">
          {error}
        </p>
      )}

      {!purchaseAvailable && (
        <p className="font-body text-xs text-steel">
          Extra credits aren&apos;t available to buy yet. Your plan includes AI generations each month.
        </p>
      )}
      <div className={purchaseAvailable ? "flex flex-wrap gap-3" : "hidden"}>
        <button
          type="button"
          disabled={!!loadingKind}
          onClick={() => buy("credit_pack")}
          className="h-10 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
        >
          {loadingKind === "credit_pack" ? "Starting checkout…" : "Buy 5 credits — $5"}
        </button>
      </div>
    </div>
  );
}
