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
  initialRate,
}: {
  membershipId: string;
  initialRate: number | null;
}) {
  const [value, setValue] = useState(initialRate?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function persist() {
    setSaving(true);
    const supabase = createBrowserClient();
    const parsed = value.trim() === "" ? null : parseFloat(value);
    await supabase
      .from("group_memberships")
      .update({ monthly_rate: Number.isFinite(parsed as number) ? parsed : null })
      .eq("id", membershipId);
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-1">
      <span className="font-body text-xs text-steel">$</span>
      <input
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={persist}
        placeholder="—"
        disabled={saving}
        className="w-16 h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs disabled:opacity-50"
      />
      <span className="font-body text-xs text-steel">/mo</span>
    </div>
  );
}
