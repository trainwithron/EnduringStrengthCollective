"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { parseTestedMax } from "@/lib/tested-max";

// A coach-typed tested max for one lift (Ron, Nov 20, wave 2 T2). Saving locks it: the estimates from logged sets never overwrite it, and every program rule that works from a max
// (a percent of max, the wave rules) uses it. "Use the estimate instead" unlocks it. Pounds, as the cards beside it show.
export function TestedMaxControl({
  athleteId,
  exerciseName,
  tested,
  askName = false,
}: {
  athleteId: string;
  exerciseName: string;
  tested: { weight: number; at: string | null } | null;
  // the "another lift" form: the coach names the lift too
  askName?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(askName);
  const [name, setName] = useState(exerciseName);
  const [draft, setDraft] = useState(tested ? String(Math.round(tested.weight)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = parseTestedMax(name, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("set_tested_max", { p_athlete: athleteId, p_exercise: parsed.name, p_weight: parsed.weight });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setEditing(askName);
    if (askName) {
      setName("");
      setDraft("");
    }
    router.refresh();
  }

  async function unlock() {
    if (!(await confirmDialog({ message: `Go back to the estimate from logged sets for ${exerciseName}? The tested max is removed.`, confirmLabel: "Use the estimate", cancelLabel: "Keep the tested max" }))) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("unlock_tested_max", { p_athlete: athleteId, p_exercise: exerciseName });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    router.refresh();
  }

  const field = "h-11 rounded-row bg-surface border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust";
  return (
    <div className="mt-3 flex flex-col gap-2" data-tested-max>
      {!editing && tested && (
        <p className="font-body text-sm text-chalk">
          Tested max <b>{Math.round(tested.weight)} lbs</b>
          <span className="text-steel"> · locked{tested.at ? ` · set ${new Date(tested.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
        </p>
      )}
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {askName && (
            <input aria-label="Lift" placeholder="Lift, e.g. Back Squat" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`${field} w-48`} />
          )}
          <input
            aria-label={`Tested max for ${askName ? "the lift" : exerciseName}, in pounds`}
            inputMode="decimal"
            placeholder="lbs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
            }}
            className={`${field} w-24`}
          />
          <button type="button" onClick={() => void save()} disabled={busy} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-40">
            {busy ? "Saving…" : "Save and lock"}
          </button>
          {!askName && (
            <button type="button" onClick={() => setEditing(false)} className="h-11 px-3 font-body text-sm text-steel">
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className="min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-sm">
            {tested ? "Change the tested max" : "Type a tested max"}
          </button>
          {tested && (
            <button type="button" onClick={() => void unlock()} disabled={busy} className="min-h-11 px-3 font-body text-sm text-steel underline underline-offset-2 disabled:opacity-40">
              Use the estimate instead
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
