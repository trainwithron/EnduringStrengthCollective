"use client";

import { useState } from "react";

// label/className: the failed-payment note on Home uses the same portal as a button that says what it is for ("Update my card").
export function ManageBillingLink({ groupId, label = "Manage billing", className = "min-h-11 font-body text-sm text-rust-ink disabled:opacity-40" }: { groupId: string; label?: string; className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't open billing portal.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing portal.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={className}
      >
        {loading ? "Opening…" : label}
      </button>
      {error && (
        <p className="font-body text-xs text-rust-ink mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
