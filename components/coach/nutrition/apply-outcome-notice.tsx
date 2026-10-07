"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { conflictFixes, describeApplyOutcome, describeConflicts, describeRemovedScheduled, updateConflictingDays, type ApplyPlan, type TargetValues } from "@/lib/apply-standing";

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
  const fixes = conflictFixes(plan.conflicts);
  const removedLines = describeRemovedScheduled(plan.removedScheduled);

  async function fix() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const r = await updateConflictingDays(supabase, { athleteId, groupId, conflicts: plan.conflicts });
    setBusy(false);
    if (!r.ok) {
      setError("Couldn't update those days. Try again.");
      return;
    }
    setDone(`${r.removed} one-day ${r.removed === 1 ? "target" : "targets"} removed.${fixes.planDates.length > 0 ? " The days with a meal plan still follow that plan." : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="font-body text-sm text-chalk">{describeApplyOutcome({ plan, newCalories: target.calories, startKey, todayKey })}</p>
      {removedLines.map((l) => (
        <p key={l} className="font-body text-xs text-steel">
          {l}
        </p>
      ))}
      {plan.conflicts.length > 0 && (
        <div role="status" className="border border-amber-400/40 bg-amber-400/5 p-2.5 space-y-1.5">
          <p className="font-body text-xs text-amber-400 font-medium">These days will not follow the new target yet:</p>
          {lines.map((l) => (
            <p key={l} className="font-body text-xs text-chalk">
              {l}
            </p>
          ))}
          {fixes.removeDates.length > 0 && !done && (
            <>
              <p className="font-body text-xs text-steel">Removing a one-day target lets the standing target (or that day&apos;s meal plan) show. The client is not sent a notice for a removal.</p>
              <button type="button" onClick={fix} disabled={busy} className="h-9 px-3 border border-amber-400/50 text-amber-400 font-body text-xs disabled:opacity-40">
                {busy ? "Removing…" : fixes.removeDates.length === 1 ? "Remove that one-day target" : `Remove those ${fixes.removeDates.length} one-day targets`}
              </button>
            </>
          )}
          {fixes.planDates.length > 0 && (
            <p className="font-body text-xs text-steel">
              A meal plan isn&apos;t changed from here, because the meals were built for the old number. Build a new plan for those days in{" "}
              <a href="#meal-plan" className="text-rust underline underline-offset-2">
                Meal plan
              </a>
              .
            </p>
          )}
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
