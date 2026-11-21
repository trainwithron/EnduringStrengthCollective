"use client";

import { useState } from "react";
import Link from "next/link";
import { GOAL_REVIEW_HEADING } from "@/lib/goal-review";

// The 90-day goal look on a client's Home (Ron, Nov 20: R5). "Still my goal" stamps today on their goal sheet (/api/goal-sheet/review) and the card goes until the next 90 days;
// "Update my goal" opens the goal sheet, and saving it starts the 90 days again.
export function GoalReviewCard({ groupId, athleteId, goalText }: { groupId: string; athleteId: string; goalText: string | null }) {
  const [state, setState] = useState<"ask" | "saving" | "kept" | "failed">("ask");

  async function keep() {
    setState("saving");
    try {
      const res = await fetch("/api/goal-sheet/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId }) });
      setState(res.ok ? "kept" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "kept") {
    return (
      <p className="tint-win rounded-card px-4 py-3 font-body text-sm text-chalk" role="status">
        Kept. We&apos;ll ask again in 90 days.
      </p>
    );
  }

  return (
    <section className="tint-accent rounded-card px-4 py-4" aria-label="Your goal" data-goal-review>
      <p className="font-display font-semibold text-xl leading-tight text-chalk">{GOAL_REVIEW_HEADING}</p>
      {goalText && <p className="font-body text-sm text-chalk bg-surface-2 rounded-row px-3 py-2 mt-2 whitespace-pre-wrap break-words">{goalText}</p>}
      {state === "failed" && (
        <p className="font-body text-xs text-rust-ink mt-2" role="alert">
          That didn&apos;t save. Try again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => void keep()}
          disabled={state === "saving"}
          className="min-h-11 px-5 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : "Still my goal"}
        </button>
        <Link href={`/groups/${groupId}/goal#goal-sheet`} className="inline-flex items-center min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-sm">
          Update my goal
        </Link>
      </div>
    </section>
  );
}
