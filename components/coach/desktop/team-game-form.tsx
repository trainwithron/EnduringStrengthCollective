"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function TeamGameForm({ groupId, createdBy }: { groupId: string; createdBy: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [opponent, setOpponent] = useState("");
  const [isHome, setIsHome] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!eventDate || !opponent.trim()) {
      setError("Date and opponent are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("team_games").insert({
      group_id: groupId,
      created_by: createdBy,
      event_date: eventDate,
      start_time: startTime || null,
      opponent: opponent.trim(),
      is_home: isHome,
    });

    if (insertError) {
      setError("Couldn't save that game.");
      setSubmitting(false);
      return;
    }
    setOpen(false);
    setEventDate("");
    setStartTime("");
    setOpponent("");
    setIsHome(true);
    setSubmitting(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 px-4 border border-steel/30 text-rust font-body text-sm"
      >
        + Add game
      </button>
    );
  }

  return (
    <div className="border border-steel/20 p-4 space-y-3 max-w-sm">
      <p className="font-display uppercase text-xs tracking-wide text-steel">Add game</p>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Date</span>
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Time (optional)</span>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Opponent</span>
        <input
          type="text"
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
        />
      </label>
      <div className="flex gap-2">
        {(["Home", "Away"] as const).map((label) => {
          const value = label === "Home";
          return (
            <button
              key={label}
              type="button"
              onClick={() => setIsHome(value)}
              className={`h-9 px-4 font-body text-xs border ${
                isHome === value ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {error && <p className="font-body text-xs text-rust">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="font-body text-xs text-steel">
          Cancel
        </button>
      </div>
    </div>
  );
}
