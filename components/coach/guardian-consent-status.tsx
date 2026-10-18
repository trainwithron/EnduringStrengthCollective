"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface GuardianStateInfo {
  state: "none" | "pending" | "expired" | "signed" | "withdrawn";
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
// the client gave. The client chose that address themselves, so the coach is asked to confirm with the parent by phone, and can Void a permission that turns out not to be the parent's.
export function GuardianConsentStatus({ athleteId, info }: { athleteId: string; info: GuardianStateInfo | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const state = info?.state ?? "none";

  async function post(path: string, ok: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ athleteId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setNote(d.error ?? "Couldn't do that. Try again.");
      else {
        setNote(ok);
        router.refresh();
      }
    } catch {
      setNote("Couldn't do that. Try again.");
    }
    setBusy(false);
  }

  async function voidIt() {
    if (!(await confirmDialog({ message: "Cancel this permission? The client is stopped again until a parent or guardian signs. The record of it is kept.", confirmLabel: "Cancel the permission", destructive: true }))) return;
    await post("/api/guardian-consent/void", "Cancelled.");
  }

  // The database answers a coach only for a client who trains in a live group of theirs. For any other seat, or a lookup that failed, there is no answer: say so, not "not asked yet".
  if (info === null) {
    return (
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Parent or guardian permission (under 18)</p>
        <p className="font-body text-sm text-steel">Not shown for this seat. It is shown to a coach of a live group where this client trains.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Parent or guardian permission (under 18)</p>
      {state === "signed" && (
        <>
          <p className="font-body text-sm">
            Signed by {info?.guardian_name} ({info?.relationship}), {info?.guardian_email}, on {when(info?.signed_at)}.
          </p>
          <p className="font-body text-xs text-steel mt-1">{"The client chose this email address themselves. Phone the parent to confirm it was really them who signed."}</p>
          <button type="button" onClick={voidIt} disabled={busy} className="mt-2 font-body text-xs text-rust underline disabled:opacity-40">
            Cancel this permission
          </button>
        </>
      )}
      {state === "pending" && (
        <>
          <p className="font-body text-sm">
            Waiting on the guardian. Asked {when(info?.requested_at)} at {info?.guardian_email}; the link works until {when(info?.expires_at)}. {"This client can't start until it is signed."}
          </p>
          <p className="font-body text-xs text-steel mt-1">{"The client chose this email address themselves. Phone the parent to make sure it is theirs."}</p>
        </>
      )}
      {state === "expired" && (
        <p className="font-body text-sm text-rust">The link to {info?.guardian_email} ran out of time on {when(info?.expires_at)}. This client is stopped until a parent or guardian signs.</p>
      )}
      {state === "withdrawn" && (
        <p className="font-body text-sm text-rust">The permission was taken back on {when(info?.withdrawn_at)}. This client is stopped until it is given again.</p>
      )}
      {state === "none" && <p className="font-body text-sm text-rust">Not asked yet. This client is stopped at a permission screen where they give a parent or guardian&apos;s email. Nothing else is collected until it is signed.</p>}
      {(state === "pending" || state === "expired" || state === "withdrawn") && info?.guardian_email && (
        <button type="button" onClick={() => post("/api/guardian-consent/resend", "Sent again.")} disabled={busy} className="mt-2 font-body text-xs text-rust underline disabled:opacity-40">
          Resend
        </button>
      )}
      {note && <p className="font-body text-xs mt-2">{note}</p>}
    </div>
  );
}
