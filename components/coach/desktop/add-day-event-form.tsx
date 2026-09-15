"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Real relocation, not new scope: this exact insert used to live as a
// cramped inline popup on the month-grid calendar cell
// (live_walkthrough_round2_findings.md — "clicking a day opens a small
// popup instead of taking you into that day"). The grid cell now always
// navigates straight into this real day view; this is where "add a
// to-do/event" actually belongs now, with real room instead of a
// 3-input hover popup.
export function AddDayEventForm({ coachId, dateKey }: { coachId: string; dateKey: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("calendar_events").insert({
      coach_id: coachId,
      title: title.trim(),
      event_date: dateKey,
      event_time: time || null,
      event_type: "custom",
    });
    setSaving(false);
    setTitle("");
    setTime("");
    router.refresh();
  }

  return (
    <div className="flex items-end gap-2 mb-4 max-w-lg">
      <div className="flex-1">
        <label className="font-body text-[11px] text-steel uppercase tracking-wide mb-1 block">
          Add a to-do or event
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call the gym about equipment"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm"
        />
      </div>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-28 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={saving || !title.trim()}
        className="h-9 px-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {saving ? "Adding…" : "Add"}
      </button>
    </div>
  );
}
