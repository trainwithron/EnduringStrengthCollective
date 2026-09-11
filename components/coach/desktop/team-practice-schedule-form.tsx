"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface PracticeScheduleRow {
  id: string;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export function TeamPracticeScheduleForm({
  groupId,
  createdBy,
  initialSchedules,
}: {
  groupId: string;
  createdBy: string;
  initialSchedules: PracticeScheduleRow[];
}) {
  const router = useRouter();
  const [schedules, setSchedules] = useState(initialSchedules);
  const [title, setTitle] = useState("Practice");
  const [weekday, setWeekday] = useState("2");
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("18:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    if (startTime >= endTime) {
      setError("End time must be after start time.");
      return;
    }
    setSubmitting(true);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("team_practice_schedules")
      .insert({
        group_id: groupId,
        created_by: createdBy,
        title: title.trim() || "Practice",
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
      })
      .select("id, title, weekday, start_time, end_time")
      .single();

    if (data) {
      setSchedules((prev) =>
        [
          ...prev,
          { id: data.id, title: data.title, weekday: data.weekday, startTime: data.start_time, endTime: data.end_time },
        ].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
      );
      // The calendar grid below this list is server-rendered from the
      // page's own initial fetch — a purely client-side state update
      // here would leave it stale until some unrelated navigation.
      router.refresh();
    } else if (insertError) {
      setError("Couldn't save that practice slot.");
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("team_practice_schedules").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="border border-steel/20 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
        Recurring practices
      </h2>
      {schedules.length > 0 && (
        <div className="divide-y divide-steel/15 mb-3">
          {schedules.map((s) => (
            <div key={s.id} className="py-2 flex items-center justify-between gap-3">
              <span className="font-body text-sm">
                {s.title} — {WEEKDAYS[s.weekday]} {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                aria-label="Delete practice slot"
                className="w-7 h-7 inline-flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-32 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Day</span>
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          >
            {WEEKDAYS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Start</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">End</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
    </div>
  );
}
