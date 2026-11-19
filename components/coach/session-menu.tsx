"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { notifyBookingConfirmed } from "@/lib/notify-booking-confirmed";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { clockLabel, clockLabel12, minutesOfDayInZone } from "@/lib/day-time-grid";
import { CancelSessionDialog } from "@/components/coach/session-cancel-dialog";
import { DUPLICATE_MAX_WEEKS, duplicateSummary, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, MENU_HELD_MAX_MS, MENU_SETTLE_MS, menuPosition } from "@/lib/session-menu";

export interface MenuSession {
  bookingId: string;
  seriesId: string | null;
  name: string;
  startMs: number;
  endMs: number;
}

type Dialog = { kind: "reschedule" | "duplicate" | "remove" | "canceled"; session: MenuSession };

// A client's session on the calendar: right-click it on a computer, or press and hold it on a phone, for Reschedule, Duplicate and Remove (Ron, Nov 2).
// One hook per calendar view: spread handlersFor(session) on each session's element and render `node` once. Nothing about the element's own layout changes.
export function useSessionMenu(timezone: string, onChanged?: () => void) {
  const router = useRouter();
  const changed = onChanged ?? (() => router.refresh());
  const [open, setOpen] = useState<{ session: MenuSession; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; at: number; onScroll: () => void } | null>(null);
  // A press that opened the menu must not also click what is under the finger (open the day, open the cancel box).
  const swallowClick = useRef(false);
  // Ron, Nov 19: press and hold was finicky on his phone (about six presses before the menu stayed open). The press is timed with touch events, which Chrome keeps sending
  // while it decides between a scroll and its own long press (the pointer events it cancels part way, which stopped the timer), and an open menu ignores the taps, the
  // right-click Chrome sends for its own long press, and the small scroll a resting thumb makes until just after the finger lifts (each of those closed it at once).
  const fingerDown = useRef(false);
  const holdOpenUntil = useRef(0);

  function clearPress() {
    if (press.current) {
      clearTimeout(press.current.timer);
      window.removeEventListener("scroll", press.current.onScroll, true);
    }
    press.current = null;
  }

  function openMenu(session: MenuSession, x: number, y: number) {
    // Capped, so a lift the page never hears (the session redrawn under the finger) cannot leave a menu that ignores every tap.
    holdOpenUntil.current = fingerDown.current ? Date.now() + MENU_HELD_MAX_MS : 0;
    setOpen({ session, x, y });
  }

  function fingerUp() {
    fingerDown.current = false;
    if (holdOpenUntil.current > Date.now()) holdOpenUntil.current = Date.now() + MENU_SETTLE_MS;
  }

  useEffect(() => clearPress, []);

  function handlersFor(session: MenuSession) {
    return {
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Chrome's own long press can land here too: the menu opens once, wherever the timer got to.
        const touched = press.current !== null || fingerDown.current;
        clearPress();
        if (touched) swallowClick.current = true;
        openMenu(session, e.clientX, e.clientY);
      },
      onPointerDown: () => {
        swallowClick.current = false;
      },
      onTouchStart: (e: ReactTouchEvent) => {
        clearPress();
        const touch = e.touches[0];
        if (e.touches.length !== 1 || !touch) return;
        fingerDown.current = true;
        const x = touch.clientX;
        const y = touch.clientY;
        // Anything scrolling while the finger is down makes it a scroll, not a hold (a slow drag stays inside the drift allowance but moves the page), as Chrome's own long press decides.
        const onScroll = () => clearPress();
        window.addEventListener("scroll", onScroll, { capture: true, passive: true });
        press.current = {
          x,
          y,
          at: Date.now(),
          onScroll,
          timer: setTimeout(() => {
            clearPress();
            swallowClick.current = true;
            // A short buzz says the hold counted (phones that allow it; others ignore it).
            try {
              navigator.vibrate?.(10);
            } catch {}
            openMenu(session, x, y);
          }, LONG_PRESS_MS),
        };
      },
      onTouchMove: (e: ReactTouchEvent) => {
        const touch = e.touches[0];
        if (press.current && touch && Math.hypot(touch.clientX - press.current.x, touch.clientY - press.current.y) > LONG_PRESS_SLOP_PX) clearPress();
      },
      onTouchEnd: () => {
        clearPress();
        fingerUp();
      },
      // Chrome cancels the touch when it takes the press as its own long press: a finger held that long still opens the menu.
      onTouchCancel: () => {
        if (press.current && Date.now() - press.current.at < LONG_PRESS_MS / 2) clearPress();
        fingerUp();
      },
      onClickCapture: (e: ReactMouseEvent) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      style: { WebkitTouchCallout: "none", userSelect: "none" } as CSSProperties,
    };
  }

  const node =
    typeof document === "undefined" ? null : (
      <>
        {open &&
          createPortal(
            <SessionMenuPopup
              session={open.session}
              x={open.x}
              y={open.y}
              timezone={timezone}
              settled={() => Date.now() >= holdOpenUntil.current}
              onPick={(kind) => {
                setDialog({ kind, session: open.session });
                setOpen(null);
              }}
              onClose={() => setOpen(null)}
            />,
            document.body
          )}
        {dialog?.kind === "remove" &&
          createPortal(
            <CancelSessionDialog
              target={{ bookingId: dialog.session.bookingId, seriesId: dialog.session.seriesId, name: dialog.session.name, whenLabel: formatInTimezone(new Date(dialog.session.startMs), timezone, "dateTime") }}
              onClose={() => setDialog(null)}
              onDone={changed}
            />,
            document.body
          )}
        {dialog?.kind === "reschedule" && createPortal(<RescheduleDialog session={dialog.session} timezone={timezone} onClose={() => setDialog(null)} onDone={changed} />, document.body)}
        {dialog?.kind === "canceled" && createPortal(<ClientCanceledDialog session={dialog.session} timezone={timezone} onClose={() => setDialog(null)} onDone={changed} />, document.body)}
        {dialog?.kind === "duplicate" && createPortal(<DuplicateDialog session={dialog.session} timezone={timezone} onClose={() => setDialog(null)} onDone={changed} />, document.body)}
      </>
    );

  return { handlersFor, node };
}

// For a session drawn by a server page: the same menu on one element.
export function SessionMenuTarget({ session, timezone, className, children }: { session: MenuSession; timezone: string; className?: string; children: ReactNode }) {
  const menu = useSessionMenu(timezone);
  // The menu is drawn beside the session, not inside it: a portal's events still reach its React parent, so inside the session a slow tap on a menu choice started a new hold
  // (and the choice was swallowed), and a right-click on the open menu moved it instead of closing it.
  return (
    <>
      <span className={className} {...menu.handlersFor(session)}>
        {children}
      </span>
      {menu.node}
    </>
  );
}

function SessionMenuPopup({ session, x, y, timezone, settled, onPick, onClose }: { session: MenuSession; x: number; y: number; timezone: string; settled: () => boolean; onPick: (kind: Dialog["kind"]) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  // While the finger that opened the menu is still down (and just after it lifts), a tap, scroll, right-click or resize is part of that same press, not a choice to close.
  const latest = useRef({ settled, onClose, onPick });
  latest.current = { settled, onClose, onPick };
  const dismiss = () => {
    if (latest.current.settled()) latest.current.onClose();
  };
  const pick = (kind: Dialog["kind"]) => {
    if (latest.current.settled()) latest.current.onPick(kind);
  };
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") latest.current.onClose();
    }
    function onMove() {
      if (latest.current.settled()) latest.current.onClose();
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);
  const pos = menuPosition(x, y, window.innerWidth, window.innerHeight);
  const item = "w-full min-h-11 px-4 text-left font-body text-sm text-chalk hover:bg-steel/15 focus:bg-steel/15 focus:outline-none";
  // A session that has already started is not cancelled from here (the same rule as the day page); Reschedule and Duplicate still are.
  const canRemove = session.startMs > Date.now();
  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      onClick={dismiss}
      onContextMenu={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <div role="menu" aria-label={`${session.name}, session`} className="absolute w-56 bg-surface border border-steel/40 shadow-lg py-1" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
        <p className="px-4 pt-2 pb-1 font-body text-xs text-steel truncate">
          {session.name} · {formatInTimezone(new Date(session.startMs), timezone, "dateTime")}
        </p>
        <button ref={first} type="button" role="menuitem" className={item} onClick={() => pick("reschedule")}>
          Reschedule
        </button>
        <button type="button" role="menuitem" className={item} onClick={() => pick("duplicate")}>
          Duplicate
        </button>
        {/* The client called it off (Ron, Nov 19: "Amber canceled her session this morning and I have no way to just say cancel charge"): before or after the start time. */}
        <button type="button" role="menuitem" className={item} onClick={() => pick("canceled")}>
          Client canceled
        </button>
        {canRemove && (
          <button type="button" role="menuitem" className={`${item} text-rust`} onClick={() => pick("remove")}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function useEscape(busy: boolean, onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
}

function DialogFrame({ label, busy, onClose, children }: { label: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/70 px-4" role="presentation" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-sm bg-surface border border-steel/30 p-4" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const fieldLabel = "font-body text-xs text-steel uppercase tracking-wide";
const fieldBox = "w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust";
const primary = "min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40";
const quiet = "min-h-11 font-body text-sm text-steel";

function startParts(session: MenuSession, timezone: string) {
  const start = new Date(session.startMs);
  return { dateKey: dateKeyInZone(timezone, start), time: clockLabel(minutesOfDayInZone(start, timezone)) };
}

function RescheduleDialog({ session, timezone, onClose, onDone }: { session: MenuSession; timezone: string; onClose: () => void; onDone: () => void }) {
  const now = startParts(session, timezone);
  const [dateKey, setDateKey] = useState(now.dateKey);
  const [time, setTime] = useState(now.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(busy, onClose);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: session.bookingId, newDateKey: dateKey, newTime: time, notify: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That didn't move. Nothing was changed.");
        setBusy(false);
        return;
      }
    } catch {
      setError("That didn't move. Check your connection and try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <DialogFrame label="Reschedule this session" busy={busy} onClose={onClose}>
      <p className="font-display font-bold uppercase text-sm tracking-wide text-rust">Reschedule</p>
      <p className="font-display font-bold text-lg leading-tight text-chalk mt-2">{session.name}</p>
      <p className="font-body text-sm text-steel">Now {formatInTimezone(new Date(session.startMs), timezone, "dateTime")}</p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <div>
          <label htmlFor="resched-date" className={fieldLabel}>
            New day
          </label>
          <input id="resched-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={fieldBox} />
        </div>
        <div>
          <label htmlFor="resched-time" className={fieldLabel}>
            Time
          </label>
          <input id="resched-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={fieldBox} />
        </div>
      </div>
      <p className="font-body text-xs text-steel mt-2">It stays the same session: nothing is taken from or given back to their sessions. {session.name.split(" ")[0]} is told the new time.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" disabled={busy || !dateKey || !time} onClick={save} className={primary}>
          {busy ? "Moving…" : "Move the session"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={quiet}>
          Keep it where it is
        </button>
      </div>
    </DialogFrame>
  );
}

// The client cancelled: the coach says whether it counts as one of their sessions. Before or after the start time; only this one session (a weekly schedule carries on).
function ClientCanceledDialog({ session, timezone, onClose, onDone }: { session: MenuSession; timezone: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(busy, onClose);
  const first = session.name.split(" ")[0];

  async function mark(charge: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("mark_client_cancelled", { p_booking_id: session.bookingId, p_charge: charge });
    setBusy(false);
    if (rpcError) {
      const m = rpcError.message;
      setError(
        m.includes("marked as happened")
          ? "This session is marked as happened. Undo that on the day page first."
          : m.includes("no-show")
            ? "This session is marked a no-show. Undo that on the day page first."
            : m.includes("only a booked session")
              ? "This session is already cancelled."
              : "That didn't save. Nothing was changed."
      );
      return;
    }
    // Takes it off a connected Google calendar too, as any cancellation does.
    mirrorGoogleCalendarEvent(session.bookingId);
    onDone();
    onClose();
  }

  return (
    <DialogFrame label="Client canceled" busy={busy} onClose={onClose}>
      <p className="font-display font-bold uppercase text-sm tracking-wide text-rust">Client canceled</p>
      <p className="font-display font-bold text-lg leading-tight text-chalk mt-2">{session.name}</p>
      <p className="font-body text-sm text-chalk">{formatInTimezone(new Date(session.startMs), timezone, "dateTime")}</p>
      <p className="font-body text-sm text-steel mt-3">
        This takes the session off the calendar. Does it count as one of {first}&apos;s sessions?
        {session.seriesId ? " Only this one: the weekly schedule carries on." : ""}
      </p>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" disabled={busy} onClick={() => mark(true)} className={primary}>
          Charge the session
        </button>
        <button type="button" disabled={busy} onClick={() => mark(false)} className="min-h-11 border border-steel/40 text-chalk font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
          Don&apos;t charge
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={quiet}>
          Keep the session
        </button>
      </div>
    </DialogFrame>
  );
}

function DuplicateDialog({ session, timezone, onClose, onDone }: { session: MenuSession; timezone: string; onClose: () => void; onDone: () => void }) {
  const now = startParts(session, timezone);
  // Same time next week (Ron, Nov 2), for as many weeks as the coach picks.
  const [dateKey, setDateKey] = useState(addDaysToKey(now.dateKey, 7));
  const [time, setTime] = useState(now.time);
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ booked: number; notBooked: { startIso: string; reason: string }[] } | null>(null);
  useEscape(busy, onClose);
  const durationMinutes = Math.max(5, Math.round((session.endMs - session.startMs) / 60000));
  const [hh, mm] = time.split(":").map(Number);
  const timeLabel = Number.isFinite(hh) && Number.isFinite(mm) ? clockLabel12(hh * 60 + mm) : "";
  const first = session.name.split(" ")[0];

  async function book() {
    if (busy || !dateKey || !time) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const [{ data: userData }, { data: original }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("bookings").select("athlete_id, group_id, session_type_id").eq("id", session.bookingId).maybeSingle(),
    ]);
    const o = original as { athlete_id: string; group_id: string; session_type_id: string | null } | null;
    if (!userData.user || !o) {
      setBusy(false);
      setError("Couldn't find that session. Nothing was booked.");
      return;
    }
    const startIso = zonedTimeToUtc(dateKey, time, timezone).toISOString();

    if (weeks === 1) {
      const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString();
      const { data: bookingId, error: bookError } = await supabase.rpc("book_session", {
        p_coach_id: userData.user.id,
        p_athlete_id: o.athlete_id,
        p_group_id: o.group_id,
        p_start_at: startIso,
        p_end_at: endIso,
      });
      if (bookError || !bookingId) {
        setBusy(false);
        setError(bookError?.message.includes("just taken") ? "That time is taken by another session." : "Couldn't book that time. Nothing was booked.");
        return;
      }
      if (o.session_type_id) await supabase.from("bookings").update({ session_type_id: o.session_type_id }).eq("id", bookingId as string);
      notifyBookingConfirmed(o.athlete_id, o.group_id, startIso);
      mirrorGoogleCalendarEvent(bookingId as string);
      setBusy(false);
      setResult({ booked: 1, notBooked: [] });
      onDone();
      return;
    }

    // More than one week: the same weekly booking as Repeat weekly (each one checked like any booking, one notice to the client for all of them).
    try {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: o.group_id, athleteId: o.athlete_id, firstStartIso: startIso, durationMinutes, mode: "fixed", count: weeks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.error ?? "Couldn't book those weeks. Nothing was booked.");
        return;
      }
      if (o.session_type_id && data.seriesId) await supabase.from("bookings").update({ session_type_id: o.session_type_id }).eq("recurring_series_id", data.seriesId);
      setResult({ booked: data.booked ?? 0, notBooked: data.notBooked ?? [] });
      onDone();
    } catch {
      setError("Couldn't book those weeks. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (result) {
    return (
      <DialogFrame label="Duplicated" busy={false} onClose={onClose}>
        <p className="font-display font-bold uppercase text-sm tracking-wide text-rust">Duplicated</p>
        <p className="font-body text-sm text-chalk mt-2" role="status">
          Booked {result.booked} {result.booked === 1 ? "session" : "sessions"} for {session.name}.
        </p>
        {result.notBooked.length > 0 && (
          <div className="mt-2">
            <p className="font-body text-xs text-steel">Not booked:</p>
            <ul className="font-body text-xs text-steel mt-1 space-y-0.5 max-h-32 overflow-y-auto">
              {result.notBooked.map((n) => (
                <li key={n.startIso}>
                  {formatInTimezone(new Date(n.startIso), timezone, "dateTime")}: {n.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" onClick={onClose} className={`${primary} w-full mt-4`}>
          Done
        </button>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame label="Duplicate this session" busy={busy} onClose={onClose}>
      <p className="font-display font-bold uppercase text-sm tracking-wide text-rust">Duplicate</p>
      <p className="font-display font-bold text-lg leading-tight text-chalk mt-2">{session.name}</p>
      <p className="font-body text-sm text-steel">
        {formatInTimezone(new Date(session.startMs), timezone, "dateTime")}, {durationMinutes} min
      </p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <div>
          <label htmlFor="dup-date" className={fieldLabel}>
            First day
          </label>
          <input id="dup-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={fieldBox} />
        </div>
        <div>
          <label htmlFor="dup-time" className={fieldLabel}>
            Time
          </label>
          <input id="dup-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={fieldBox} />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="dup-weeks" className={fieldLabel}>
          How many weeks
        </label>
        <select id="dup-weeks" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={fieldBox}>
          {Array.from({ length: DUPLICATE_MAX_WEEKS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "week" : "weeks"}
            </option>
          ))}
        </select>
      </div>
      {dateKey && timeLabel && <p className="font-body text-xs text-chalk mt-2">{duplicateSummary(dateKey, timeLabel, weeks)}</p>}
      <p className="font-body text-xs text-steel mt-1">Each one counts like any session you book. {first} gets one notice for all of them.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" disabled={busy || !dateKey || !time} onClick={book} className={primary}>
          {busy ? "Booking…" : weeks === 1 ? "Book it" : `Book ${weeks} weeks`}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={quiet}>
          Cancel
        </button>
      </div>
    </DialogFrame>
  );
}
