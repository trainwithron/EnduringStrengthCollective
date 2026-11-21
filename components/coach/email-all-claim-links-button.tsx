"use client";

import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// Told when the clients who have not signed in yet may have changed (an import added people, a send went out), so every copy of the button on the page counts again.
export const CLAIM_LINKS_CHANGED_EVENT = "spotlight:claim-links-changed";
export function announceClaimLinksChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLAIM_LINKS_CHANGED_EVENT));
}

type Count = { eligible: number; more: boolean; perSend: number; noEmail: number; alreadyLinked: number; emailReady: boolean };

// "Email sign-in links to everyone not signed in yet" (Ron, Nov 20, onboarding O2). Shows how many would get one, asks first, then sends one email each (app/api/clients/email-claim-links-all). Hidden
// when nobody is waiting. A person already sent a link that still works is not emailed again; team players and anyone with a parent on file are left for their coach to send one at a time.
export function EmailAllClaimLinksButton({ groupId }: { groupId: string }) {
  const [count, setCount] = useState<Count | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/clients/email-claim-links-all?groupId=${encodeURIComponent(groupId)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.eligible === "number") setCount(data);
    } catch {
      // No button rather than a wrong count.
    }
  }

  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener(CLAIM_LINKS_CHANGED_EVENT, again);
    return () => window.removeEventListener(CLAIM_LINKS_CHANGED_EVENT, again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function send() {
    if (!count || busy || count.eligible === 0) return;
    const n = Math.min(count.eligible, count.perSend);
    const firstOf = count.eligible > count.perSend || count.more ? `the first ${n} of ${count.eligible}${count.more ? "+" : ""}` : `${n}`;
    const ok = await confirmDialog({
      message: `Email ${firstOf} ${count.eligible === 1 ? "client" : "clients"} their sign-in link? Each person who hasn't signed in yet gets one email, from you, with their own link. Only send this to people who expect to hear from you.`,
      confirmLabel: `Send ${n} ${n === 1 ? "email" : "emails"}`,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/email-claim-links-all?groupId=${encodeURIComponent(groupId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send the emails. Try again.");
      const parts = [`Sent ${data.sent} ${data.sent === 1 ? "email" : "emails"}.`];
      if (data.notSent > 0) parts.push(`${data.notSent} couldn't be sent; send those from their profile.`);
      if (data.alreadySent > 0) parts.push(`${data.alreadySent} already had a link that still works, so they were skipped.`);
      if (data.remaining > 0 || data.more) parts.push(`More are waiting: press again${data.overDaily > 0 ? " tomorrow" : " in a couple of minutes"}.`);
      if (data.noEmail > 0) parts.push(`${data.noEmail} have no email on file.`);
      setResult(parts.join(" "));
      announceClaimLinksChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the emails. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!count || (count.eligible === 0 && !result)) return null;
  return (
    <div data-email-all-claim-links>
      {count.eligible > 0 && count.emailReady && (
        <button type="button" onClick={send} disabled={busy} className="min-h-11 px-4 border border-rust text-rust-ink font-body text-sm active:bg-rust active:text-graphite disabled:opacity-40">
          {busy ? "Sending…" : `Email sign-in links to ${count.eligible}${count.more ? "+" : ""} not signed in yet`}
        </button>
      )}
      {count.eligible > 0 && !count.emailReady && <p className="font-body text-xs text-steel">{count.eligible} haven&apos;t signed in yet. Email isn&apos;t set up, so send each link from their profile.</p>}
      {result && <p className="font-body text-xs text-positive mt-1.5">{result}</p>}
      {error && (
        <p className="font-body text-xs text-rust-ink mt-1.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
