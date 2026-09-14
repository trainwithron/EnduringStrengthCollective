"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SwipeDirection } from "@/components/athlete/swipe-direction-setting";

const DISMISSED_KEY = "esc-swipe-direction-dismissed";
const DEMO_LABELS = ["Warm-up", "Bench Press", "Rows"];

function vibrateTick() {
  try {
    navigator.vibrate?.(15);
  } catch {
    // Vibration API unsupported/blocked — the demo still works without it.
  }
}

// First-run discovery prompt for the swipe-direction preference
// (swipe_card_logging_and_spotter_nudge_idea.md, resolved 2026-09-14) —
// Ron's own framing: let the athlete FEEL both gestures on a real, tiny
// interactive sample before picking, not read a description of them.
// Casual and non-blocking: shown only while profiles.exercise_swipe_direction
// is still null, dismissible without choosing (permanently, via
// localStorage — same pattern as add-to-home-screen-prompt.tsx). Picking
// either direction persists it server-side, which is what actually stops
// this from ever showing again (the localStorage key only covers "I
// dismissed it without deciding").
export function SwipeDirectionDiscovery({
  athleteId,
  onChosen,
}: {
  athleteId: string;
  onChosen: (direction: SwipeDirection) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState<SwipeDirection | null>(null);
  const hScrollerRef = useRef<HTMLDivElement>(null);
  const vScrollerRef = useRef<HTMLDivElement>(null);
  const lastHIndex = useRef(0);
  const lastVIndex = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // localStorage unavailable — just show it; worst case it can't be
      // permanently dismissed without picking, on this device.
    }
    setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not remembered, but stops showing for now either way.
    }
  }

  async function choose(direction: SwipeDirection) {
    setSaving(direction);
    const supabase = createBrowserClient();
    await supabase.from("profiles").update({ exercise_swipe_direction: direction }).eq("id", athleteId);
    onChosen(direction);
  }

  function handleHScroll() {
    const scroller = hScrollerRef.current;
    if (!scroller || !scroller.clientWidth) return;
    const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (index !== lastHIndex.current) {
      lastHIndex.current = index;
      vibrateTick();
    }
  }

  function handleVScroll() {
    const scroller = vScrollerRef.current;
    if (!scroller || !scroller.clientHeight) return;
    const index = Math.round(scroller.scrollTop / scroller.clientHeight);
    if (index !== lastVIndex.current) {
      lastVIndex.current = index;
      vibrateTick();
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-4 border border-steel/20 bg-surface/30 p-4 relative">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <p className="font-display font-bold text-sm uppercase leading-tight pr-8">
        How do you want to flip through exercises?
      </p>
      <p className="font-body text-xs text-steel mt-1">
        Swipe the samples below to feel each one, then pick whichever you liked better.
      </p>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1.5 text-center">
            Side to side
          </p>
          <div
            ref={hScrollerRef}
            onScroll={handleHScroll}
            className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth gap-2"
            style={{ scrollbarWidth: "none" }}
          >
            {DEMO_LABELS.map((label) => (
              <div
                key={label}
                className="snap-center shrink-0 w-full h-20 bg-graphite border border-steel/30 flex items-center justify-center"
              >
                <span className="font-body text-xs text-steel">{label}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => choose("horizontal")}
            disabled={saving != null}
            className="w-full h-9 mt-2 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving === "horizontal" ? "Saving…" : "Use this"}
          </button>
        </div>

        <div>
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1.5 text-center">
            Up and down
          </p>
          <div
            ref={vScrollerRef}
            onScroll={handleVScroll}
            className="flex flex-col overflow-y-auto snap-y snap-mandatory scroll-smooth gap-2 h-20"
            style={{ scrollbarWidth: "none" }}
          >
            {DEMO_LABELS.map((label) => (
              <div
                key={label}
                className="snap-center shrink-0 h-20 bg-graphite border border-steel/30 flex items-center justify-center"
              >
                <span className="font-body text-xs text-steel">{label}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => choose("vertical")}
            disabled={saving != null}
            className="w-full h-9 mt-2 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving === "vertical" ? "Saving…" : "Use this"}
          </button>
        </div>
      </div>
    </div>
  );
}
