"use client";

import { WEIGHT_UNIT_LABEL, type WeightUnit } from "@/lib/weight-units";

// "Weights are in: Pounds / Kilograms", picked before a file is chosen (pounds unless changed). It only matters when the file itself does not say: a header like "Weight (kg)" or a value like "100kg"
// always wins. Kilograms are converted to pounds when saved (the app stores pounds).
export function WeightUnitChoice({ value, onChange, disabled = false }: { value: WeightUnit; onChange: (unit: WeightUnit) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Weights are in" className="flex flex-wrap items-center gap-2">
      <span className="font-body text-xs text-steel">Weights are in:</span>
      {(["lb", "kg"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          disabled={disabled}
          aria-pressed={value === unit}
          onClick={() => onChange(unit)}
          className={`min-h-11 px-3 font-body text-xs border border-steel/30 disabled:opacity-40 ${value === unit ? "bg-chalk text-graphite" : "text-steel hover:text-chalk"}`}
        >
          {WEIGHT_UNIT_LABEL[unit]}
        </button>
      ))}
    </div>
  );
}
