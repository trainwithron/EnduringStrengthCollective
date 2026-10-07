"use client";

import { clampApplyFrom, maxApplyFromKey, shortDateLabel } from "@/lib/apply-from";

// "Apply from": the day a new standing target starts. Today by default, up to 14 days ahead; never in the past (past days keep the target they had).
export function ApplyFromField({
  value,
  onChange,
  todayKey,
  disabled,
}: {
  value: string;
  onChange: (key: string) => void;
  todayKey: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 font-body text-xs text-steel">
      Apply from
      <input
        type="date"
        value={value}
        min={todayKey}
        max={maxApplyFromKey(todayKey)}
        disabled={disabled}
        onChange={(e) => onChange(clampApplyFrom(e.target.value, todayKey))}
        aria-label="Date the new target starts"
        className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
      />
      <span className="text-steel/80">{value === todayKey ? "today" : shortDateLabel(value)}</span>
    </label>
  );
}
