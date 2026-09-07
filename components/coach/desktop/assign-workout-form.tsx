"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface WorkoutOption {
  id: string;
  label: string;
}

export function AssignWorkoutForm({
  athleteId,
  groupId,
  date,
  options,
  initialWorkoutId,
  initialNote,
}: {
  athleteId: string;
  groupId: string;
  date: string; // "YYYY-MM-DD"
  options: WorkoutOption[];
  initialWorkoutId: string | null;
  initialNote: string;
}) {
  const [workoutId, setWorkoutId] = useState(initialWorkoutId ?? "");
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [hasAssignment, setHasAssignment] = useState(!!initialWorkoutId || !!initialNote);
  const router = useRouter();

  async function handleSave() {
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    await supabase.from("workout_assignments").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        scheduled_date: date,
        workout_id: workoutId || null,
        note: note.trim() || null,
        created_by: user.id,
      },
      { onConflict: "athlete_id,scheduled_date" }
    );
    setHasAssignment(true);
    setSaving(false);
    router.refresh();
  }

  async function handleClear() {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase
      .from("workout_assignments")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("scheduled_date", date);
    setWorkoutId("");
    setNote("");
    setHasAssignment(false);
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <select
        value={workoutId}
        onChange={(e) => setWorkoutId(e.target.value)}
        className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      >
        <option value="">No specific workout</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Save
        </button>
        {hasAssignment && (
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="h-9 px-3 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
