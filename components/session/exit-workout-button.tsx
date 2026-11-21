"use client";

import { askWorkoutChoice } from "@/lib/workout-choice";

// Back on a workout that is in progress never leaves silently: it opens the same choice as Complete workout (complete it, pause it and pick it up later, or keep going). A finished or paused
// workout has a plain Back link instead (the page decides which).
export function ExitWorkoutButton({ sessionId, backHref }: { sessionId: string; backHref: string }) {
  void sessionId;
  void backHref;
  return (
    <button type="button" onClick={askWorkoutChoice} aria-label="Back" className="h-11 px-3.5 rounded-token-pill bg-surface font-body text-[13px] font-medium text-chalk active:text-rust-ink shrink-0">
      &larr; Back
    </button>
  );
}
