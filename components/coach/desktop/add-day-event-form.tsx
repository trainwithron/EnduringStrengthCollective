"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";

// A to-do for this day, with no time (clutter pass, Nov 21). A timed event, a session or time off is added by tapping a time on the day (day-calendar.tsx): that sheet needs
// a time, so a to-do with none is the one thing it cannot add, and this small box under the day's to-dos is kept for it alone.
export function AddDayEventForm({ coachId, dateKey, organizationId }: { coachId: string; dateKey: string; organizationId: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const ok = await saved(supabase.from("calendar_events").insert({
      coach_id: coachId,
      organization_id: organizationId,
      title: title.trim(),
      event_date: dateKey,
      event_time: null,
      event_type: "custom",
    }));
    setSaving(false);
    // What was typed is kept when the save failed, so trying again is one tap.
    if (!ok) return;
    setTitle("");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2" data-add-day-todo>
      <input
        aria-label="Add a to-do"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
        }}
        placeholder="Add a to-do"
        className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={saving || !title.trim()}
        className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm font-medium disabled:opacity-40"
      >
        {saving ? "Adding…" : "Add"}
      </button>
    </div>
  );
}
