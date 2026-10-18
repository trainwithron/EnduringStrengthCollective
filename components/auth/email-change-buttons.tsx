"use client";

import { useState } from "react";

// The one button on /email-change. Pressing it is what confirms (or cancels) the change.
export function EmailChangeButtons({ token, mode }: { token: string; mode: "confirm" | "cancel" }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/email-change/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      setDone(mode === "confirm" ? "Done. Your sign-in email is changed. Sign in with the new address from now on." : "Cancelled. Nothing was changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="font-body text-sm text-positive mt-4" role="status">
        {done}
      </p>
    );
  }
  return (
    <div className="mt-4">
      <button type="button" onClick={go} disabled={busy} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
        {busy ? "Working…" : mode === "confirm" ? "Confirm this email" : "Cancel the change"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
