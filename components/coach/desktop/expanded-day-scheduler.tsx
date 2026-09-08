"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { generateSlotsForDate, formatSlotTime, type AvailabilityWindow } from "@/lib/booking-slots";
import type { DraggedClient } from "./draggable-client-name";
import type { CalendarEventEntry } from "./calendar-grid";

// A full day view shown when a client is dropped onto a calendar day —
// replaces the old cramped time-slot dropdown with everything already
// on that day (recurring hours, existing bookings, custom events) plus
// an inline credit editor, so the coach never has to leave the calendar
// to check a client's balance or see what else is happening that day.
export function ExpandedDayScheduler({
  date,
  groupId,
  client,
  bookings,
  events,
  availabilityWindows,
  onAssigned,
  onCancel,
}: {
  date: Date;
  groupId: string;
  client: DraggedClient;
  bookings: { time: string; name: string }[];
  events: CalendarEventEntry[];
  availabilityWindows: AvailabilityWindow[];
  onAssigned: () => void;
  onCancel: () => void;
}) {
  const [balance, setBalance] = useState(client.balance);
  const [adjustingCredits, setAdjustingCredits] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const daySlots = generateSlotsForDate(
    date,
    availabilityWindows.filter((w) => w.weekday === date.getDay())
  );

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function adjustCredits(delta: number) {
    setAdjustingCredits(true);
    const supabase = createBrowserClient();
    const { data: newBalance } = await supabase.rpc("adjust_session_credits", {
      p_athlete_id: client.athleteId,
      p_group_id: groupId,
      p_delta: delta,
    });
    if (typeof newBalance === "number") setBalance(newBalance);
    setAdjustingCredits(false);
  }

  async function handleAssignSlot(start: Date, durationMinutes: number) {
    setAssigning(true);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setAssigning(false);
      return;
    }
    const endAt = new Date(start.getTime() + durationMinutes * 60000);

    const { error: insertError } = await supabase.from("bookings").insert({
      coach_id: userData.user.id,
      athlete_id: client.athleteId,
      group_id: groupId,
      start_at: start.toISOString(),
      end_at: endAt.toISOString(),
    });

    if (!insertError) {
      await supabase.rpc("adjust_session_credits", {
        p_athlete_id: client.athleteId,
        p_group_id: groupId,
        p_delta: -1,
      });
    }

    setAssigning(false);
    onAssigned();
  }

  // Merge everything already on this day into one time-ordered list —
  // this is the "show me everything else scheduled" part.
  type ScheduleRow = { time: string | null; label: string; kind: "booking" | "event" };
  const scheduleRows: ScheduleRow[] = [
    ...bookings.map((b) => ({ time: b.time, label: b.name, kind: "booking" as const })),
    ...events.map((e) => ({ time: e.time, label: e.title, kind: "event" as const })),
  ].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="bg-graphite border border-rust/40 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-steel/20 flex items-start justify-between gap-4">
          <div>
            <p className="font-body text-[11px] text-steel uppercase tracking-wide">
              Schedule session
            </p>
            <h2 className="font-display font-bold text-xl uppercase leading-tight mt-0.5">
              {client.fullName}
            </h2>
            <p className="font-body text-sm text-steel mt-0.5">{dateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="font-body text-xs text-steel uppercase tracking-wide"
          >
            Close ✕
          </button>
        </div>

        <div className="p-5 border-b border-steel/20 flex items-center gap-3">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Session credits
          </span>
          <button
            type="button"
            onClick={() => adjustCredits(-1)}
            disabled={adjustingCredits || balance === 0}
            className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            &minus;
          </button>
          <span className="font-display text-lg w-6 text-center">{balance}</span>
          <button
            type="button"
            onClick={() => adjustCredits(1)}
            disabled={adjustingCredits}
            className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            +
          </button>
          {balance === 0 && (
            <span className="font-body text-xs text-rust">
              Add a credit before booking, or adjust it here.
            </span>
          )}
        </div>

        <div className="p-5 border-b border-steel/20">
          <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
            Already on this day
          </h3>
          {availabilityWindows.filter((w) => w.weekday === date.getDay()).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {availabilityWindows
                .filter((w) => w.weekday === date.getDay())
                .map((w, i) => (
                  <span
                    key={i}
                    className="font-body text-[11px] text-steel border border-steel/30 px-2 py-1"
                  >
                    Available {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)}
                  </span>
                ))}
            </div>
          )}
          {scheduleRows.length === 0 ? (
            <p className="font-body text-sm text-steel">Nothing else scheduled this day.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {scheduleRows.map((row, i) => (
                <div key={i} className="py-1.5 flex items-center gap-3">
                  <span className="font-body text-xs text-steel w-16 shrink-0">
                    {row.time ?? "—"}
                  </span>
                  <span
                    className={`font-body text-sm ${
                      row.kind === "event" ? "text-rust" : "text-chalk"
                    }`}
                  >
                    {row.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5">
          <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
            Open time slots
          </h3>
          {balance <= 0 ? (
            <p className="font-body text-sm text-rust">
              No sessions remaining — add a credit above to book.
            </p>
          ) : daySlots.length === 0 ? (
            <p className="font-body text-sm text-steel">No open hours this day.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {daySlots.map((slot, idx) => {
                const label = formatSlotTime(slot.start);
                const taken = bookings.some((b) => b.time === label);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={taken || assigning}
                    onClick={() => handleAssignSlot(slot.start, slot.durationMinutes)}
                    className="flex items-center justify-between h-9 px-2.5 font-body text-xs border border-steel/20 text-chalk disabled:opacity-30 active:border-rust active:text-rust"
                  >
                    {label}
                    <span className="text-steel">{taken ? "Booked" : "Open"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
