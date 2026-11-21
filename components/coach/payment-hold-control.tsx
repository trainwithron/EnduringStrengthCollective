"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { setPaymentHold } from "@/lib/payment-hold-client";

export const PAYMENT_HOLD_ANCHOR = "payment-hold";

// "On hold" in a client's Billing (audit, Nov 21): Home's Needs payment puts a client on hold (comped, on a break, pays another way) and says it can be taken off; this is one of the two places
// it comes off (the other is the three-dot menu on the Clients page). It reads the hold itself, so the page's own reads are untouched, and shows nothing when the client is not on hold or the
// hold cannot be read. Taking it off is the same call the group's client cards use (/api/reup/hold).
export function PaymentHoldControl({ groupId, athleteId, clientName }: { groupId: string; athleteId: string; clientName: string }) {
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .from("session_credits")
      .select("payment_hold")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error) setHeld((data as { payment_hold?: boolean | null } | null)?.payment_hold === true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, athleteId]);

  if (!held && !note) return null;

  async function takeOff() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const result = await setPaymentHold(groupId, athleteId, false);
    setBusy(false);
    if (!result.ok) {
      setNote({ text: result.error, error: true });
      return;
    }
    setHeld(false);
    setNote({ text: `${clientName} is off hold. They count in Needs payment again when they run out.`, error: false });
  }

  return (
    <div id={PAYMENT_HOLD_ANCHOR} className="scroll-mt-24 bg-surface-2 rounded-card p-3 mb-3" data-payment-hold>
      {held && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-body text-sm text-chalk">
            <span className="font-semibold">On hold.</span> <span className="text-steel">Left out of Needs payment and never reminded to pay.</span>
          </p>
          <button type="button" onClick={takeOff} disabled={busy} className="min-h-11 px-4 border border-rust text-rust-ink font-body text-sm font-semibold disabled:opacity-40">
            {busy ? "Taking off…" : "Take off hold"}
          </button>
        </div>
      )}
      {note && (
        <p className={`font-body text-xs mt-1 ${note.error ? "text-rust-ink" : "text-positive"}`} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </div>
  );
}
