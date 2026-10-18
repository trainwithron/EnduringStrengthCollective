"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelMyEmailChangeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/email-change/cancel-mine", { method: "POST" });
      if (!res.ok) throw new Error("That didn't work. Try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={cancel} disabled={busy} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50">
        {busy ? "Cancelling…" : "Cancel the change"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
