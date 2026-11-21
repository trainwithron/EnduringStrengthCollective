"use client";

import { DAY_ADD_AT_EVENT } from "@/components/coach/desktop/day-calendar";

// An "Open" time on the calendar's day page (Ron, Nov 21: it was only a word): a button that opens the day's Add sheet at that time, the same sheet a tap on the hour grid opens.
export function AddAtTimeButton({ time, label }: { time: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Add something at ${label}`}
      onClick={() => window.dispatchEvent(new CustomEvent(DAY_ADD_AT_EVENT, { detail: { time } }))}
      className="min-h-11 px-3 rounded-token-pill border border-steel/30 font-body text-xs text-chalk"
      data-add-at-time
    >
      Open · Add
    </button>
  );
}
