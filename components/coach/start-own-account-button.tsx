"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// "Keep my clients and everything: start my own account." The move itself is done by the server (app/api/coach/start-own-account), which refuses anyone who was let go or whose seven days are over.
export function StartOwnAccountButton({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!(await confirmDialog({ message: `Start your own account? Your clients, their history, programs and credits, your shop links, classes and calendar move into an account you own, and it starts on the standard free trial. This ends your time with ${organizationName}.`, confirmLabel: "Start my account" }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/start-own-account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't start your account. Try again.");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={start} disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
        {busy ? "Starting…" : "Start my own account"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
