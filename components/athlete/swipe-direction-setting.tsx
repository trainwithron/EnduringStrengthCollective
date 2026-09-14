"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export type SwipeDirection = "vertical" | "horizontal";

// Change-anytime control for the exercise-logging carousel's swipe
// direction (swipe_card_logging_and_spotter_nudge_idea.md, resolved
// 2026-09-14) — same immediate-persist pattern as every other settings
// control in this app (e.g. SessionCreditsControl). Reused in two
// places: the athlete's own Settings page, and a coach's client-profile
// page (for setting it on a client's behalf) — the label prop is the
// only thing that differs between those two call sites.
export function SwipeDirectionSetting({
  athleteId,
  initialDirection,
  label = "Exercise logging",
  // "self": the athlete changing their own preference — RLS already
  // permits this directly (profiles_update_own). "coach": a coach
  // setting it on a client's behalf — profiles has no coach-write RLS
  // policy (deliberately, to avoid handing a coach write access to a
  // client's full_name/avatar_url through the same door), so this
  // routes through a narrow, purpose-built server route instead.
  mode = "self",
}: {
  athleteId: string;
  initialDirection: SwipeDirection | null;
  label?: string;
  mode?: "self" | "coach";
}) {
  const [direction, setDirection] = useState<SwipeDirection | null>(initialDirection);
  const [saving, setSaving] = useState(false);

  async function choose(next: SwipeDirection) {
    if (next === direction || saving) return;
    setDirection(next);
    setSaving(true);
    if (mode === "coach") {
      await fetch("/api/coach/set-swipe-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, direction: next }),
      });
    } else {
      const supabase = createBrowserClient();
      await supabase.from("profiles").update({ exercise_swipe_direction: next }).eq("id", athleteId);
    }
    setSaving(false);
  }

  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">{label}</p>
      <div className="flex items-center gap-2">
        {(["horizontal", "vertical"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            disabled={saving}
            className={`flex-1 h-9 font-body text-xs font-medium border transition-colors disabled:opacity-60 ${
              direction === option
                ? "bg-rust text-graphite border-rust"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            {option === "horizontal" ? "Side to side" : "Up and down"}
          </button>
        ))}
      </div>
      <p className="font-body text-[11px] text-steel mt-1.5">
        How exercises advance while logging a workout.
      </p>
    </div>
  );
}
