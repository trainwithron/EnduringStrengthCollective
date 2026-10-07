"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { describeApplyOutcome, describeConflicts, updateConflictingDays, type ApplyPlan, type TargetValues } from "@/lib/apply-standing";

// What an Apply really did, in the coach's terms. Saving a standing target does not by itself change a day that has its own target or an assigned meal plan (those still
// win), so this says which days will not follow yet and offers the one-click fix. It never hides that: the coach sees it right after Apply.
export function ApplyOutcomeNotice({
  athleteId,
  groupId,
  target,
  plan,
  startKey,
  todayKey,
}: {
  athleteId: string;
  groupId: string;
  target: TargetValues;
  plan: ApplyPlan;
  startKey: string;
  todayKey: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = describeConflicts(plan.conflicts);

  async function fix() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const r = await updateConflictingDays(supabase, { athleteId, groupId, userId: user?.id ?? null, target, conflicts: plan.conflicts });
    setBusy(false);
    if (!r.ok) {
      setError("Couldn't update those days. Try again.");
      return;
    }
    setDone(
      `${r.removed > 0 ? `${r.removed} one-day ${r.removed === 1 ? "target" : "targets"} removed. ` : ""}${r.set > 0 ? `New target set on ${r.set} ${r.set === 1 ? "day" : "days"}.` : ""}`.trim()
    );
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="font-body text-sm text-chalk">{describeApplyOutcome({ plan, newCalories: target.calories, startKey, todayKey })}</p>
      {plan.conflicts.length > 0 && !done && (
        <div role="status" className="border border-amber-400/40 bg-amber-400/5 p-2.5 space-y-1.5">
          <p className="font-body text-xs text-amber-400 font-medium">These days will not follow the new target yet:</p>
          {lines.map((l) => (
            <p key={l} className="font-body text-xs text-chalk">
              {l}
            </p>
          ))}
          <p className="font-body text-xs text-steel">They still apply as they are. Updating removes one-day targets and sets the new target on days with a meal plan (the client gets a notice for each day set).</p>
          <button type="button" onClick={fix} disabled={busy} className="h-9 px-3 border border-amber-400/50 text-amber-400 font-body text-xs disabled:opacity-40">
            {busy ? "Updating…" : "Update those days"}
          </button>
        </div>
      )}
      {done && <p className="font-body text-xs text-positive">{done}</p>}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
