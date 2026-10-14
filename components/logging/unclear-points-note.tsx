"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { setUnclearPointCounted, unclearLabel } from "@/lib/unclear-points";
import type { SetLogEntry } from "@/lib/types";

// Under an exercise of an imported workout: each set the import marked as unclear, exactly as entered, with a question mark and the plain label. Only the coach gets the button.
export function UnclearPointsNote({
  sets,
  canDecide,
  onFlagChange,
}: {
  sets: SetLogEntry[];
  canDecide: boolean;
  onFlagChange: (setId: string, flag: "unclear" | "accepted") => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const marked = sets.filter((s) => s.dataFlag);
  if (marked.length === 0) return null;

  async function decide(setId: string, counts: boolean) {
    if (busy) return;
    setBusy(setId);
    setError(null);
    const problem = await setUnclearPointCounted(createBrowserClient(), setId, counts);
    setBusy(null);
    if (problem) {
      setError(problem);
      return;
    }
    onFlagChange(setId, counts ? "accepted" : "unclear");
  }

  return (
    <div className="mt-2 border-t border-steel/15 pt-2 font-body text-xs text-steel">
      {marked.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-x-3">
          <span>
            <span className="text-chalk">
              Set {s.setOrder + 1}: {s.weight ?? "–"} × {s.reps ?? "–"} <span aria-hidden>?</span>
            </span>{" "}
            {unclearLabel(s.dataFlag)}
            {s.dataFlagReason ? ` · ${s.dataFlagReason}` : ""}
          </span>
          {canDecide && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => void decide(s.id, s.dataFlag === "unclear")}
              className="min-h-11 text-rust underline underline-offset-2 disabled:opacity-40"
            >
              {s.dataFlag === "unclear" ? "Count it" : "Leave it out"}
            </button>
          )}
        </div>
      ))}
      {error && (
        <p className="text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
