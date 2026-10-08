"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Inline "$/mo" rate input for one client membership row on the Business
// dashboard — persists on blur, same pattern as the coach note editor.
// This is the manual stand-in for real billing data until Stripe is
// wired up: the coach types in what a client actually pays today, and
// the dashboard's Estimated MRR figure sums these.
export function ClientRateEditor({
  membershipId,
  groupId,
  athleteId,
  initialRate,
}: {
  membershipId: string;
  groupId: string;
  athleteId: string;
  initialRate: number | null;
}) {
  const [value, setValue] = useState(initialRate?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The rate lives in client_billing_rates (coach-only, 0303); an empty box removes the row. A failed save says so and keeps what was typed.
  async function persist() {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const parsed = value.trim() === "" ? null : parseFloat(value);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000)) {
      setError("Use an amount from 0 to 100,000.");
      setSaving(false);
      return;
    }
    const res =
      parsed === null
        ? await supabase.from("client_billing_rates").delete().eq("membership_id", membershipId)
        : await supabase
            .from("client_billing_rates")
            .upsert(
              { membership_id: membershipId, group_id: groupId, profile_id: athleteId, monthly_rate: parsed, updated_at: new Date().toISOString() },
              { onConflict: "membership_id" }
            );
    if (res.error) setError("That didn't save.");
    setSaving(false);
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <span className="font-body text-xs text-steel">$</span>
        <input
          type="number"
          min={0}
          max={100000}
          step="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={persist}
          placeholder="—"
          disabled={saving}
          aria-invalid={error != null}
          className="w-16 h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs disabled:opacity-50"
        />
        <span className="font-body text-xs text-steel">/mo</span>
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
