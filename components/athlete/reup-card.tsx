"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReupState } from "@/lib/reup-server";
import { NO_SESSIONS_LINE } from "@/lib/session-credit-copy";

// Shown to a client whose sessions have run out. One tap buys the package they bought last (or the one their coach assigned);
// with no package, or with payments not switched on, it points them at their coach. When a session is booked within a day it
// leads with that, so the prompt arrives when it matters. Neutral wording throughout.
export function ReupCard({ state }: { state: ReupState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    if (!state.package || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: state.package.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  }

  const canBuy = !!state.package && state.canPay;

  return (
    <div className="border border-steel/30 bg-surface/40 p-4" role="region" aria-label="Add sessions">
      {state.nextSessionLabel ? (
        <>
          <p className="font-body text-sm text-chalk">Your session is {state.nextSessionLabel}.</p>
          <p className="font-body text-xs text-steel mt-1">{NO_SESSIONS_LINE}. Add sessions to keep it.</p>
        </>
      ) : (
        <p className="font-body text-sm text-chalk">{NO_SESSIONS_LINE}.</p>
      )}

      <div className="mt-3">
        {canBuy && state.package ? (
          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="w-full sm:w-auto bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2.5 disabled:opacity-40"
          >
            {busy ? "Opening checkout…" : `Re-up: ${state.package.name} · ${state.package.priceLabel}`}
          </button>
        ) : (
          <Link
            href={`/groups/${state.groupId}/messages`}
            className="inline-block bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2.5"
          >
            Message your coach to re-up
          </Link>
        )}
        {canBuy && state.package && (
          <p className="font-body text-xs text-steel mt-2">
            {state.package.sessions} {state.package.sessions === 1 ? "session" : "sessions"}
            {state.package.recurring ? ", renews monthly" : ""}.
          </p>
        )}
        {error && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
