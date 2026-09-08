"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function ChallengeCreator({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("6");
  const [entryFee, setEntryFee] = useState("49");
  const [habits, setHabits] = useState<string[]>(["8,000 steps daily", "3 workouts this week"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateHabit(i: number, value: string) {
    setHabits((prev) => prev.map((h, idx) => (idx === i ? value : h)));
  }
  function addHabit() {
    setHabits((prev) => [...prev, ""]);
  }
  function removeHabit(i: number) {
    setHabits((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !startDate) {
      setError("Name and start date are required.");
      return;
    }
    const cleanHabits = habits.map((h) => h.trim()).filter(Boolean);
    if (cleanHabits.length === 0) {
      setError("Add at least one habit target.");
      return;
    }
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { data: challenge, error: insertError } = await supabase
      .from("challenges")
      .insert({
        coach_id: user.id,
        name: name.trim(),
        description: description.trim() || null,
        start_date: startDate,
        duration_weeks: parseInt(durationWeeks, 10) || 1,
        entry_fee_cents: Math.round((parseFloat(entryFee) || 0) * 100),
        status: "draft",
      })
      .select("id")
      .single();

    if (insertError || !challenge) {
      setError("Couldn't create the challenge.");
      setSaving(false);
      return;
    }

    await supabase.from("challenge_habits").insert(
      cleanHabits.map((title, i) => ({ challenge_id: challenge.id, title, sort_order: i }))
    );

    setSaving(false);
    setOpen(false);
    router.push(`/groups/${groupId}/challenges/${challenge.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 px-5 bg-rust text-graphite font-body text-sm font-medium"
      >
        + New challenge
      </button>
    );
  }

  return (
    <div className="border border-steel/20 p-5 space-y-3 max-w-lg">
      <h3 className="font-body text-xs text-steel uppercase tracking-wide">New challenge</h3>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Challenge name, e.g. Summer Shred"
        className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short description (optional)"
        className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
      />
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
        <label className="block">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Weeks</span>
          <input
            type="number"
            min={1}
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
        <label className="block">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Entry fee ($)</span>
          <input
            type="number"
            min={0}
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
      </div>

      <div>
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">
          Daily habit targets
        </span>
        <div className="space-y-1.5 mt-1">
          {habits.map((h, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                type="text"
                value={h}
                onChange={(e) => updateHabit(i, e.target.value)}
                placeholder="e.g. Track calories"
                className="flex-1 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              />
              <button
                type="button"
                onClick={() => removeHabit(i)}
                className="h-8 px-2 border border-steel/30 text-steel font-body text-xs"
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addHabit} className="font-body text-xs text-rust">
            + Add habit
          </button>
        </div>
      </div>

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={saving}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create challenge"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 px-4 border border-steel/30 text-steel font-body text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
