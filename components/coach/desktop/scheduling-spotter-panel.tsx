"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SchedulingSpotterFlag } from "@/lib/calendar-spotter-phase2-gather";

// Calendar Spotter Phase 2 — recurring gaps, uneven multi-trainer load,
// and booked-vs-actual duration mismatch. Same suggestive-only,
// confirm/deny/edit principle as Programming Spotter
// (spotter_suggestive_only_top3_confirm_deny_edit_principle_sept19.md),
// applied here since a scheduling change is exactly the kind of thing a
// coach should decide, never something this silently re-slots. "Edit"
// deep-links into Availability rather than opening a text sub-form —
// there's no standing-preference consumer for scheduling suggestions
// yet, so "I'll go fix the actual setting" is the honest equivalent.
export function SchedulingSpotterPanel({
  flags,
  availabilityHref,
}: {
  flags: SchedulingSpotterFlag[];
  availabilityHref: string;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  const visible = flags.filter((f) => !handled.has(`${f.checkKind}::${f.patternKey}`));
  if (visible.length === 0) return null;

  // Real ask from Ron: a bulk way to dismiss everything pending at once.
  // Local-only, same reasoning as Programming Spotter's own Clear All —
  // a bulk clear isn't a real per-item judgment, so it shouldn't hit
  // /api/calendar-spotter/feedback or feed the deny-pattern tracking.
  function handleClearAll() {
    setHandled((prev) => {
      const next = new Set(prev);
      for (const f of visible) next.add(`${f.checkKind}::${f.patternKey}`);
      return next;
    });
  }

  async function sendFeedback(flag: SchedulingSpotterFlag, action: "confirmed" | "denied" | "edited") {
    const key = `${flag.checkKind}::${flag.patternKey}`;
    setBusyKey(key);
    try {
      await fetch("/api/calendar-spotter/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkKind: flag.checkKind, patternKey: flag.patternKey, headline: flag.headline, action }),
      });
      setHandled((prev) => new Set(prev).add(key));
      if (action === "denied") router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="border border-rust/40 bg-rust/5 px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="font-body text-xs text-rust uppercase tracking-wide font-bold">
          Scheduling Spot
        </p>
        {visible.length > 1 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="font-body text-xs text-steel uppercase tracking-wide active:text-chalk"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((flag) => {
          const key = `${flag.checkKind}::${flag.patternKey}`;
          const busy = busyKey === key;
          return (
            <div key={key} className="flex items-start gap-2">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-rust" />
              <p className="font-body text-sm text-chalk flex-1">{flag.headline}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => sendFeedback(flag, "confirmed")}
                  disabled={busy}
                  className="font-body text-xs text-moss uppercase tracking-wide disabled:opacity-40"
                >
                  Confirm
                </button>
                <a
                  href={availabilityHref}
                  onClick={() => sendFeedback(flag, "edited")}
                  className="font-body text-xs text-steel uppercase tracking-wide active:text-chalk"
                >
                  Edit
                </a>
                <button
                  type="button"
                  onClick={() => sendFeedback(flag, "denied")}
                  disabled={busy}
                  className="font-body text-xs text-rust uppercase tracking-wide font-bold disabled:opacity-40"
                >
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
