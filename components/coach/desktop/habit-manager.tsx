"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";
import { AddHabitForm, WEEKDAYS } from "./add-habit-form";

export interface ClientHabit {
  id: string;
  title: string;
  weekdays: number[];
  active: boolean;
}

export function HabitManager({
  athleteId,
  groupId,
  initialHabits,
}: {
  athleteId: string;
  groupId: string;
  initialHabits: ClientHabit[];
}) {
  const [habits, setHabits] = useState(initialHabits);
  const router = useRouter();

  async function handleDelete(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("client_habits").delete().eq("id", id);
    setHabits((prev) => prev.filter((h) => h.id !== id));
    router.refresh();
  }

  function handleAdded(habit: ClientHabit) {
    setHabits((prev) => [...prev, habit]);
    router.refresh();
  }

  return (
    <div className="border border-steel/20 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Habits</h2>

      {habits.length === 0 ? (
        <p className="font-body text-sm text-steel mb-3">No habits assigned yet.</p>
      ) : (
        <div className="divide-y divide-steel/15 mb-4">
          {habits.map((h) => (
            <div key={h.id} className="py-2 flex items-center justify-between gap-2">
              <div>
                <p className="font-body text-sm">{h.title}</p>
                <p className="font-body text-[11px] text-steel">
                  {WEEKDAYS.filter((w) => h.weekdays.includes(w.value))
                    .map((w) => w.label)
                    .join(" ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(h.id)}
                className="text-steel active:text-rust shrink-0"
                aria-label={`Delete habit ${h.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AddHabitForm athleteId={athleteId} groupId={groupId} onAdded={handleAdded} />
    </div>
  );
}
