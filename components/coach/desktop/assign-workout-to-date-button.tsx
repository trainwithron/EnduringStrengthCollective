"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Day-click-to-assign (calendar_workout_scheduling_and_adjustable_
// workspace_idea.md item 1) — pins one specific workout to this exact
// calendar date via workouts.scheduled_date. computeScheduledDates
// (lib/program-schedule.ts) then uses that date verbatim and skips this
// workout's own slot in the program's sequential weekday walk, so
// pinning one workout never shifts any of its siblings.
export function AssignWorkoutToDateButton({
  workoutId,
  dateKey,
  alreadyHere,
}: {
  workoutId: string;
  dateKey: string;
  alreadyHere: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAssign() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("workouts")
      .update({ scheduled_date: dateKey })
      .eq("id", workoutId);

    if (updateError) {
      setError("Couldn't assign that workout — try again.");
      setSubmitting(false);
      return;
    }
    router.refresh();
  }

  if (alreadyHere) {
    return <span className="font-body text-xs text-steel shrink-0">Already here</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        onClick={handleAssign}
        disabled={submitting}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Assigning…" : "Assign to this day"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
