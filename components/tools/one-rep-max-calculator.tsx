"use client";

import { useState } from "react";
import { estimateOneRepMax, percentageTable } from "@/lib/one-rep-max";
import { estimateTrainingMaxFromSet } from "@/lib/rpe-training-max";
import { MAX_ESTIMATE_REPS, TRAINING_MAX_REPS_NOTE } from "@/lib/training-max";
import { weightUnitLabel, type WeightUnit } from "@/lib/units";

// In the person's own unit (audit C17, Nov 21): the estimate is the same ratio either way, so only the labels, the starting number and the rounding change.
export function OneRepMaxCalculator({ unit = "lb" }: { unit?: WeightUnit }) {
  const label = weightUnitLabel(unit);
  const [weight, setWeight] = useState(unit === "kg" ? "100" : "225");
  const [reps, setReps] = useState("5");
  // Optional — same RPE-aware formula already backing the real, persisted
  // athlete_training_maxes estimate (lib/rpe-training-max.ts) rather than
  // this tool quietly using a plain-Epley number that disagreed with the
  // one the rest of the app treats as a client's actual training max.
  // Blank RPE falls back to plain Epley exactly as before.
  const [rpe, setRpe] = useState("");

  const weightNum = Number(weight);
  const repsNum = Number(reps);
  const rpeNum = Number(rpe);
  const hasRpe = rpe.trim() !== "" && rpeNum >= 1 && rpeNum <= 10;
  const valid = weightNum > 0 && repsNum >= 1 && repsNum <= MAX_ESTIMATE_REPS;
  const oneRm = valid ? (hasRpe ? estimateTrainingMaxFromSet(weightNum, repsNum, rpeNum) : estimateOneRepMax(weightNum, repsNum)) : null;
  const table = oneRm ? percentageTable(oneRm, unit === "kg" ? 2.5 : 5) : [];

  return (
    <div className="max-w-md">
      <div className="flex gap-4">
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Weight ({label})
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Reps</span>
          <input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">RPE (optional)</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder="1-10"
            className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>

      {!valid && (
        <p className="font-body text-xs text-steel mt-3">
          Enter a weight and 1 to {MAX_ESTIMATE_REPS} reps for an estimate. {TRAINING_MAX_REPS_NOTE} Add how hard that set felt (RPE, 1-10)
          for a more accurate estimate; leave it blank and it is treated as RPE 9, the same assumption your saved training maxes use.
        </p>
      )}

      {oneRm && (
        <>
          <div className="mt-6 pb-4 border-b border-steel/15">
            <p className="font-display text-4xl leading-none">{oneRm}</p>
            <p className="font-body text-xs text-steel mt-1">
              {hasRpe ? `Estimated 1-rep max (${label}) — RPE-adjusted` : `Estimated 1-rep max (${label})`}
            </p>
          </div>

          <div className="mt-4 divide-y divide-steel/15">
            {table.map((row) => (
              <div key={row.pct} className="flex items-center justify-between py-2">
                <span className="font-body text-sm text-steel">{row.pct}%</span>
                <span className="font-body text-sm">
                  {row.weight} {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
