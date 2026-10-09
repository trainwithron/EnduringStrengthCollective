"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Gives a client a number of sessions in one step ("12", with an optional note), no purchase involved. The
// client's balance, the calendar and booking all read the same session_credits row a purchased package fills,
// so nothing else needs to know the sessions were assigned by hand. Adds only; nothing is deducted.
export function AssignSessionsControl({
  athleteId,
  groupId,
  clientName,
  initialBalance,
}: {
  athleteId: string;
  groupId: string;
  clientName: string;
  initialBalance: number;
}) {
  const router = useRouter();
  const [balance, setBalance] = useState(initialBalance);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState("");

  // Match the balance to what the client really has (for example back to zero after ending up at -2). Recorded in the
  // session ledger as an adjustment, with who did it.
  async function setBalanceTo(next: number) {
    if (!Number.isInteger(next) || next < -500 || next > 500) {
      setError("Enter a whole number between -500 and 500.");
      return;
    }
    if (next === balance) {
      setMessage("The balance is already " + next + ".");
      return;
    }
    if (!await confirmDialog(`Set ${clientName}'s balance from ${balance} to ${next}? This is recorded in their session ledger.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createBrowserClient();
    const { data, error: rpcError } = await supabase.rpc("set_session_balance", {
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_target: next,
      p_note: null,
    });
    if (rpcError) {
      if (/could not find the function|does not exist/i.test(rpcError.message)) {
        // Until the database function exists, change the balance by the difference (no ledger note).
        const { data: newBalance, error: fallbackError } = await supabase.rpc("adjust_session_credits", {
          p_athlete_id: athleteId,
          p_group_id: groupId,
          p_delta: next - balance,
        });
        setBusy(false);
        if (fallbackError) {
          setError("That didn't save. Nothing was changed.");
          return;
        }
        setBalance(typeof newBalance === "number" ? newBalance : next);
        setTarget("");
        setMessage(`Balance set to ${next}.`);
        router.refresh();
        return;
      }
      setBusy(false);
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setBusy(false);
    setBalance(typeof data === "number" ? data : next);
    setTarget("");
    setMessage(`Balance set to ${next}.`);
    router.refresh();
  }

  async function assign() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setError("Enter a whole number of sessions, 1 to 500.");
      return;
    }
    if (
      !await confirmDialog(
        `Add ${n} session${n === 1 ? "" : "s"} to ${clientName}? Their balance goes from ${balance} to ${balance + n}.`
      )
    ) {
      return;
    }
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
      <p className="font-body text-xs text-steel mb-2">
        Add sessions to this client without a purchase. Their balance, the calendar and booking use them right away.
      </p>
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
          {busy ? "Adding…" : "Assign sessions"}
        </button>
      </div>
      <div className="mt-4 pt-3 border-t border-steel/15">
        <p className="font-body text-xs text-steel mb-2">
          Current balance: <span className="text-chalk">{balance}</span>. Set it to match what {clientName} really has.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="e.g. 0"
            aria-label="New balance"
            className="w-24 bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
          <button
            type="button"
            onClick={() => setBalanceTo(Number(target))}
            disabled={busy || target === ""}
            className="border border-steel/40 text-chalk font-body text-sm px-3 py-2 disabled:opacity-40"
          >
            Set balance
          </button>
          <button
            type="button"
            onClick={() => setBalanceTo(0)}
            disabled={busy}
            className="border border-steel/40 text-chalk font-body text-sm px-3 py-2 disabled:opacity-40"
          >
            Set to 0
          </button>
        </div>
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
