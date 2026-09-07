"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

const PRESET_HABITS = [
  "Drink 100oz of water",
  "10,000 steps",
  "Sleep 8 hours",
  "Eat a vegetable with every meal",
  "No alcohol",
  "Stretch/mobility 10 minutes",
];

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Su" },
  { value: 1, label: "Mo" },
  { value: 2, label: "Tu" },
  { value: 3, label: "We" },
  { value: 4, label: "Th" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
];

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
  const [title, setTitle] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [applyToGroup, setApplyToGroup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || weekdays.length === 0) return;
    setSubmitting(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }

    if (applyToGroup) {
      // Assigning the same habit to every current athlete in the group at
      // once — one insert per athlete, rather than making the coach open
      // each client's calendar individually for a group-wide challenge.
      const { data: memberRows } = await supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", groupId)
        .eq("role", "athlete");

      const athleteIds = (memberRows ?? []).map((m) => m.profile_id);
      if (athleteIds.length === 0) {
        setSubmitting(false);
        return;
      }

      const { data } = await supabase
        .from("client_habits")
        .insert(
          athleteIds.map((id) => ({
            athlete_id: id,
            group_id: groupId,
            title: title.trim(),
            weekdays,
            created_by: user.id,
          }))
        )
        .select("id, title, weekdays, active, athlete_id");

      const forThisAthlete = (data ?? []).find((h: any) => h.athlete_id === athleteId);
      if (forThisAthlete) setHabits((prev) => [...prev, forThisAthlete as ClientHabit]);
      setTitle("");
      router.refresh();
      setSubmitting(false);
      return;
    }

    const { data } = await supabase
      .from("client_habits")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        title: title.trim(),
        weekdays,
        created_by: user.id,
      })
      .select("id, title, weekdays, active")
      .single();

    if (data) {
      setHabits((prev) => [...prev, data as ClientHabit]);
      setTitle("");
      router.refresh();
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("client_habits").delete().eq("id", id);
    setHabits((prev) => prev.filter((h) => h.id !== id));
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

      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESET_HABITS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setTitle(preset)}
            className="font-body text-[11px] text-steel border border-steel/30 px-2 py-1 active:border-rust active:text-rust"
          >
            {preset}
          </button>
        ))}
      </div>

      <form onSubmit={handleAdd} className="space-y-2 pt-2 border-t border-steel/15">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Drink 100oz water"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <div className="flex gap-1">
          {WEEKDAYS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => toggleDay(w.value)}
              className={`w-8 h-8 font-body text-xs border ${
                weekdays.includes(w.value)
                  ? "bg-rust text-graphite border-rust"
                  : "border-steel/30 text-steel"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 font-body text-xs text-steel">
          <input
            type="checkbox"
            checked={applyToGroup}
            onChange={(e) => setApplyToGroup(e.target.checked)}
            className="w-4 h-4"
          />
          Assign to every client in this group
        </label>
        <button
          type="submit"
          disabled={submitting || !title.trim() || weekdays.length === 0}
          className="w-full h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {applyToGroup ? "Add habit to whole group" : "Add habit"}
        </button>
      </form>
    </div>
  );
}
