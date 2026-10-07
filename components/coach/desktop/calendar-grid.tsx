"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { X } from "lucide-react";
import type { AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { dateFromKey } from "@/lib/date-key";
import type { TypeLite } from "@/lib/session-type-default";
import { CLIENT_DRAG_MIME, type DraggedClient } from "./draggable-client-name";
import { DayTimeGrid } from "./day-time-grid";
import { useCalendarScheduling } from "./calendar-scheduling-context";

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

const DOT_WORKOUT = "bg-positive";
const DOT_BOOKING = "bg-blue-400";
const DOT_SUGGESTION = "bg-yellow-500";
const DOT_CUSTOM_GLOW =
  "bg-rust shadow-[0_0_5px_rgb(var(--rust)/0.7)]";

// Each day arrives as a "YYYY-MM-DD" key, never a Date: a Date built on the server (UTC) reads as the evening before in a browser west of UTC, which put every
// day one column to the right and a dropped client on the wrong day (Ron, Oct 6). The key is turned into a local Date here, in the browser, only to read the
// day's own number and weekday.
export function CalendarGrid({
  groupId,
  selectedClientId,
  headerLabels,
  cellKeys,
  todayKey,
  bookingsByDateKey,
  eventsByDateKey,
  workoutsByDateKey,
  availabilityWindows,
  blockedRanges,
  cellMinHeightPx,
  showAllBookings,
  timezone = DEFAULT_COACH_TIMEZONE,
  bufferMinutes = 0,
  sessionTypes = [],
  defaultTypeByClient = {},
}: {
  groupId: string;
  selectedClientId?: string;
  headerLabels: string[];
  cellKeys: (string | null)[];
  todayKey: string;
  bookingsByDateKey: Map<string, { time: string; name: string; startMs?: number; endMs?: number }[]>;
  eventsByDateKey: Map<string, CalendarEventEntry[]>;
  // Every program's computed workout for this date, across the whole
  // group — the overlay that makes this the coach's one real calendar
  // instead of a separate per-program view. athleteName is null for the
  // group's shared program.
  workoutsByDateKey?: Map<string, { title: string; athleteName: string | null }[]>;
  availabilityWindows: (AvailabilityWindow & { sessionTypeId?: string | null })[];
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
  // are their local wall-clock hours, and the day grid this opens needs the
  // same zone to compute real, correct instants.
  timezone?: string;
  // The coach's gap between sessions, shown around each booked session.
  bufferMinutes?: number;
  sessionTypes?: TypeLite[];
  // Each client's usual session type id (their last typed session, or their tier).
  defaultTypeByClient?: Record<string, string | null>;
}) {
  const router = useRouter();
  const { client, setClient } = useCalendarScheduling();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // The open day: a click, a tap or a drop opens it in place as a time grid, below the calendar. A day opened with no client shows what is on it and asks who.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function dayHref(key: string): string {
    const base = `/groups/${groupId}/calendar/${key}`;
    const id = client?.athleteId ?? selectedClientId;
    return id ? `${base}?client=${id}` : base;
  }

  async function handleDeleteEvent(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("calendar_events").delete().eq("id", id);
    router.refresh();
  }

  function openDay(key: string) {
    setExpandedKey((k) => (k === key && !client ? null : key));
    // Bring the time grid into view on a long page.
    setTimeout(() => document.getElementById("calendar-day-grid")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }

  function handleDrop(e: React.DragEvent, key: string) {
    e.preventDefault();
    setDragOverKey(null);
    const raw = e.dataTransfer.getData(CLIENT_DRAG_MIME);
    if (!raw) return;
    try {
      const dropped = JSON.parse(raw) as DraggedClient;
      setClient(dropped);
      setExpandedKey(key);
      setTimeout(() => document.getElementById("calendar-day-grid")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
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

  const expandedDate = expandedKey && cellKeys.includes(expandedKey) ? dateFromKey(expandedKey) : null;
  // Sessions are in the time grid itself; this list keeps the day's workouts and calendar events (with their remove buttons) that the time axis does not draw.
  const otherItems = expandedKey ? dotItemsFor(expandedKey).filter((i) => !i.key.startsWith("b-")) : [];

  return (
    <div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-px bg-steel/15 border border-steel/15">
      {headerLabels.map((label, i) => (
        <div
          key={i}
          className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5"
        >
          {label}
        </div>
      ))}

      {cellKeys.map((key, i) => {
        if (!key) return <div key={i} className="bg-graphite" style={{ minHeight: cellMinHeightPx }} />;

        const date = dateFromKey(key);
        const isToday = key === todayKey;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isSelected = key === expandedKey;
        const bookings = bookingsByDateKey.get(key) ?? [];
        const events = eventsByDateKey.get(key) ?? [];
        const workouts = workoutsByDateKey?.get(key) ?? [];
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
            aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            tabIndex={0}
            onClick={() => openDay(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDay(key);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverKey(key);
            }}
            onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
            onDrop={(e) => handleDrop(e, key)}
            className={`p-1.5 flex flex-col gap-0.5 relative group cursor-pointer transition-colors min-w-0 overflow-hidden ${
              isToday ? "bg-surface/50" : "bg-graphite hover:bg-surface/60"
            } ${isSelected ? "ring-2 ring-inset ring-rust" : ""} ${
              dragOverKey === key ? "ring-2 ring-inset ring-rust bg-rust/10" : ""
            }`}
            style={{ minHeight: cellMinHeightPx }}
          >
            <span className="inline-flex items-center gap-1">
              <span
                className={`font-body text-xs ${
                  isToday ? "text-rust font-bold" : isWeekend ? "text-steel" : "text-steel"
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
                  <span key={`w-${idx}`} className="font-body text-xs text-positive leading-tight truncate">
                    {w.athleteName ? `${w.athleteName}: ` : ""}
                    {w.title}
                  </span>
                ))}

                {bookingsShown.map((b, idx) => (
                  <span key={`b-${idx}`} className="font-body text-xs text-chalk leading-tight">
                    {b.time} &middot; {b.name}
                  </span>
                ))}

                {events.map((e) => (
                  <div
                    key={e.id}
                    className={`flex items-center gap-1 font-body text-xs leading-tight ${
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
                  <span className="font-body text-xs text-steel">No sessions</span>
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

      {expandedDate && expandedKey && (
        <div id="calendar-day-grid">
          <DayTimeGrid
            key={expandedKey}
            date={expandedDate}
            groupId={groupId}
            client={client}
            bookings={bookingsByDateKey.get(expandedKey) ?? []}
            events={[]}
            availabilityWindows={availabilityWindows}
            blockedRanges={blockedRanges}
            bufferMinutes={bufferMinutes}
            timezone={timezone}
            sessionTypes={sessionTypes}
            defaultTypeId={client ? defaultTypeByClient[client.athleteId] ?? null : null}
            dayHref={dayHref(expandedKey)}
            onClientDrop={(c) => setClient(c)}
            onChanged={() => router.refresh()}
            onClose={() => setExpandedKey(null)}
          />
          {otherItems.length > 0 && (
            <div className="mt-2 bg-surface border border-steel/20 p-3">
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Also on this day</p>
              <div className="divide-y divide-steel/15">
                {otherItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 py-1.5 group/row">
                    <span className="font-mono text-xs text-steel w-12 shrink-0">{item.time ?? ""}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dotClass}`} />
                    <span className="font-body text-sm text-chalk flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded-token-pill bg-rust/15 text-rust shrink-0">{item.badge}</span>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
