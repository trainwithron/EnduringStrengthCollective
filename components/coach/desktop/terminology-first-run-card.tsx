"use client";

import { useEffect, useState } from "react";
import { TerminologyChooser } from "@/components/coach/desktop/terminology-chooser";
import { useTerminology } from "@/components/coach/terminology-provider";

const DISMISSED_KEY = "terminology-first-run-dismissed";

// The one-time setup question on a coach's Home (Ron, Oct 6): "What do you call your people?". It is asked once, here, in plain buttons; the answer then reads
// as ordinary text everywhere, and can be changed any time in Settings. (The old nudge to rename words by clicking them is retired: no word is
// clickable any more.) Read/write of the dismissed flag happens after mount only, so a server-rendered first paint never flashes the card for a coach who
// already answered it.
export function TerminologyFirstRunCard({ groupId }: { groupId: string }) {
  const [dismissed, setDismissed] = useState(true);
  const [chosen, setChosen] = useState(false);
  const { overrides } = useTerminology();

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      // Storage unavailable — default to dismissed rather than risk showing this every visit.
    }
  }, []);

  // Choosing a word counts as answering: the card says so, then goes away on its own next visit.
  const hasChoice = !!overrides.client;
  useEffect(() => {
    if (!dismissed && hasChoice) {
      setChosen(true);
      try {
        window.localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // Non-fatal — it may just show again next visit.
      }
    }
  }, [dismissed, hasChoice]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Non-fatal — it may just show again next visit.
    }
  }

  if (dismissed) return null;

  return (
    <div className="mb-6 border border-rust/40 bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-body text-sm text-chalk font-medium">What do you call your people?</p>
          <p className="font-body text-xs text-steel mt-0.5 mb-3">Pick the word you use. It is used throughout your coach screens.</p>
          <TerminologyChooser groupId={groupId} moreHref={`/groups/${groupId}/branding?tab=terminology`} />
          {chosen && (
            <p className="font-body text-sm text-moss mt-3" role="status">
              Done. You can change this any time in Settings.
            </p>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label={chosen ? "Close" : "Keep the default and close"} className="font-body text-steel hover:text-chalk shrink-0 min-h-11 min-w-11">
          ✕
        </button>
      </div>
    </div>
  );
}
