"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { VisibilityWindow } from "@/lib/program-schedule";

const VISIBILITY_OPTIONS: { value: VisibilityWindow; label: string }[] = [
  { value: "day", label: "Day of" },
  { value: "week", label: "Week of" },
  { value: "month", label: "Month of" },
  { value: "full", label: "Full program" },
];

const WEEKDAYS = [
  { value: 0, label: "Su" },
  { value: 1, label: "Mo" },
  { value: 2, label: "Tu" },
  { value: 3, label: "We" },
  { value: 4, label: "Th" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
] as const;

export function ProgramScheduleSettings({
  programId,
  initialStartDate,
  initialTrainingDays,
  initialVisibilityWindow,
  onChange,
}: {
  programId: string;
  initialStartDate: string | null;
  initialTrainingDays: number[] | null;
  initialVisibilityWindow: VisibilityWindow;
  onChange: (startDate: string | null, trainingDays: number[] | null) => void;
}) {
  const [startDate, setStartDate] = useState(initialStartDate ?? "");
  const [trainingDays, setTrainingDays] = useState<number[]>(initialTrainingDays ?? []);
  const [visibilityWindow, setVisibilityWindow] = useState<VisibilityWindow>(
    initialVisibilityWindow
  );
  const [shiftDays, setShiftDays] = useState("7");
  const [saving, setSaving] = useState(false);

  async function persist(nextStartDate: string, nextTrainingDays: number[]) {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase
      .from("programs")
      .update({
        start_date: nextStartDate || null,
        training_days: nextTrainingDays.length > 0 ? nextTrainingDays : null,
      })
      .eq("id", programId);
    onChange(nextStartDate || null, nextTrainingDays.length > 0 ? nextTrainingDays : null);
    setSaving(false);
  }

  async function handleVisibilityChange(next: VisibilityWindow) {
    setVisibilityWindow(next);
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("programs").update({ visibility_window: next }).eq("id", programId);
    setSaving(false);
  }

  function toggleDay(day: number) {
    const next = trainingDays.includes(day)
      ? trainingDays.filter((d) => d !== day)
      : [...trainingDays, day].sort();
    setTrainingDays(next);
    persist(startDate, next);
  }

  // Shifting is just moving the anchor forward — nothing else is stored,
  // so every workout's computed date updates automatically.
  function handleShift() {
    const n = Number(shiftDays);
    if (!startDate || !Number.isFinite(n) || n === 0) return;
    const next = new Date(`${startDate}T00:00:00`);
    next.setDate(next.getDate() + n);
    const nextStartDate = next.toISOString().slice(0, 10);
    setStartDate(nextStartDate);
    persist(nextStartDate, trainingDays);
  }

  return (
    <div className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">
          Start date
        </span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            persist(e.target.value, trainingDays);
          }}
          disabled={saving}
          className="h-8 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs disabled:opacity-40"
        />
      </label>

      <div className="flex items-center gap-1">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide mr-1">
          Training days
        </span>
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() => toggleDay(day.value)}
            disabled={saving}
            className={`h-6 w-6 flex items-center justify-center border font-body text-[10px] transition-colors disabled:opacity-40 ${
              trainingDays.includes(day.value)
                ? "bg-rust border-rust text-graphite"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            {day.label[0]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">
          Unlock ahead
        </span>
        <select
          value={visibilityWindow}
          onChange={(e) => handleVisibilityChange(e.target.value as VisibilityWindow)}
          disabled={saving}
          className="h-8 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs disabled:opacity-40"
        >
          {VISIBILITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">
          Shift schedule
        </span>
        <input
          type="number"
          value={shiftDays}
          onChange={(e) => setShiftDays(e.target.value)}
          disabled={saving || !startDate}
          className="h-8 w-16 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs disabled:opacity-40"
        />
        <span className="font-body text-[11px] text-steel">days</span>
        <button
          type="button"
          onClick={handleShift}
          disabled={saving || !startDate}
          className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          Shift
        </button>
      </label>
    </div>
  );
}
