"use client";

import { useState } from "react";
import { buildSparklinePath } from "@/lib/program-card-visuals";
import { MIN_SESSIONS_FOR_HISTORY, type VolumeHistoryPoint } from "@/lib/exercise-volume-history";

const SPARK_W = 200;
const SPARK_H = 40;

// Literal hex, same presentation-attribute convention already used by
// components/coach/desktop/client-card-nutrition-sparkline.tsx.
const RUST = "#D2703B";

// A collapsed-by-default toggle, not an always-visible chart — the
// governing rule for anything added to the live-logging screen (also
// applied to Phase 4's rest-timer mini-game) is that it never competes
// with or slows down the actual input fields. Renders nothing at all
// below MIN_SESSIONS_FOR_HISTORY, matching TrendChart's own "needs more
// data" convention elsewhere in this app.
export function ExerciseVolumeHistory({ history }: { history: VolumeHistoryPoint[] }) {
  const [open, setOpen] = useState(false);

  if (history.length < MIN_SESSIONS_FOR_HISTORY) return null;

  const { linePath, areaPath } = buildSparklinePath(
    history.map((h) => h.totalVolume),
    SPARK_W,
    SPARK_H
  );
  const first = history[0];
  const latest = history[history.length - 1];

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-body text-xs text-steel active:text-rust transition-colors"
      >
        {open ? "Hide" : "Show"} volume history ({history.length} sessions)
      </button>
      {open && (
        <div className="mt-2">
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            className="w-full max-w-[200px] h-10 overflow-visible"
            aria-label={`Tonnage across ${history.length} logged sessions of this exercise`}
          >
            {areaPath && <path d={areaPath} fill={RUST} opacity={0.12} stroke="none" />}
            <path
              d={linePath}
              fill="none"
              stroke={RUST}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <p className="font-body text-[11px] text-steel mt-1">
            {Math.round(first.totalVolume).toLocaleString()} lbs &rarr;{" "}
            {Math.round(latest.totalVolume).toLocaleString()} lbs
          </p>
        </div>
      )}
    </div>
  );
}
