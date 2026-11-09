"use client";

import { useState } from "react";

type ConnectStatus = "not_connected" | "pending" | "ready";

const STATUS_LABEL: Record<ConnectStatus, string> = {
  not_connected: "Not connected",
  pending: "Finishing setup",
  ready: "Ready",
};

// Where a coach connects their own Stripe account and sees whether clients can pay them. Every payment goes straight to this account; Spotlight never holds it.
export function StripeConnectPanel({ groupId, status, isOwner, feePercent }: { groupId: string; status: ConnectStatus; isOwner: boolean; feePercent: number | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || fallback);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      setBusy(false);
    }
  }

  const line =
    status === "ready"
      ? "Clients can buy your packages. Their payments go straight to your Stripe account."
      : status === "pending"
      ? "Stripe needs a little more from you before clients can pay. Until then you can still assign packages by hand."
      : "Connect your own Stripe account so clients can pay you here. Until then you can still assign packages by hand.";

  return (
    <section className="border border-steel/20 bg-surface/40 p-4 mb-8" data-stripe-connect>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Getting paid</p>
          <p className={`font-body text-sm font-medium mt-0.5 ${status === "ready" ? "text-positive" : "text-chalk"}`}>{STATUS_LABEL[status]}</p>
        </div>
        {isOwner &&
          (status === "ready" ? (
            <button type="button" onClick={() => go("/api/stripe/connect/dashboard", "Couldn't open Stripe.")} disabled={busy} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              {busy ? "Opening…" : "See payments and bank in Stripe"}
            </button>
          ) : (
            <button type="button" onClick={() => go("/api/stripe/connect/onboard", "Couldn't start Stripe onboarding.")} disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Opening…" : status === "pending" ? "Finish setup on Stripe" : "Connect Stripe"}
            </button>
          ))}
      </div>
      <p className="font-body text-xs text-steel mt-2 max-w-[70ch]">{line}</p>
      {!isOwner && status !== "ready" && <p className="font-body text-xs text-steel mt-1">Your organization&apos;s owner connects Stripe.</p>}
      {feePercent != null && <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">Spotlight&apos;s fee is {feePercent}% of each payment made in the app. Stripe&apos;s own card fee also comes out of your account.</p>}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
