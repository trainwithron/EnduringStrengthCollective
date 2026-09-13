"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GOAL_TYPE_LABELS } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";

export interface PendingGoal {
  id: string;
  goalType: string;
  customLabel: string | null;
  targetDate: string | null;
  priorityNote: string | null;
}

// Client proposes, coach confirms — the goal never drives any real
// nutrition/programming numbers while still 'proposed'
// (goal_date_aware_nutrition_and_programming_idea.md, the already-
// locked governance rule).
export function GoalConfirmationControl({ goal }: { goal: PendingGoal }) {
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<"confirmed" | "declined" | null>(null);
  const router = useRouter();

  async function respond(status: "confirmed" | "declined") {
    setBusy(true);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from("client_goals")
      .update({
        status,
        confirmed_at: new Date().toISOString(),
        confirmed_by: userData.user?.id,
      })
      .eq("id", goal.id);
    setBusy(false);
    setResolved(status);
    router.refresh();
  }

  const label = goal.goalType === "custom" && goal.customLabel ? goal.customLabel : GOAL_TYPE_LABELS[goal.goalType as GoalType] ?? goal.goalType;

  if (resolved) {
    return <p className="font-body text-sm text-steel">Goal {resolved}.</p>;
  }

  return (
    <div className="border border-rust/40 bg-rust/5 p-4">
      <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold mb-1">
        Proposed goal — waiting on you
      </p>
      <p className="font-body text-base">{label}</p>
      {goal.targetDate && <p className="font-body text-sm text-steel mt-1">Target date: {goal.targetDate}</p>}
      {goal.priorityNote && <p className="font-body text-sm text-steel mt-1">{goal.priorityNote}</p>}
      <div className="flex items-center gap-4 mt-3">
        <button
          type="button"
          onClick={() => respond("confirmed")}
          disabled={busy}
          className="h-8 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => respond("declined")}
          disabled={busy}
          className="font-body text-xs text-steel"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
