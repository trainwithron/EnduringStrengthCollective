"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { zonedTimeToUtc } from "@/lib/timezone";
import { notifyBookingConfirmed } from "@/lib/notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { DayHourGrid, minutesToTimeInput, type GridBlocked, type GridBooking, type GridEvent, type GridWindow } from "@/components/coach/desktop/day-hour-grid";
import { addTimeChoices, endFrom, minutesBetween, overlapWarning, parseTimeInput, shiftTime, timeOptions15, type AddKind } from "@/lib/day-add";

export interface DayClient {
  id: string;
  fullName: string;
  groupId: string;
}

// The day grid plus the one sheet a tap opens. The coach taps a time; the sheet asks what to put there (a client's session, an event, or time blocked off), already set to that exact time. The start time
// is the coach's to change to any minute and the length is theirs too: the open slots are for clients booking themselves, never a rule for the coach. Overlaps are warned about, never blocked.
export function DayCalendar({
  coachId,
  groupId,
  dateKey,
  timezone,
  organizationId,
  clients,
  initialClientId,
  defaultMinutes,
  windows,
  bookings,
  events,
  blocked,
  openRanges,
  busyRanges,
}: {
  coachId: string;
  groupId: string;
  dateKey: string;
  timezone: string;
  organizationId: string | null;
  clients: DayClient[];
  initialClientId: string | null;
  defaultMinutes: number;
  windows: GridWindow[];
  bookings: GridBooking[];
  events: GridEvent[];
  blocked: GridBlocked[];
  openRanges: { startMs: number; endMs: number }[];
  busyRanges: { startMs: number; endMs: number }[];
}) {
  const router = useRouter();
  const [pickedTime, setPickedTime] = useState<string | null>(null);
  const [kind, setKind] = useState<AddKind>("session");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAt(t: string) {
    setPickedTime(t);
    setTime(t);
    setEndTime(endFrom(t, defaultMinutes));
    setError(null);
  }
  function close() {
    setPickedTime(null);
    setTitle("");
    setError(null);
  }

  const parsed = parseTimeInput(time);
  const length = minutesBetween(time, endTime) ?? 0;
  const lengthOk = length >= 5 && length <= 480;
  const start = parsed ? zonedTimeToUtc(dateKey, time, timezone) : null;
  const end = start && lengthOk ? new Date(start.getTime() + length * 60000) : null;
  const warning = start && end && kind !== "event" ? overlapWarning(start.getTime(), end.getTime(), busyRanges, openRanges, kind) : null;
  const client = clients.find((c) => c.id === clientId) ?? null;
  const canSubmit =
    !busy && !!parsed && (kind === "event" ? title.trim() !== "" : lengthOk && (kind === "block" || !!client));

  async function submit() {
    if (!canSubmit || !parsed) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    if (kind === "session" && client && start && end) {
      // The same booking call the open slots use: its credit rules and overlap check are the ones kept.
      const { data: bookingId, error: bookError } = await supabase.rpc("book_session", {
        p_coach_id: coachId,
        p_athlete_id: client.id,
        p_group_id: client.groupId,
        p_start_at: start.toISOString(),
        p_end_at: end.toISOString(),
      });
      if (bookError) {
        setBusy(false);
        setError(bookError.message.includes("just taken") ? "That time overlaps another session." : "Couldn't add that session.");
        router.refresh();
        return;
      }
      notifyBookingConfirmed(client.id, client.groupId, start.toISOString());
      if (bookingId) mirrorGoogleCalendarEvent(bookingId);
    } else if (kind === "event") {
      const { error: eventError } = await supabase.from("calendar_events").insert({
        coach_id: coachId,
        organization_id: organizationId,
        title: title.trim(),
        event_date: dateKey,
        event_time: time,
        event_type: "custom",
      });
      if (eventError) {
        setBusy(false);
        setError("Couldn't add that event.");
        return;
      }
    } else if (kind === "block" && start && end) {
      const { error: blockError } = await supabase.from("coach_availability_exceptions").insert({
        coach_id: coachId,
        kind: "one_off",
        label: title.trim() || null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        weekday: null,
        start_time: null,
        end_time: null,
      });
      if (blockError) {
        setBusy(false);
        setError("Couldn't block that time.");
        return;
      }
    }
    setBusy(false);
    close();
    router.refresh();
  }

  // Moves the start and keeps the length, so the end moves with it.
  function nudge(delta: number) {
    const keep = minutesBetween(time, endTime) ?? defaultMinutes;
    const next = shiftTime(time || pickedTime || "09:00", delta);
    setTime(next);
    setEndTime(endFrom(next, keep));
  }

  const field = "mt-1 block w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base focus:outline-none focus:border-rust";
  const choices = addTimeChoices();

  return (
    <>
      <p className="font-body text-xs text-steel mb-2">Tap a time to add a session, an event or time off.</p>
      <DayHourGrid windows={windows} bookings={bookings} events={events} blocked={blocked} timeZone={timezone} onPickTime={openAt} />

      {pickedTime !== null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={close}>
          <div
            role="dialog"
            aria-label="Add to this day"
            className="w-full sm:max-w-md bg-graphite border-t sm:border border-steel/30 p-5 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-display font-bold uppercase text-lg leading-none">Add at {formatDisplay(time || pickedTime)}</h2>
              <button type="button" onClick={close} className="min-h-11 px-2 font-body text-xs text-steel uppercase tracking-wide">
                Close
              </button>
            </div>

            <div className="flex gap-2 mb-4" role="tablist">
              {choices.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  role="tab"
                  aria-selected={kind === c.kind}
                  onClick={() => setKind(c.kind)}
                  className={`flex-1 min-h-11 px-2 border font-body text-sm ${kind === c.kind ? "bg-rust border-rust text-graphite font-medium" : "border-steel/30 text-steel"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {kind === "session" && (
              <label className="block font-body text-xs text-steel mb-3">
                Client
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
                  <option value="">Choose a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind !== "session" && (
              <label className="block font-body text-xs text-steel mb-3">
                {kind === "event" ? "Title" : "Label (optional)"}
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "event" ? "e.g. Call the gym" : "e.g. Lunch"} className={field} />
              </label>
            )}

            {/* Start and End list every 15 minutes; any exact minute can still be typed. Moving the start moves the end with it, so the length stays. */}
            <datalist id="day-add-times">
              {timeOptions15().map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="flex items-end gap-3 mb-3">
              <label className="flex-1 font-body text-xs text-steel">
                Start
                <input
                  type="time"
                  step={60}
                  list="day-add-times"
                  value={time}
                  onChange={(e) => {
                    const next = e.target.value;
                    const keep = minutesBetween(time, endTime) ?? defaultMinutes;
                    setTime(next);
                    if (parseTimeInput(next)) setEndTime(endFrom(next, keep));
                  }}
                  className={field}
                />
              </label>
              {kind !== "event" && (
                <label className="flex-1 font-body text-xs text-steel">
                  End
                  <input type="time" step={60} list="day-add-times" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} />
                </label>
              )}
            </div>

            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => nudge(-15)} className="min-h-11 px-3 border border-steel/30 text-steel font-body text-sm">
                15 min earlier
              </button>
              <button type="button" onClick={() => nudge(15)} className="min-h-11 px-3 border border-steel/30 text-steel font-body text-sm">
                15 min later
              </button>
            </div>

            {warning && <p className="font-body text-xs text-steel mb-3">{warning}</p>}
            {error && (
              <p className="font-body text-xs text-rust mb-3" role="alert">
                {error}
              </p>
            )}

            <button type="button" onClick={submit} disabled={!canSubmit} className="w-full min-h-12 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Saving…" : kind === "session" ? "Add session" : kind === "event" ? "Add event" : "Block this time"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function formatDisplay(t: string): string {
  const p = parseTimeInput(t);
  if (!p) return t;
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${p.hour >= 12 ? "PM" : "AM"}`;
}

export { minutesToTimeInput };
