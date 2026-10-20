"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Gives a client a number of sessions in one step ("12", with an optional note), no purchase involved. The
// client's balance, the calendar and booking all read the same session_credits row a purchased package fills,
// so nothing else needs to know the sessions were assigned by hand. Adds only; nothing is deducted. Each add is one package (FIX 3). Setting the balance to a number is the
// Billing control beside it (session-credits-control.tsx), so it is not repeated here.
export function AssignSessionsControl({
  athleteId,
  groupId,
  clientName,
  initialBalance,
  compact = false,
}: {
  athleteId: string;
  groupId: string;
  clientName: string;
  initialBalance: number;
  // The calendar tab's copy (Ron, Oct 19): only the add row, no intro.
  compact?: boolean;
}) {
  const router = useRouter();
  const [balance, setBalance] = useState(initialBalance);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setError("Enter a whole number of sessions, 1 to 500.");
      return;
    }
    // No "are you sure" for adding: a coach adds 1, 2 or 12 by hand for cash and gym packs. The result line below shows what happened, and the ledger and the minus button cover a slip.
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createBrowserClient();
    const trimmed = note.trim();
    const { data, error: rpcError } = await supabase.rpc("assign_session_credits", {
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_amount: n,
      p_note: trimmed || null,
    });

    if (rpcError) {
      // Until the assignment function exists on the database, fall back to the plain balance control so the
      // action still works (without the note trail).
      const functionMissing = /could not find the function|does not exist/i.test(rpcError.message);
      if (!functionMissing) {
        setBusy(false);
        setError("That didn't save. Nothing was changed.");
        return;
      }
      const { data: newBalance, error: fallbackError } = await supabase.rpc("adjust_session_credits", {
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_delta: n,
      });
      setBusy(false);
      if (fallbackError) {
        setError("That didn't save. Nothing was changed.");
        return;
      }
      if (typeof newBalance === "number") setBalance(newBalance);
      setAmount("");
      setNote("");
      setMessage(`Added ${n}.`);
      router.refresh();
      return;
    }

    setBusy(false);
    const newBalance = typeof data === "number" ? data : balance + n;
    setBalance(newBalance);
    setAmount("");
    setNote("");
    setMessage(`Added ${n}. ${clientName} now has ${newBalance}.`);
    router.refresh();
  }

  return (
    <div>
      {!compact && (
        <p className="font-body text-xs text-steel mb-2">
          Add sessions to this client without a purchase. Their balance, the calendar and booking use them right away.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Sessions</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="12"
            className="w-24 bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
        </label>
        <label className="block flex-1 min-w-[10rem]">
          <span className="font-body text-xs text-steel block mb-1">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Paid in person"
            className="w-full bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
        </label>
        <button
          type="button"
          onClick={assign}
          disabled={busy || amount === ""}
          className="bg-rust text-chalk font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add sessions"}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="font-body text-xs text-chalk mt-2" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
