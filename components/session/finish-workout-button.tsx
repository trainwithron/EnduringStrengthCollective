"use client";

import { askWorkoutChoice } from "@/lib/workout-choice";

// Finish, at the top right of a live workout's header (Look Refresh, client step, Ron Nov 20). It opens the workout's one choice (Complete workout, Pause for now, Keep going, Delete workout),
// the same choice Complete workout opened from the bottom before; nothing about finishing changed.
export function FinishWorkoutButton() {
  return (
    <button
      type="button"
      onClick={askWorkoutChoice}
      data-finish-button
      className="h-11 px-4 rounded-token-pill border border-steel/50 text-chalk font-body text-[13px] font-semibold active:border-rust active:text-rust-ink"
    >
      Finish
    </button>
  );
}
