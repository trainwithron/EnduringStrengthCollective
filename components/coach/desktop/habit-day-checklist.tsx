"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Check } from "lucide-react";

export interface DueHabit {
  id: string;
  title: string;
  completed: boolean;
}

export function HabitDayChecklist({ date, habits }: { date: string; habits: DueHabit[] }) {
  const [state, setState] = useState(habits);

  async function toggle(habitId: string, current: boolean) {
    setState((prev) => prev.map((h) => (h.id === habitId ? { ...h, completed: !current } : h)));
    const supabase = createBrowserClient();
    await supabase
      .from("habit_logs")
      .upsert(
        { habit_id: habitId, log_date: date, completed_at: !current ? new Date().toISOString() : null },
        { onConflict: "habit_id,log_date" }
      );
  }

  if (state.length === 0) {
    return <p className="font-body text-sm text-steel">No habits due this day.</p>;
  }

  return (
    <div className="space-y-1.5">
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
  );
}
