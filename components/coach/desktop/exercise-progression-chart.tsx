"use client";

import { useState } from "react";
import { TrendChart } from "./trend-chart";

// Which exercise to chart is the one real choice here — the data itself
// is already fully computed server-side (best set per day, per exercise).
// New exercises appear in this list automatically the first time they're
// logged; nothing to configure per exercise.
export function ExerciseProgressionChart({
  progressionData,
}: {
  progressionData: Record<string, { date: string; value: number }[]>;
}) {
  const exerciseNames = Object.keys(progressionData).sort((a, b) => a.localeCompare(b));
  const [selected, setSelected] = useState(exerciseNames[0] ?? "");

  if (exerciseNames.length === 0) {
    return <p className="font-body text-sm text-steel py-2">No logged sets yet.</p>;
  }

  return (
    <div>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mb-3"
      >
        {exerciseNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <TrendChart
        points={progressionData[selected] ?? []}
        unit=" lbs"
        emptyLabel="Only logged once so far — needs a second session to chart a trend."
      />
    </div>
  );
}
