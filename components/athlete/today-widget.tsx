"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Check } from "lucide-react";

export interface TodayMacros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface TodayHabit {
  id: string;
  title: string;
  completed: boolean;
}

export function TodayWidget({
  todayDate,
  macros,
  habits,
}: {
  todayDate: string;
  macros: TodayMacros | null;
  habits: TodayHabit[];
}) {
  const [state, setState] = useState(habits);
  const [error, setError] = useState<string | null>(null);

  async function toggle(habitId: string, current: boolean) {
    setError(null);
    setState((prev) => prev.map((h) => (h.id === habitId ? { ...h, completed: !current } : h)));
    const supabase = createBrowserClient();
    const { error: upsertError } = await supabase
      .from("habit_logs")
      .upsert(
        { habit_id: habitId, log_date: todayDate, completed_at: !current ? new Date().toISOString() : null },
        { onConflict: "habit_id,log_date" }
      );

    // The checkbox already flipped optimistically — if the write actually
    // failed, flip it back rather than leaving the UI showing a completion
    // that was never saved.
    if (upsertError) {
      setState((prev) => prev.map((h) => (h.id === habitId ? { ...h, completed: current } : h)));
      setError("Couldn't save — check your connection and try again.");
    }
  }

  const hasMacros = macros && (macros.calories != null || macros.proteinG != null);
  if (!hasMacros && state.length === 0) return null;

  return (
    <div className="border border-steel/20 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Today</h2>

      {hasMacros && (
        <>
        <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1">Your targets today</p>
        <div className="grid grid-cols-4 gap-2 text-center mb-4">
          <div>
            <p className="font-display text-lg leading-none">{macros!.calories ?? "--"}</p>
            <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
          </div>
          <div>
            <p className="font-display text-lg leading-none">{macros!.proteinG ?? "--"}</p>
            <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
          </div>
          <div>
            <p className="font-display text-lg leading-none">{macros!.carbsG ?? "--"}</p>
            <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
          </div>
          <div>
            <p className="font-display text-lg leading-none">{macros!.fatG ?? "--"}</p>
            <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
          </div>
        </div>
        </>
      )}

      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}

      {state.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-steel/15">
          {state.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => toggle(h.id, h.completed)}
              className="w-full flex items-center gap-2 text-left"
            >
              <span
                className={`w-5 h-5 shrink-0 border flex items-center justify-center ${
                  h.completed ? "bg-positive border-positive" : "border-steel/30"
                }`}
              >
                {h.completed && <Check className="w-3.5 h-3.5 text-graphite" strokeWidth={3} />}
              </span>
              <span className="font-body text-sm">{h.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
