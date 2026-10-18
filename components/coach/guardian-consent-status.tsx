"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface GuardianStateInfo {
  state: "none" | "pending" | "signed" | "withdrawn";
  guardian_email?: string | null;
  guardian_name?: string | null;
  relationship?: string | null;
  requested_at?: string | null;
  expires_at?: string | null;
  signed_at?: string | null;
  withdrawn_at?: string | null;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "");

// For a client aged 13 to 17: where their parent or guardian's permission stands. Until it is signed the client is stopped at a permission screen and cannot start; the coach can Resend the request to the address
// the client gave. The client's own tap is never the permission.
export function GuardianConsentStatus({ athleteId, info }: { athleteId: string; info: GuardianStateInfo | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const state = info?.state ?? "none";

  async function resend() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/guardian-consent/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ athleteId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setNote(d.error ?? "Couldn't send. Try again.");
      else {
        setNote("Sent again.");
        router.refresh();
      }
    } catch {
      setNote("Couldn't send. Try again.");
    }
    setBusy(false);
  }

  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Parent or guardian permission (under 18)</p>
      {state === "signed" && (
        <p className="font-body text-sm">
          Signed by {info?.guardian_name} ({info?.relationship}) on {when(info?.signed_at)}.
        </p>
      )}
      {state === "pending" && (
        <>
          <p className="font-body text-sm">
            Waiting on the guardian. Asked {when(info?.requested_at)} at {info?.guardian_email}; the link works until {when(info?.expires_at)}. {"This client can't start until it is signed."}
          </p>
          <button type="button" onClick={resend} disabled={busy} className="mt-2 font-body text-xs text-rust underline disabled:opacity-40">
            Resend
          </button>
        </>
      )}
      {state === "withdrawn" && (
        <p className="font-body text-sm text-rust">The parent or guardian took back their permission on {when(info?.withdrawn_at)}. This client is stopped until it is given again.</p>
      )}
      {state === "none" && <p className="font-body text-sm text-rust">Not asked yet. This client is stopped at a permission screen where they give a parent or guardian&apos;s email. Nothing else is collected until it is signed.</p>}
      {note && <p className="font-body text-xs mt-2">{note}</p>}
    </div>
  );
}
