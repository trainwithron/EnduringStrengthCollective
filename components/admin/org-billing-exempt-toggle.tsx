"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Platform-admin-only: marks an organization as a founding/internal
// account (full features, never charged). Writes straight to
// organization_billing — RLS only lets the platform admin do that.
export function OrgBillingExemptToggle({
  organizationId,
  initialExempt,
}: {
  organizationId: string;
  initialExempt: boolean;
}) {
  const [exempt, setExempt] = useState(initialExempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !exempt;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: err } = await supabase.from("organization_billing").upsert(
      {
        organization_id: organizationId,
        billing_exempt: next,
        exempt_reason: next ? "Marked exempt by platform admin" : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );
    if (err) {
      setError("Couldn't save that.");
    } else {
      setExempt(next);
    }
    setBusy(false);
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={exempt}
        className={`h-8 px-3 border font-body text-xs disabled:opacity-50 ${
          exempt ? "border-rust text-rust" : "border-steel/30 text-steel"
        }`}
      >
        {exempt ? "Exempt from billing" : "Billed normally"}
      </button>
      {error && (
        <p className="font-body text-[11px] text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
