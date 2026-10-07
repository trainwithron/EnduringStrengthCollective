"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { resolveBlockedRangesForDate, type AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE, zonedTimeToUtc } from "@/lib/timezone";
import { notifyBookingConfirmed } from "@/lib/notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { SeriesScheduleForm } from "@/components/coach/series-schedule-form";
import { formatInTimezone } from "@/lib/format-in-timezone";
import {
  assignLanes,
  clockLabel,
  clockLabel12,
  gridRange,
  isHardClash,
  minuteFromOffset,
  minutesOfDayInZone,
  offsetFromMinute,
  parseClockMinutes,
  placementProblem,
  PLACEMENT_TEXT,
  PX_PER_MINUTE,
  SNAP_CHOICES,
  type SnapMinutes,
} from "@/lib/day-time-grid";
import { typeMismatchWarning, type TypeLite } from "@/lib/session-type-default";
import { addPending, removePending } from "@/lib/pending-booking-notices";
import { CLIENT_DRAG_MIME, type DraggedClient } from "./draggable-client-name";
import type { CalendarEventEntry } from "./calendar-grid";

const UNDO_SECONDS = 8;

type WindowWithType = AvailabilityWindow & { sessionTypeId?: string | null };

// The expanded day: a time axis the coach drops a client onto (or taps, on a touch screen). Shows the open hours, the sessions already booked, the gap around
// them and any time off; a drop or tap picks a start (5 or 15 minute steps), a small confirm asks whether it repeats weekly, and the booking is made with the
// same book_session path every other booking uses. A booking can be undone for a few seconds, and the client is only told once that time has passed.
export function DayTimeGrid({
  date,
  groupId,
  client,
  bookings,
  events,
  availabilityWindows,
  blockedRanges,
  bufferMinutes = 0,
  timezone = DEFAULT_COACH_TIMEZONE,
  sessionTypes = [],
  defaultTypeId = null,
  dayHref,
  onClientDrop,
  onChanged,
  onClose,
}: {
  date: Date;
  groupId: string;
  client: DraggedClient | null;
  bookings: { time: string; name: string; startMs?: number; endMs?: number }[];
  events: CalendarEventEntry[];
  availabilityWindows: WindowWithType[];
  blockedRanges?: {
    kind: "one_off" | "recurring";
    startAt: string | null;
    endAt: string | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
  }[];
  bufferMinutes?: number;
  timezone?: string;
  sessionTypes?: TypeLite[];
  // The picked client's usual session type (from their last typed session, or their tier).
  defaultTypeId?: string | null;
  dayHref: string;
  onClientDrop: (c: DraggedClient) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const nextKey = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
  const dayEndMs = zonedTimeToUtc(nextKey, "00:00", timezone).getTime();
  const wall = (d: Date) => (d.getTime() >= dayEndMs ? 24 * 60 : minutesOfDayInZone(d, timezone));

  const dayWindows = availabilityWindows.filter((w) => w.weekday === date.getDay());
  const sessionLengthDefault = (() => {
    const w = dayWindows[0];
    if (!w) return 60;
    return w.sessionMinutes && w.sessionMinutes > 0 ? w.sessionMinutes : w.slotDurationMinutes;
  })();

  const [step, setStep] = useState<SnapMinutes>(15);
  const [length, setLength] = useState(String(sessionLengthDefault));
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const [pendingMin, setPendingMin] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<string>(defaultTypeId ?? "");
  const [repeating, setRepeating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(client?.balance ?? 0);
  const [adjusting, setAdjusting] = useState(false);
  const [typedTime, setTypedTime] = useState("");
  const [booked, setBooked] = useState<{ bookingId: string; label: string; secondsLeft: number } | null>(null);
  const undoing = useRef(false);
  // The timer that announces the booking once the undo time has run out; Undo cancels it.
  const flushTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef<{ athleteId: string; groupId: string; startIso: string; bookingId: string; timer: ReturnType<typeof setInterval> } | null>(null);

  // A different client picked: their usual type and balance.
  useEffect(() => {
    setTypeId(defaultTypeId ?? "");
    setBalance(client?.balance ?? 0);
    setPendingMin(null);
    setRepeating(false);
    setError(null);
  }, [client?.athleteId, defaultTypeId, client?.balance]);

  const lengthNumber = Number(length);
  const lengthOk = Number.isInteger(lengthNumber) && lengthNumber >= 5 && lengthNumber <= 480;
  const lengthMin = lengthOk ? lengthNumber : sessionLengthDefault;

  const windowSpans = dayWindows.map((w) => ({ startMin: parseClockMinutes(w.startTime), endMin: parseClockMinutes(w.endTime), typeId: w.sessionTypeId ?? null }));
  const blockedSpans = useMemo(
    () =>
      resolveBlockedRangesForDate(date, blockedRanges ?? [], timezone).map((b) => ({
        startMin: b.start.getTime() <= zonedTimeToUtc(dateKey, "00:00", timezone).getTime() ? 0 : minutesOfDayInZone(b.start, timezone),
        endMin: wall(b.end),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, blockedRanges, timezone]
  );
  const sessionSpans = bookings
    .filter((b) => b.startMs != null)
    .map((b) => {
      const start = new Date(b.startMs!);
      const startMin = minutesOfDayInZone(start, timezone);
      const endMin = b.endMs != null ? wall(new Date(b.endMs)) : startMin + sessionLengthDefault;
      return { startMin, endMin: Math.max(endMin, startMin + 5), name: b.name, time: b.time };
    });

  const range = gridRange([...windowSpans, ...blockedSpans, ...sessionSpans]);
  const trackHeight = (range.endMin - range.startMin) * PX_PER_MINUTE;
  const hours: number[] = [];
  for (let m = range.startMin; m < range.endMin; m += 60) hours.push(m);
  const lanes = assignLanes(sessionSpans);

  const dateLabel = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const activeStart = pendingMin ?? hoverMin;
  const problem =
    activeStart != null
      ? placementProblem({ startMin: activeStart, endMin: activeStart + lengthMin, sessions: sessionSpans, windows: windowSpans, blocked: blockedSpans, bufferMin: bufferMinutes })
      : null;
  const windowHere = activeStart != null ? windowSpans.find((w) => activeStart >= w.startMin && activeStart < w.endMin) : undefined;
  const mismatch = typeMismatchWarning({ windowTypeId: windowHere?.typeId, chosenTypeId: typeId || null, types: sessionTypes });
  const ghostClass = problem === "taken" ? "border-rust bg-rust/25" : problem ? "border-yellow-500 bg-yellow-500/15" : "border-positive bg-positive/20";

  function startOffset(e: { clientY: number; currentTarget: HTMLElement }): number {
    return e.clientY - e.currentTarget.getBoundingClientRect().top;
  }

  function pick(minute: number) {
    setError(null);
    setRepeating(false);
    setPendingMin(minute);
  }

  function readDrag(e: React.DragEvent): DraggedClient | null {
    const raw = e.dataTransfer.getData(CLIENT_DRAG_MIME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DraggedClient;
    } catch {
      return null;
    }
  }

  async function adjustCredits(delta: number) {
    if (!client) return;
    setAdjusting(true);
    const { data: newBalance } = await createBrowserClient().rpc("adjust_session_credits", {
      p_athlete_id: client.athleteId,
      p_group_id: client.groupId ?? groupId,
      p_delta: delta,
    });
    if (typeof newBalance === "number") setBalance(newBalance);
    setAdjusting(false);
  }

  // The client is told (and the calendar mirrored) once the undo time has passed, so an undone booking never sends anything.
  // It is also written down when the booking is made (lib/pending-booking-notices.ts), so a closed tab, a crash or a lost connection inside the undo time cannot
  // leave a booking the client never hears about: the next calendar page that opens sends it. A page being closed or refreshed sends it straight away.
  function sendNotifications() {
    const f = flush.current;
    if (!f) return;
    if (flushTimeout.current) {
      clearTimeout(flushTimeout.current);
      flushTimeout.current = null;
    }
    clearInterval(f.timer);
    flush.current = null;
    removePending(f.bookingId);
    notifyBookingConfirmed(f.athleteId, f.groupId, f.startIso);
    mirrorGoogleCalendarEvent(f.bookingId);
  }
  useEffect(() => {
    const onHide = () => sendNotifications();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      sendNotifications();
    };
  }, []);

  async function book() {
    if (!client || pendingMin == null) return;
    sendNotifications();
    setAssigning(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setAssigning(false);
      return;
    }
    const start = zonedTimeToUtc(dateKey, clockLabel(pendingMin), timezone);
    const end = new Date(start.getTime() + lengthMin * 60000);
    const clientGroup = client.groupId ?? groupId;
    const { data: bookingId, error: bookError } = await supabase.rpc("book_session", {
      p_coach_id: userData.user.id,
      p_athlete_id: client.athleteId,
      p_group_id: clientGroup,
      p_start_at: start.toISOString(),
      p_end_at: end.toISOString(),
    });
    if (bookError || !bookingId) {
      setAssigning(false);
      setError(bookError?.message.includes("just taken") ? "That time was just taken." : "Couldn't book that time. Nothing was changed.");
      return;
    }
    // The type chip: a session booked inside a tagged hour is already tagged by the database; the coach's own choice for this one session wins.
    if (typeId) await supabase.from("bookings").update({ session_type_id: typeId }).eq("id", bookingId as string);
    setAssigning(false);
    setPendingMin(null);
    const label = `${client.fullName}, ${formatInTimezone(start, timezone, "dateTime")}`;
    setBooked({ bookingId: bookingId as string, label, secondsLeft: UNDO_SECONDS });
    const timer = setInterval(() => {
      setBooked((b) => (b && b.secondsLeft > 1 ? { ...b, secondsLeft: b.secondsLeft - 1 } : null));
      if (flush.current && flush.current.bookingId === (bookingId as string)) {
        flush.current.timer = timer;
      }
    }, 1000);
    flush.current = { athleteId: client.athleteId, groupId: clientGroup, startIso: start.toISOString(), bookingId: bookingId as string, timer };
    addPending({ bookingId: bookingId as string, coachId: userData.user.id, athleteId: client.athleteId, groupId: clientGroup, startIso: start.toISOString(), madeAt: Date.now() });
    flushTimeout.current = setTimeout(async () => {
      flushTimeout.current = null;
      if (undoing.current || flush.current?.bookingId !== (bookingId as string)) return;
      // Right before telling the client, make sure the booking is still there (it could have been cancelled from another screen in these seconds).
      const { data: still } = await createBrowserClient().from("bookings").select("status").eq("id", bookingId as string).maybeSingle();
      if (undoing.current || flush.current?.bookingId !== (bookingId as string)) return;
      if (still && (still as { status: string }).status !== "confirmed") {
        clearInterval(flush.current.timer);
        flush.current = null;
        removePending(bookingId as string);
        return;
      }
      sendNotifications();
    }, UNDO_SECONDS * 1000);
    onChanged();
  }

  async function undo() {
    const b = booked;
    // A second tap while the first is working would fail on a booking that is already gone and look like the undo failed.
    if (!b || undoing.current) return;
    undoing.current = true;
    // Pause the countdown and the announcement timer but keep the announcement: it is only dropped once the cancel has actually worked.
    if (flush.current) clearInterval(flush.current.timer);
    if (flushTimeout.current) {
      clearTimeout(flushTimeout.current);
      flushTimeout.current = null;
    }
    let cancelError: unknown = null;
    try {
      ({ error: cancelError } = await createBrowserClient().rpc("cancel_booking_and_refund_credit", { p_booking_id: b.bookingId }));
    } catch (e) {
      cancelError = e ?? new Error("cancel failed");
    } finally {
      undoing.current = false;
    }
    if (cancelError) {
      // The booking stays, so the client is told after all, and the coach is told plainly.
      setBooked(null);
      setError("That didn't undo, so the booking stays and your client has been told. Cancel it from their panel or the day page if you still want it gone.");
      sendNotifications();
      onChanged();
      return;
    }
    if (flush.current) flush.current = null;
    removePending(b.bookingId);
    setBooked(null);
    onChanged();
  }

  const pendingLabel = pendingMin != null ? `${clockLabel12(pendingMin)} to ${clockLabel12(pendingMin + lengthMin)}` : "";

  return (
    <div className="mt-4 bg-surface border border-rust/40" role="region" aria-label={`${dateLabel}, day schedule`}>
      <div className="p-3 border-b border-steel/20 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-bold text-base uppercase leading-none">{dateLabel}</p>
          <p className="font-body text-xs text-steel mt-1">
            {client ? (
              <>
                Booking <span className="text-chalk">{client.fullName}</span>. Drop a name on a time, or tap a time.
              </>
            ) : (
              "Pick a client (drag a name here, or tap one in the list), then a time."
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close day" className="shrink-0 text-steel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-steel/20 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1" role="group" aria-label="Snap to">
          <span className="font-body text-xs text-steel mr-1">Snap</span>
          {SNAP_CHOICES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={step === s}
              onClick={() => setStep(s)}
              className={`h-7 px-2 border font-body text-xs ${step === s ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
            >
              {s} min
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 font-body text-xs text-steel">
          Length
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={length}
            onChange={(e) => setLength(e.target.value)}
            className="w-16 h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs"
          />
          min
        </label>
        {sessionTypes.length > 0 && (
          <label className="flex items-center gap-1.5 font-body text-xs text-steel">
            Type
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs" aria-label="Session type for this booking">
              <option value="">No type</option>
              {sessionTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {client && (
          <span className="flex items-center gap-1.5 font-body text-xs text-steel">
            Credits
            <button type="button" onClick={() => adjustCredits(-1)} disabled={adjusting} aria-label="Remove a session credit" className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              &minus;
            </button>
            <span className="text-chalk w-5 text-center">{balance}</span>
            <button type="button" onClick={() => adjustCredits(1)} disabled={adjusting} aria-label="Add a session credit" className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              +
            </button>
          </span>
        )}
      </div>

      {booked && (
        <div className="px-3 py-2 border-b border-steel/20 bg-positive/10 flex flex-wrap items-center gap-3" role="status">
          <span className="font-body text-sm text-chalk">Booked {booked.label}.</span>
          <button type="button" onClick={undo} className="font-body text-sm text-rust underline underline-offset-2">
            Undo ({booked.secondsLeft}s)
          </button>
          <span className="font-body text-xs text-steel">They are told when this runs out.</span>
        </div>
      )}
      {error && <p className="px-3 py-2 font-body text-xs text-rust border-b border-steel/20">{error}</p>}

      <div className="max-h-[560px] overflow-y-auto">
        <div className="flex">
          <div className="relative w-14 shrink-0" style={{ height: trackHeight }} aria-hidden="true">
            {hours.map((m) => (
              <span key={m} className="absolute right-2 font-body text-[10px] text-steel -translate-y-1/2" style={{ top: offsetFromMinute(m, range) }}>
                {clockLabel12(m).replace(":00", "")}
              </span>
            ))}
          </div>
          <div
            className="relative flex-1 border-l border-steel/20 cursor-crosshair touch-pan-y"
            style={{ height: trackHeight }}
            data-testid="day-track"
            onDragOver={(e) => {
              e.preventDefault();
              setHoverMin(minuteFromOffset(startOffset(e), range, step, lengthMin));
            }}
            onDragLeave={() => setHoverMin(null)}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = readDrag(e);
              const minute = minuteFromOffset(startOffset(e), range, step, lengthMin);
              setHoverMin(null);
              if (dropped) onClientDrop(dropped);
              if (dropped || client) pick(minute);
            }}
            onPointerMove={(e) => {
              if (e.pointerType === "mouse" && client) setHoverMin(minuteFromOffset(startOffset(e), range, step, lengthMin));
            }}
            onPointerLeave={() => setHoverMin(null)}
            onClick={(e) => {
              if (!client) {
                setError("Pick a client first: drag a name here, or tap one in the list.");
                return;
              }
              pick(minuteFromOffset(startOffset(e), range, step, lengthMin));
            }}
          >
            {hours.map((m) => (
              <div key={m} className="absolute left-0 right-0 border-t border-steel/10" style={{ top: offsetFromMinute(m, range) }} />
            ))}
            {windowSpans.map((w, i) => (
              <div
                key={`w${i}`}
                title={`Open ${clockLabel12(w.startMin)} to ${clockLabel12(w.endMin)}${w.typeId ? `, ${sessionTypes.find((t) => t.id === w.typeId)?.name ?? ""}` : ""}`}
                className="absolute left-0 right-0 bg-positive/10 border-y border-positive/25"
                style={{ top: offsetFromMinute(w.startMin, range), height: (w.endMin - w.startMin) * PX_PER_MINUTE }}
              >
                {w.typeId && <span className="absolute right-1 top-0.5 font-body text-[10px] text-positive/80">{sessionTypes.find((t) => t.id === w.typeId)?.name}</span>}
              </div>
            ))}
            {blockedSpans.map((b, i) => (
              <div
                key={`b${i}`}
                title="Time off"
                className="absolute left-0 right-0 border-y border-steel/40"
                style={{
                  top: offsetFromMinute(b.startMin, range),
                  height: Math.max(2, (b.endMin - b.startMin) * PX_PER_MINUTE),
                  backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--steel) / 0.25) 0 4px, transparent 4px 8px)",
                }}
              >
                <span className="absolute left-1 top-0.5 font-body text-[10px] text-steel">Time off</span>
              </div>
            ))}
            {lanes.map(({ item, lane, lanes: count }, i) => {
              const top = offsetFromMinute(item.startMin, range);
              const height = Math.max(14, (item.endMin - item.startMin) * PX_PER_MINUTE);
              const halo = bufferMinutes * PX_PER_MINUTE;
              return (
                <div key={`s${i}`} className="absolute" style={{ top: top - halo, height: height + halo * 2, left: `${(lane / count) * 100}%`, width: `${100 / count}%` }}>
                  {bufferMinutes > 0 && <div className="absolute inset-0 border border-dashed border-blue-400/40" aria-hidden="true" />}
                  <div className="absolute left-0.5 right-0.5 bg-blue-500/35 border border-blue-400 px-1 overflow-hidden" style={{ top: halo, height }}>
                    <span className="font-body text-[11px] leading-tight text-chalk block truncate">
                      {item.time} {item.name}
                    </span>
                  </div>
                </div>
              );
            })}
            {activeStart != null && client && (
              <div
                className={`absolute left-1 right-1 border-2 pointer-events-none ${pendingMin != null ? "border-rust bg-rust/30" : ghostClass}`}
                style={{ top: offsetFromMinute(activeStart, range), height: lengthMin * PX_PER_MINUTE }}
              >
                <span className="font-body text-[11px] text-chalk px-1">
                  {clockLabel12(activeStart)} to {clockLabel12(activeStart + lengthMin)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {(problem || mismatch) && activeStart != null && client && (
        <div className="px-3 pt-2 space-y-0.5">
          {problem && <p className="font-body text-xs text-steel">{PLACEMENT_TEXT[problem]}</p>}
          {mismatch && <p className="font-body text-xs text-steel">{mismatch}</p>}
        </div>
      )}

      {pendingMin != null && client && (
        <div className="m-3 border border-rust/40 p-3" role="group" aria-label="Confirm session">
          <p className="font-body text-sm text-chalk">
            {client.fullName}: {pendingLabel}
            {typeId ? ` · ${sessionTypes.find((t) => t.id === typeId)?.name ?? ""}` : ""}
          </p>
          {repeating ? (
            <div className="mt-3">
              <SeriesScheduleForm
                groupId={client.groupId ?? groupId}
                athleteId={client.athleteId}
                athleteName={client.fullName}
                timezone={timezone}
                initialStartIso={zonedTimeToUtc(dateKey, clockLabel(pendingMin), timezone).toISOString()}
                defaultDurationMinutes={lengthMin}
                onCancel={() => {
                  setRepeating(false);
                  setPendingMin(null);
                  onChanged();
                }}
              />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" disabled={assigning || !lengthOk || isHardClash(problem)} onClick={book} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
                {assigning ? "Booking…" : "Book this session"}
              </button>
              <button type="button" disabled={assigning} onClick={() => setRepeating(true)} className="border border-steel/40 text-chalk font-body text-sm px-4 py-2 disabled:opacity-40">
                Repeat weekly…
              </button>
              <button type="button" onClick={() => setPendingMin(null)} className="font-body text-sm text-steel">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2 border-t border-steel/20 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 font-body text-xs text-steel">
          Or type a time
          <input
            type="time"
            step={300}
            value={typedTime}
            onChange={(e) => {
              setTypedTime(e.target.value);
              if (client && /^\d{2}:\d{2}$/.test(e.target.value)) pick(parseClockMinutes(e.target.value));
            }}
            className="h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs"
          />
        </label>
        {events.length > 0 && (
          <span className="font-body text-xs text-steel">
            Also today: {events.map((ev) => `${ev.time ? `${ev.time} ` : ""}${ev.title}`).join(", ")}
          </span>
        )}
        <Link href={dayHref} className="font-body text-xs text-rust underline underline-offset-2 ml-auto">
          Open day page &rarr;
        </Link>
      </div>
    </div>
  );
}
