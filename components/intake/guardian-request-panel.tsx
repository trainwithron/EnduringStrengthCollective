"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GuardianConsentState } from "@/lib/guardian-consent";

// What a client aged 13 to 17 sees until a parent or guardian has signed: who to ask, and where the request stands. The client never signs for themselves; the guardian gets a one-time link in their own inbox.
export function GuardianRequestPanel({ state, guardianEmail, requestedAt, coachName }: { state: GuardianConsentState; guardianEmail: string | null; requestedAt: string | null; coachName: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [asking, setAsking] = useState(state !== "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(to: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian-consent/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guardianEmail: to }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Couldn't send the request. Try again.");
        setBusy(false);
        return;
      }
      setAsking(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Couldn't send the request. Try again.");
      setBusy(false);
    }
  }

  const when = requestedAt ? new Date(requestedAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;

  return (
    <div className="border border-steel/20 p-6 space-y-4">
      {state === "withdrawn" && (
        <p className="font-body text-sm text-rust" role="status">
          A parent or guardian took back their permission, so training is paused until they give it again.
        </p>
      )}
      <p className="font-body text-sm">
        Because you&apos;re under 18, a parent or legal guardian has to read and agree before you can start with {coachName ?? "your coach"}. You don&apos;t sign this yourself. We email them a private link; they read it and sign.
      </p>

      {!asking && state === "pending" ? (
        <div className="space-y-3">
          <p className="font-body text-sm text-chalk">
            We emailed <span className="font-medium">{guardianEmail}</span>
            {when ? ` on ${when}` : ""}. Waiting for them to sign.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => router.refresh()} className="font-body text-xs text-steel uppercase tracking-wide underline">
              Check again
            </button>
            {guardianEmail && (
              <button type="button" onClick={() => send(guardianEmail)} disabled={busy} className="font-body text-xs text-steel uppercase tracking-wide underline disabled:opacity-40">
                Send it again
              </button>
            )}
            <button type="button" onClick={() => setAsking(true)} className="font-body text-xs text-steel uppercase tracking-wide underline">
              Use a different email
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor="guardian-email" className="font-body text-sm text-chalk block">
            Your parent&apos;s or guardian&apos;s email
          </label>
          <input
            id="guardian-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
          />
          <p className="font-body text-xs text-steel">It has to be their own email, not yours.</p>
          {error && (
            <p className="font-body text-sm text-rust" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => send(email)}
            disabled={!email.trim() || busy}
            className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
          >
            {busy ? "Sending…" : "Send the request"}
          </button>
          {state === "pending" && (
            <button type="button" onClick={() => setAsking(false)} className="font-body text-xs text-steel underline">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
