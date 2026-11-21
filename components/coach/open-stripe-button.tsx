"use client";

import { useState } from "react";

// "Open Stripe" on a dispute in Payment problems (audit, Nov 21): a dispute is answered in the owner's own Stripe dashboard, so this opens it, through the same check as the Getting paid
// panel's button (/api/stripe/connect/dashboard: only the organization's owner, only once Stripe is set up). Anyone else is told why in plain words.
export function OpenStripeButton({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/connect/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") throw new Error(data.error || "Couldn't open Stripe.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open Stripe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <button type="button" onClick={open} disabled={busy} className="inline-flex items-center min-h-11 font-body text-sm font-semibold text-rust-ink hover:underline underline-offset-2 disabled:opacity-40">
        {busy ? "Opening…" : "Open Stripe"}
      </button>
      {error && (
        <span className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
