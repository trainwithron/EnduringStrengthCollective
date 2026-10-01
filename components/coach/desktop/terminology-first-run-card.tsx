"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISSED_KEY = "terminology-first-run-dismissed";

// coach_terminology_word_swap_system_idea.md's second discovery entry
// point — a one-time, dismissible nudge on the coach Home dashboard
// naming the feature once and linking to its canonical Settings home.
// Read/write of the dismissed flag happens after mount only, so a
// server-rendered first paint never flashes the card for a coach who
// already dismissed it on a prior visit.
export function TerminologyFirstRunCard({ groupId }: { groupId: string }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      // Storage unavailable — default to dismissed rather than risk
      // showing this every visit.
    }
  }, []);

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
    <div className="mb-6 border border-rust/40 bg-surface/60 p-4 flex items-start justify-between gap-4">
      <p className="font-body text-sm text-chalk">
        Not a personal-trainer shop? You can rename &quot;clients&quot; to &quot;athletes,&quot;
        &quot;sessions&quot; to &quot;workouts,&quot; and more — coach-wide, everywhere those words
        appear.{" "}
        <Link href={`/groups/${groupId}/branding?tab=terminology`} className="text-rust underline">
          Set your vocabulary →
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="font-body text-steel hover:text-chalk shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
