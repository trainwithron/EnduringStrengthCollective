"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SpotterFlag } from "@/lib/programming-spotter-gather";

// Programming Spotter — reviews a program's own structure before anyone
// logs a rep against it. Deliberately every headline is phrased as a
// question, never an assertion (the evidence behind these checks doesn't
// support a hard "this is wrong" claim) — same governing fact-vs-question
// rule as the rest of the Collective Intelligence work.
export function ProgrammingSpotterPanel({ programId, flags }: { programId: string; flags: SpotterFlag[] }) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = flags.filter((f) => !dismissed.has(`${f.checkKind}::${f.patternKey}`));
  if (visible.length === 0) return null;

  async function handleDismiss(flag: SpotterFlag) {
    const key = `${flag.checkKind}::${flag.patternKey}`;
    setDismissing(key);
    try {
      await fetch("/api/programming-spotter/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, checkKind: flag.checkKind, patternKey: flag.patternKey }),
      });
      setDismissed((prev) => new Set(prev).add(key));
      router.refresh();
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="border border-steel/20 bg-surface px-4 py-3 mb-4">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide font-bold mb-2">
        Programming Spotter
      </p>
      <div className="space-y-2">
        {visible.map((flag) => {
          const key = `${flag.checkKind}::${flag.patternKey}`;
          return (
            <div key={key} className="flex items-start gap-2">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-steel" />
              <p className="font-body text-sm text-chalk flex-1">{flag.headline}</p>
              <button
                type="button"
                onClick={() => handleDismiss(flag)}
                disabled={dismissing === key}
                className="font-body text-[11px] text-steel uppercase tracking-wide shrink-0 active:text-rust disabled:opacity-40"
              >
                Dismiss
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
