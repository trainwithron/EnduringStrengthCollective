"use client";

import { useMemo, useState } from "react";
import { RELATIONSHIPS, US_STATES, guardianPacketText } from "@/lib/guardian-consent";
import { confirmDialog } from "@/components/shared/confirm-dialog";

type Done = { text: string; emailedCopy: boolean } | null;

// The guardian reads the words, says who they are and where they live, ticks two boxes and signs by typing their name. Once signed the same page offers to take the permission back. The words shown here are made
// by the same function the server uses to record what was signed.
export function GuardianConsentForm({ token, childName, coachName, signed }: { token: string; childName: string; coachName: string | null; signed: { name: string; relationship: string; at: string } | null }) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [state, setState] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [mayRefuse, setMayRefuse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  const text = useMemo(() => guardianPacketText({ athleteName: childName, coachName, state: state || null }), [childName, coachName, state]);

  async function sign() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The fingerprint of the exact words on the screen: the server signs only if it would show the same words.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const shown = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const res = await fetch("/api/guardian-consent/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, relationship, state, understood, mayRefuse, shown }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Couldn't record that. Try again.");
      } else {
        setDone({ text: d.text, emailedCopy: !!d.emailedCopy });
      }
    } catch {
      setError("Couldn't record that. Check your connection and try again.");
    }
    setBusy(false);
  }

  async function withdraw() {
    if (busy) return;
    if (!(await confirmDialog({ message: `Take back your permission for ${childName}? They won't be able to use the app until a parent or guardian gives permission again.`, confirmLabel: "Withdraw", destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian-consent/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? "Couldn't do that. Try again.");
      else setWithdrawn(true);
    } catch {
      setError("Couldn't do that. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (withdrawn) {
    return (
      <div>
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Permission withdrawn</h1>
        <p className="font-body text-sm text-steel mt-3">{childName} can&apos;t use the app until a parent or guardian gives permission again.</p>
      </div>
    );
  }

  if (done || signed) {
    return (
      <div>
        <h1 className="font-display font-bold text-3xl uppercase leading-none">{done ? "Thank you" : "Permission on file"}</h1>
        <p className="font-body text-sm text-steel mt-3">
          {done
            ? `${childName} can start. ${done.emailedCopy ? "We emailed you a copy." : "We couldn't email you a copy just now, so keep this page or print it."}`
            : `${signed!.name} (${signed!.relationship}) gave permission for ${childName}${signed!.at ? ` on ${new Date(signed!.at).toLocaleDateString()}` : ""}.`}
        </p>
        {done && <pre className="font-body text-xs whitespace-pre-wrap border border-steel/20 p-4 mt-5">{done.text}</pre>}
        {error && (
          <p className="font-body text-sm text-rust mt-4" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={withdraw} disabled={busy} className="mt-6 font-body text-sm text-rust underline disabled:opacity-40">
          Withdraw my permission
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display font-bold text-3xl uppercase leading-none">Permission for {childName} to train</h1>
      <p className="font-body text-sm text-steel mt-3">Please read this, then sign at the bottom. You may refuse to sign.</p>
      <pre className="font-body text-sm whitespace-pre-wrap border border-steel/20 p-4 mt-5">{text}</pre>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="g-name" className="font-body text-xs text-steel uppercase tracking-wide">
            Your full name
          </label>
          <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="g-rel" className="font-body text-xs text-steel uppercase tracking-wide">
              You are their
            </label>
            <select id="g-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-2 font-body">
              <option value="">Choose…</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="g-state" className="font-body text-xs text-steel uppercase tracking-wide">
              State where you live
            </label>
            <select id="g-state" value={state} onChange={(e) => setState(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-2 font-body">
              <option value="">Choose…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-start gap-3 font-body text-sm">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1" />
          <span>I read and understood the above, including the risks, and I agree to let {childName} take part.</span>
        </label>
        <label className="flex items-start gap-3 font-body text-sm">
          <input type="checkbox" checked={mayRefuse} onChange={(e) => setMayRefuse(e.target.checked)} className="mt-1" />
          <span>I know I may refuse to sign, and that I can take back my permission later.</span>
        </label>
        {error && (
          <p className="font-body text-sm text-rust" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={sign}
          disabled={busy || !name.trim() || !relationship || !state || !understood || !mayRefuse}
          className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
        >
          {busy ? "Saving…" : "Sign and give permission"}
        </button>
      </div>
    </div>
  );
}
