"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GOAL_TYPE_LABELS } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import type { PendingGoal } from "./goal-confirmation-control";

// A goal the coach suggested that the client has not answered yet. The coach cannot confirm it for them; they can take it back.
export function GoalWaitingOnClient({ goal, clientName }: { goal: PendingGoal; clientName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = goal.goalType === "custom" && goal.customLabel ? goal.customLabel : GOAL_TYPE_LABELS[goal.goalType as GoalType] ?? goal.goalType;

  async function withdraw() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("client_goals").update({ status: "declined" }).eq("id", goal.id);
    setBusy(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setWithdrawn(true);
    router.refresh();
  }

  if (withdrawn) return <p className="font-body text-sm text-steel">Suggestion taken back.</p>;

  return (
    <div className="border border-steel/30 bg-surface p-4">
      <p className="font-body text-xs text-steel uppercase tracking-wide font-bold mb-1">Suggested goal, waiting on {clientName.split(" ")[0] || "them"}</p>
      <p className="font-body text-base">{label}</p>
      {goal.targetDate && <p className="font-body text-sm text-steel mt-1">Target date: {goal.targetDate}</p>}
      {goal.priorityNote && <p className="font-body text-sm text-steel mt-1">{goal.priorityNote}</p>}
      <p className="font-body text-xs text-steel mt-2">They can confirm it, change it, or say not now. It changes nothing until they do.</p>
      <button type="button" onClick={withdraw} disabled={busy} className="mt-3 font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40">
        Take it back
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
