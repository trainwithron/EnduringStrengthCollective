"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { X } from "lucide-react";
import type { AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { CLIENT_DRAG_MIME, type DraggedClient } from "./draggable-client-name";
import { ExpandedDayScheduler } from "./expanded-day-scheduler";

export interface CalendarEventEntry {
  id: string;
  title: string;
  time: string | null;
  type: "custom" | "suggestion";
  status: string;
}

// V3 visual polish, approved mockup — one shared dot item shape so a
// cell's compact dots and the side panel's full rows can be built from
// the exact same list rather than two parallel formatting passes.
// "custom" calendar events are this page's real stand-in for the
// mockup's PR dot: there's no workout-log PR data on this page (and the
// brief was explicit — reuse what's already fetched here, no new
// plumbing), so the one category a coach deliberately flagged (a custom
// event, as opposed to an auto-generated suggestion or a routine
// scheduled workout/booking) gets the same glowing treatment instead.
interface DotItem {
  key: string;
  time: string | null;
  label: string;
  dotClass: string;
  badge?: string;
  deleteId?: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

const DOT_WORKOUT = "bg-positive";
const DOT_BOOKING = "bg-blue-400";
const DOT_SUGGESTION = "bg-yellow-500";
const DOT_CUSTOM_GLOW =
  "bg-rust shadow-[0_0_5px_rgb(var(--rust)/0.7)]";

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
  timezone = DEFAULT_COACH_TIMEZONE,
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
  // The coach's own IANA zone — start_time/end_time on availabilityWindows
  // are their local wall-clock hours, and the day-scheduler this grid
  // opens needs the same zone to compute real, correct slot instants.
  timezone?: string;
}) {
  const router = useRouter();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; date: Date; client: DraggedClient } | null>(
    null
  );
  // "Select, don't navigate away" (the approved mockup's own framing of
  // Linear's pattern) — a click used to router.push into a separate day
  // page; now it opens an inline side panel built from the exact same
  // bookings/events/workouts maps already passed into this grid, so the
  // coach never loses their place in the month. The full day-detail page
  // (slot assignment, custom events, the hour grid) is still one click
  // away via the panel's own "Open day" link, not removed.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const todayKey = dateKey(today);

  function dayHref(date: Date): string {
    const base = `/groups/${groupId}/calendar/${dateKey(date)}`;
    return selectedClientId ? `${base}?client=${selectedClientId}` : base;
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
      setDropTarget({ key, date, client });
    } catch {
      // Malformed drag payload — ignore rather than crash the grid.
    }
  }

  function dotItemsFor(key: string): DotItem[] {
    const workouts = workoutsByDateKey?.get(key) ?? [];
    const bookings = bookingsByDateKey.get(key) ?? [];
    const events = eventsByDateKey.get(key) ?? [];
    return [
      ...workouts.map((w, idx) => ({
        key: `w-${idx}`,
        time: null,
        label: w.athleteName ? `${w.athleteName}: ${w.title}` : w.title,
        dotClass: DOT_WORKOUT,
      })),
      ...bookings.map((b, idx) => ({
        key: `b-${idx}`,
        time: b.time,
        label: b.name,
        dotClass: DOT_BOOKING,
      })),
      ...events.map((e) => ({
        key: e.id,
        time: e.time,
        label: e.title,
        dotClass: e.type === "suggestion" ? DOT_SUGGESTION : DOT_CUSTOM_GLOW,
        badge: e.type === "suggestion" ? "Suggested" : undefined,
        deleteId: e.id,
      })),
    ];
  }

  const selectedDate = cellDates.find((d) => d && dateKey(d) === selectedKey) ?? null;
  const selectedItems = selectedKey ? dotItemsFor(selectedKey) : [];

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
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSelected = key === selectedKey;
        const bookings = bookingsByDateKey.get(key) ?? [];
        const events = eventsByDateKey.get(key) ?? [];
        const workouts = workoutsByDateKey?.get(key) ?? [];
        const isDropTarget = dropTarget?.key === key;
        const bookingsShown = showAllBookings ? bookings : bookings.slice(0, 3);
        const items = dotItemsFor(key);
        const DOT_CAP = showAllBookings ? 16 : 8;
        const dotsShown = items.slice(0, DOT_CAP);
        const dotsOverflow = items.length - dotsShown.length;

        return (
          <div
            key={i}
            role="button"
            aria-pressed={isSelected}
            tabIndex={0}
            onClick={() => setSelectedKey((k) => (k === key ? null : key))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedKey((k) => (k === key ? null : key));
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverKey(key);
            }}
            onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
            onDrop={(e) => handleDrop(e, key, date)}
            className={`p-1.5 flex flex-col gap-0.5 relative group cursor-pointer transition-colors ${
              isToday ? "bg-surface/50" : "bg-graphite hover:bg-surface/60"
            } ${isSelected ? "ring-2 ring-inset ring-rust" : ""} ${
              dragOverKey === key ? "ring-2 ring-inset ring-rust bg-rust/10" : ""
            } ${isDropTarget ? "ring-2 ring-inset ring-rust" : ""}`}
            style={{ minHeight: cellMinHeightPx }}
          >
            <span className="inline-flex items-center gap-1">
              <span
                className={`font-body text-[10px] ${
                  isToday ? "text-rust font-bold" : isWeekend ? "text-steel/50" : "text-steel"
                }`}
              >
                {date.getDate()}
              </span>
              {isToday && (
                <span
                  aria-hidden="true"
                  className="w-1 h-1 rounded-full bg-rust shadow-[0_0_6px_rgb(var(--rust)/0.7)]"
                />
              )}
            </span>

            {showAllBookings ? (
              <>
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
                      onClick={(evt) => {
                        evt.stopPropagation();
                        handleDeleteEvent(e.id);
                      }}
                      aria-label={`Remove ${e.title}`}
                      className="shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}

                {bookings.length === 0 && events.length === 0 && (
                  <span className="font-body text-[10px] text-steel">No sessions</span>
                )}
              </>
            ) : (
              items.length > 0 && (
                <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                  {dotsShown.map((item) => (
                    <span
                      key={item.key}
                      title={item.label}
                      className={`w-[5px] h-[5px] rounded-full shrink-0 ${item.dotClass}`}
                    />
                  ))}
                  {dotsOverflow > 0 && (
                    <span className="font-body text-[8px] text-steel leading-none">+{dotsOverflow}</span>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}
      </div>

      {selectedDate && (
        <div className="mt-4 bg-surface border border-steel/20 rounded-token-lg p-4">
          <p className="font-display font-bold text-base uppercase leading-none mb-3">
            {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          {selectedItems.length === 0 ? (
            <p className="font-body text-sm text-steel">Nothing scheduled this day.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {selectedItems.map((item) => (
                <div key={item.key} className="flex items-center gap-3 py-2 group/row">
                  <span className="font-mono text-[10px] text-steel w-12 shrink-0">{item.time ?? ""}</span>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dotClass}`} />
                  <span className="font-body text-sm text-chalk flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-token-pill bg-rust/15 text-rust shrink-0">
                      {item.badge}
                    </span>
                  )}
                  {item.deleteId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(item.deleteId!)}
                      aria-label={`Remove ${item.label}`}
                      className="shrink-0 opacity-0 group-hover/row:opacity-100 text-steel"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <Link
            href={dayHref(selectedDate)}
            className="inline-block mt-3 font-body text-xs text-rust underline underline-offset-2"
          >
            Open day &rarr;
          </Link>
        </div>
      )}

      {dropTarget && (
        <ExpandedDayScheduler
          date={dropTarget.date}
          groupId={groupId}
          client={dropTarget.client}
          bookings={bookingsByDateKey.get(dropTarget.key) ?? []}
          events={eventsByDateKey.get(dropTarget.key) ?? []}
          availabilityWindows={availabilityWindows}
          blockedRanges={blockedRanges}
          timezone={timezone}
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
