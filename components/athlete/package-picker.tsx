"use client";

import { useState } from "react";

export interface PackageOption {
  id: string;
  name: string;
  sessionsPerWeek: number;
  billingType: "subscription" | "one_time";
  sessionsGranted: number;
  rateCents: number;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Replaces the old fixed BuyCreditsButton/SubscribeButton pair — those
// posted a hardcoded {groupId, kind}; every coach now defines their own
// packages, so this lists whatever that specific coach actually sells
// instead of one global option.
export function PackagePicker({ packages }: { packages: PackageOption[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(packageId: string) {
    if (loadingId) return;
    setLoadingId(packageId);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start checkout.");
      setLoadingId(null);
    }
  }

  if (packages.length === 0) {
    return <p className="font-body text-sm text-steel">Your coach hasn&apos;t set up any packages yet.</p>;
  }

  return (
    <div className="space-y-3">
      {packages.map((pkg) => {
        const total = pkg.rateCents * pkg.sessionsGranted;
        return (
          <div key={pkg.id} className="border border-steel/20 p-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-body text-sm font-medium">{pkg.name}</p>
              <p className="font-body text-[11px] text-steel mt-0.5">
                {pkg.sessionsPerWeek}x/week &middot; {formatDollars(pkg.rateCents)}/session &middot;{" "}
                {pkg.billingType === "subscription" ? "Recurring" : "One-time"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleBuy(pkg.id)}
              disabled={loadingId === pkg.id}
              className="h-9 px-3.5 shrink-0 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {loadingId === pkg.id
                ? "Redirecting…"
                : `${pkg.billingType === "subscription" ? "Subscribe" : "Buy"} ${formatDollars(total)}${
                    pkg.billingType === "subscription" ? "/mo" : ""
                  }`}
            </button>
          </div>
        );
      })}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
