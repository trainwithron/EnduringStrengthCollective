"use client";

import { useMemo } from "react";
import { pickLoadingTip } from "@/lib/loading-tips";

// The expanded swipe-card's real-estate-first callout
// (swipe_card_logging_and_spotter_nudge_idea.md): a coach's own note
// about THIS exercise always wins when one exists ("the software says
// what you don't have time to say" —
// coach_perceived_value_design_principle.md); a generic biomechanics
// tip is only ever the fallback when there's genuinely nothing from the
// coach, never a placeholder shown alongside a real note.
export function ExerciseNoteCallout({ coachNote }: { coachNote: string | null }) {
  // Picked once per card mount, not on every render — a tip that changes
  // under an athlete mid-set would read as glitchy, not charming.
  const tip = useMemo(() => pickLoadingTip(), []);

  if (coachNote) {
    return (
      <div className="border-l-2 border-rust bg-surface/40 px-3 py-2.5">
        <p className="font-body text-[10px] text-rust uppercase tracking-wide mb-1">
          From your coach
        </p>
        <p className="font-body text-sm text-chalk">{coachNote}</p>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-steel/30 bg-surface/20 px-3 py-2.5">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1">
        {tip.type === "correction" ? "Actually…" : "Did you know"}
      </p>
      <p className="font-body text-sm text-steel">{tip.text}</p>
    </div>
  );
}
