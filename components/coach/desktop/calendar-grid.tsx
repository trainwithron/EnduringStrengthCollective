"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Plus, X } from "lucide-react";
import type { AvailabilityWindow } from "@/lib/booking-slots";
import { CLIENT_DRAG_MIME, type DraggedClient } from "./draggable-client-name";
import { ExpandedDayScheduler } from "./expanded-day-scheduler";

export interface CalendarEventEntry {
  id: string;
  title: string;
  time: string | null;
  type: "custom" | "suggestion";
  status: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CalendarGrid({
  groupId,
  selectedClientId,
  headerLabels,
  cellDates,
  today,
  bookingsByDateKey,
  eventsByDateKey,
  workoutsByDateKey,
  availabilityWindows,
  blockedRanges,
  cellMinHeightPx,
  showAllBookings,
}: {
  groupId: string;
  selectedClientId?: string;
  headerLabels: string[];
  cellDates: (Date | null)[];
  today: Date;
  bookingsByDateKey: Map<string, { time: string; name: string }[]>;
  eventsByDateKey: Map<string, CalendarEventEntry[]>;
  // Every program's computed workout for this date, across the whole
  // group — the overlay that makes this the coach's one real calendar
  // instead of a separate per-program view. athleteName is null for the
  // group's shared program.
  workoutsByDateKey?: Map<string, { title: string; athleteName: string | null }[]>;
  availabilityWindows: AvailabilityWindow[];
  blockedRanges?: {
    kind: "one_off" | "recurring";
    startAt: string | null;
    endAt: string | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
  }[];
  cellMinHeightPx: number;
  // Month cells truncate to a handful of items to stay compact; week
  // cells have room to show everything.
  showAllBookings: boolean;
}) {
  const router = useRouter();
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; date: Date; client: DraggedClient } | null>(
    null
  );
  const todayKey = dateKey(today);

  function dayHref(date: Date): string {
    const base = `/groups/${groupId}/calendar/${dateKey(date)}`;
    return selectedClientId ? `${base}?client=${selectedClientId}` : base;
  }

  async function handleAddEvent(key: string) {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      return;
    }
    await supabase.from("calendar_events").insert({
      coach_id: userData.user.id,
      title: title.trim(),
      event_date: key,
      event_time: time || null,
      event_type: "custom",
    });
    setSaving(false);
    setAddingFor(null);
    setTitle("");
    setTime("");
    router.refresh();
  }

  async function handleDeleteEvent(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("calendar_events").delete().eq("id", id);
    router.refresh();
  }

  function handleDrop(e: React.DragEvent, key: string, date: Date) {
    e.preventDefault();
    setDragOverKey(null);
    const raw = e.dataTransfer.getData(CLIENT_DRAG_MIME);
    if (!raw) return;
    try {
      const client = JSON.parse(raw) as DraggedClient;
      setAddingFor(null);
      setDropTarget({ key, date, client });
    } catch {
      // Malformed drag payload — ignore rather than crash the grid.
    }
  }

  return (
    <>
      <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15">
      {headerLabels.map((label, i) => (
        <div
          key={i}
          className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
        >
          {label}
        </div>
      ))}

      {cellDates.map((date, i) => {
        if (!date) return <div key={i} className="bg-graphite" style={{ minHeight: cellMinHeightPx }} />;

        const key = dateKey(date);
        const isToday = key === todayKey;
        const bookings = bookingsByDateKey.get(key) ?? [];
        const events = eventsByDateKey.get(key) ?? [];
        const workouts = workoutsByDateKey?.get(key) ?? [];
        const isAdding = addingFor === key;
        const isDropTarget = dropTarget?.key === key;
        const bookingsShown = showAllBookings ? bookings : bookings.slice(0, 3);

        return (
          <div
            key={i}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverKey(key);
            }}
            onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
            onDrop={(e) => handleDrop(e, key, date)}
            className={`bg-graphite p-1.5 flex flex-col gap-0.5 relative group ${
              isToday ? "ring-1 ring-inset ring-rust" : ""
            } ${dragOverKey === key ? "ring-2 ring-inset ring-rust bg-rust/10" : ""} ${
              isDropTarget ? "ring-2 ring-inset ring-rust" : ""
            }`}
            style={{ minHeight: cellMinHeightPx }}
          >
            <div className="flex items-center justify-between">
              <Link
                href={dayHref(date)}
                className={`font-body text-[10px] active:text-rust transition-colors ${
                  isToday ? "text-rust font-bold" : "text-steel"
                }`}
              >
                {date.getDate()}
              </Link>
              <button
                type="button"
                onClick={() => setAddingFor(isAdding ? null : key)}
                aria-label="Add to calendar"
                className="w-4 h-4 flex items-center justify-center text-steel opacity-0 group-hover:opacity-100 active:text-rust transition-opacity"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {workouts.map((w, idx) => (
              <span key={`w-${idx}`} className="font-body text-[9px] text-positive leading-tight truncate">
                {w.athleteName ? `${w.athleteName}: ` : ""}
                {w.title}
              </span>
            ))}

            {bookingsShown.map((b, idx) => (
              <span key={`b-${idx}`} className="font-body text-[9px] text-chalk leading-tight">
                {b.time} &middot; {b.name}
              </span>
            ))}
            {!showAllBookings && bookings.length > 3 && (
              <span className="font-body text-[9px] text-steel">+{bookings.length - 3} more</span>
            )}

            {events.map((e) => (
              <div
                key={e.id}
                className={`flex items-center gap-1 font-body text-[9px] leading-tight ${
                  e.type === "suggestion" ? "text-yellow-500" : "text-rust"
                }`}
              >
                <span className="truncate flex-1">
                  {e.time ? `${e.time} · ` : ""}
                  {e.title}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteEvent(e.id)}
                  aria-label={`Remove ${e.title}`}
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}

            {bookings.length === 0 && events.length === 0 && showAllBookings && (
              <span className="font-body text-[10px] text-steel">No sessions</span>
            )}

            {isAdding && (
              <div className="absolute z-10 top-6 left-0 right-0 bg-surface border border-rust/40 p-2 space-y-1.5 shadow-lg">
                <input
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title"
                  className="w-full h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-[11px]"
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-[11px]"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleAddEvent(key)}
                    disabled={saving}
                    className="flex-1 h-6 bg-rust text-graphite font-body text-[10px] font-medium disabled:opacity-40"
                  >
                    {saving ? "Adding…" : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingFor(null);
                      setTitle("");
                      setTime("");
                    }}
                    className="h-6 px-2 border border-steel/30 text-steel font-body text-[10px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </div>
        );
      })}
      </div>

      {dropTarget && (
        <ExpandedDayScheduler
          date={dropTarget.date}
          groupId={groupId}
          client={dropTarget.client}
          bookings={bookingsByDateKey.get(dropTarget.key) ?? []}
          events={eventsByDateKey.get(dropTarget.key) ?? []}
          availabilityWindows={availabilityWindows}
          blockedRanges={blockedRanges}
          onAssigned={() => {
            setDropTarget(null);
            router.refresh();
          }}
          onCancel={() => setDropTarget(null)}
        />
      )}
    </>
  );
}
