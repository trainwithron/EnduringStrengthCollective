"use client";

import { useState } from "react";
import { estimateOneRepMax, percentageTable } from "@/lib/one-rep-max";

export function OneRepMaxCalculator() {
  const [weight, setWeight] = useState("225");
  const [reps, setReps] = useState("5");

  const weightNum = Number(weight);
  const repsNum = Number(reps);
  const valid = weightNum > 0 && repsNum >= 1 && repsNum <= 15;
  const oneRm = valid ? estimateOneRepMax(weightNum, repsNum) : null;
  const table = oneRm ? percentageTable(oneRm) : [];

  return (
    <div className="max-w-md">
      <div className="flex gap-4">
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Weight (lbs)
          </span>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Reps</span>
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>

      {!valid && (
        <p className="font-body text-xs text-steel mt-3">
          Enter a weight and 1–15 reps for an estimate (this formula gets
          unreliable past that).
        </p>
      )}

      {oneRm && (
        <>
          <div className="mt-6 pb-4 border-b border-steel/15">
            <p className="font-display text-4xl leading-none">{oneRm}</p>
            <p className="font-body text-xs text-steel mt-1">Estimated 1-rep max (lbs)</p>
          </div>

          <div className="mt-4 divide-y divide-steel/15">
            {table.map((row) => (
              <div key={row.pct} className="flex items-center justify-between py-2">
                <span className="font-body text-sm text-steel">{row.pct}%</span>
                <span className="font-body text-sm">{row.weight} lbs</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
