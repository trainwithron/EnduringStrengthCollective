"use client";

import { useState } from "react";
import { PLAN_PRICES_CENTS } from "@/lib/coach-plan-pricing";

// "Choose the paid plan" (Ron, Nov 20): opens Stripe Checkout for the coach plan (app/api/stripe/plan-checkout). Until the plan's Stripe price is set up it says so instead of opening anything.
export function PlanUpgradeButton({ organizationId, groupId, available }: { organizationId: string; groupId: string | null; available: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy || !available) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/plan-checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, groupId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") throw new Error(data.error || "Couldn't open checkout. Try again.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open checkout. Try again.");
      setBusy(false);
    }
  }

  return (
    <div data-plan-upgrade>
      <button type="button" onClick={start} disabled={busy || !available} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
        {!available ? "Paid plan: not available yet" : busy ? "Opening…" : `Choose the paid plan ($${PLAN_PRICES_CENTS.base / 100}/mo)`}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
