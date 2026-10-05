"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface RosterOption {
  profileId: string;
  fullName: string;
}

// Quick Payment (mobile_more_tab_condensed_widget_hub_sept30.md) — a
// real, minimal one-off charge: pick a client, type an amount, confirm,
// charge. Deliberately not a full invoicing system — no line items, no
// saved drafts, no recurring schedule. Reuses the exact same Stripe-
// Checkout-redirect mechanism already proven by
// components/athlete/package-picker.tsx (fetch the checkout route, then
// `window.location.href = data.url`), just coach-initiated with a
// coach-typed amount instead of a client picking a pre-set package.
export function QuickPaymentPanel({ groupId }: { groupId: string }) {
  const [roster, setRoster] = useState<RosterOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RosterOption | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .eq("group_id", groupId)
        .eq("role", "athlete")
        .order("profiles(full_name)", { ascending: true });
      if (!cancelled) {
        setRoster(
          (data ?? []).map((r: any) => ({
            profileId: r.profile_id,
            fullName: r.profiles?.full_name ?? "Unknown",
          }))
        );
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const filtered = (roster ?? []).filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()));
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const canSubmit = !!selected && amountCents >= 100 && !submitting;

  async function handleCharge() {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/quick-payment-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId: selected.profileId, amountCents, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto p-4 space-y-4">
      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">Client</label>
        {selected ? (
          <div className="mt-1 flex items-center justify-between border border-rust/40 bg-rust/5 px-3 h-10">
            <span className="font-body text-sm text-chalk">{selected.fullName}</span>
            <button type="button" onClick={() => setSelected(null)} className="font-body text-xs text-rust">
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
            <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-steel/10 border border-steel/20">
              {roster === null ? (
                <p className="font-body text-xs text-steel p-3">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="font-body text-xs text-steel p-3">No matching clients.</p>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.profileId}
                    type="button"
                    onClick={() => setSelected(r)}
                    className="w-full text-left px-3 py-2 font-body text-sm text-chalk active:bg-surface/60"
                  >
                    {r.fullName}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">Amount ($)</label>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-display text-xl focus:outline-none focus:border-rust"
        />
      </div>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">What for? (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Extra session, late fee"
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleCharge}
        disabled={!canSubmit}
        className="w-full h-12 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {submitting
          ? "Starting checkout…"
          : amountCents > 0
          ? `Charge $${(amountCents / 100).toFixed(2)}`
          : "Charge"}
      </button>
      <p className="font-body text-xs text-steel">
        You&apos;ll be taken to a secure Stripe checkout page to complete the charge.
      </p>
    </div>
  );
}
